#!/usr/bin/env node
// Runs every boost's checks on its live preview page in WebKit, before and
// after its CSS, and takes the store's before/after pictures.
//
//   node scripts/check.mjs                      every boost
//   node scripts/check.mjs youtube-no-shorts    the boosts named
//   node scripts/check.mjs --changed main...HEAD  the boosts changed in a range
//
// Options: --out <dir> (default out), --jobs <n> (default 4), --headed.
//
// Writes out/results.json ({id: {state, at, note, url, before, after}}) and
// out/pictures/<id>/{before,after}.webp. A state is `works`, `fails` or
// `unchecked` (with a note such as "needs sign-in"). Results for boosts not
// checked in this run are kept from the previous results.json.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { webkit } from 'playwright';
import { ROOT, boostIds, readBoost } from './lib/boosts.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const [, value] = args.splice(i, 2); return value; };
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const OUT = resolve(ROOT, option('--out', 'out'));
const JOBS = Number(option('--jobs', '4'));
const CHANGED = option('--changed', null);
const HEADED = flag('--headed');
const LOAD_TIMEOUT = 45_000, IDLE_CAP = 10_000, BOOST_TIMEOUT = 120_000;

function selectedIds() {
  const all = boostIds();
  if (CHANGED) {
    const paths = execFileSync('git', ['diff', '--name-only', CHANGED, '--', 'boosts'], { cwd: ROOT, encoding: 'utf8' }).split('\n');
    const ids = new Set(paths.filter(Boolean).map(p => p.split('/')[1]));
    return all.filter(id => ids.has(id));
  }
  if (args.length) {
    for (const id of args) if (!all.includes(id)) throw Error(`No such boost: ${id}`);
    return args;
  }
  return all;
}

// Runs in the page. The same evaluation as Yab's report() in BoostScript.swift:
// checks count only visible elements, `display: contents` counts its children.
function evaluateChecks({ checks, cssText }) {
  function visible(e) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; return s.display === 'contents' ? Array.from(e.children).some(visible) : e.getClientRects().length > 0; }
  const glob = (pattern, value) => new RegExp('^' + pattern.split('*').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(value);
  const results = checks.map(c => {
    if (!glob(c.path, location.pathname)) return { line: c.line, state: 'skipped', reason: 'Another page' };
    try {
      if (c.kind === 'script') return { line: c.line, state: 'skipped', reason: 'Script checks need checks.js in Yab' };
      const all = Array.from(document.querySelectorAll(c.selector)), shown = all.filter(visible);
      let pass = false, found = shown.length;
      if (c.kind === 'none') pass = shown.length === 0;
      if (c.kind === 'some') pass = shown.length > 0;
      if (c.kind === 'text') pass = shown.some(e => e.textContent.includes(c.words));
      if (c.kind === 'rows') {
        const children = shown.flatMap(e => Array.from(e.children).filter(visible));
        const top = children.length ? Math.min(...children.map(e => e.getBoundingClientRect().top)) : NaN;
        found = children.filter(e => Math.abs(e.getBoundingClientRect().top - top) < 3).length;
        pass = found === c.count;
      }
      return { line: c.line, state: pass ? 'pass' : 'fail', found, present: all.length };
    } catch (e) { return { line: c.line, state: 'fail', error: String(e) }; }
  });
  // How many elements each of the boost's own selectors finds right now.
  const matched = {};
  const sheet = new CSSStyleSheet();
  try { sheet.replaceSync(cssText); } catch {}
  const walk = list => { for (const rule of list) {
    if (rule.selectorText) { try { matched[rule.selectorText] = document.querySelectorAll(rule.selectorText).length; } catch { matched[rule.selectorText] = -1; } }
    if (rule.cssRules) walk(rule.cssRules);
  } };
  walk(sheet.cssRules);
  return { path: location.pathname, checks: results, matched };
}

// Runs in the page: the computed values of every property the boost sets, on
// up to 40 elements per rule. Compared before and after the CSS, it says
// whether the boost changes anything at all on this page.
function sampleStyles(cssText) {
  const sheet = new CSSStyleSheet();
  try { sheet.replaceSync(cssText); } catch { return {}; }
  const out = {};
  const walk = list => { for (const rule of list) {
    if (rule.selectorText && rule.style) {
      const props = Array.from(rule.style);
      let elements = [];
      try { elements = Array.from(document.querySelectorAll(rule.selectorText)).slice(0, 40); } catch {}
      out[rule.selectorText] = elements.map(e => { const s = getComputedStyle(e); return props.map(p => p + '=' + s.getPropertyValue(p)).join(';'); });
    }
    if (rule.cssRules) walk(rule.cssRules);
  } };
  walk(sheet.cssRules);
  return out;
}

function styleChanges(before, after) {
  let changed = 0, sampled = 0;
  for (const [selector, values] of Object.entries(before)) {
    values.forEach((value, i) => { sampled++; if (after[selector]?.[i] !== undefined && after[selector][i] !== value) changed++; });
  }
  return { changed, sampled };
}

// The checker's own stylesheet, the same before and after: sign-in popups
// (Google One Tap) cover the pictures and are not part of any page.
const CHECKER_CSS = '#credential_picker_container, #credential_picker_iframe, iframe[src*="accounts.google.com/gsi"] { display: none !important; }';

// Runs in the page: is this a wall rather than the page the boost is for?
function detectWall() {
  const text = (document.body?.innerText ?? '').slice(0, 20000);
  const title = document.title;
  const shown = s => Array.from(document.querySelectorAll(s)).some(e => { const r = e.getBoundingClientRect(); return r.width > 30 && r.height > 30; });
  // A page that is mostly a challenge: little text, and a challenge title, form or widget.
  const thin = text.trim().length < 1500;
  if (/just a moment|attention required|access denied|are you a robot|verify you are human|security check/i.test(title) || /[?&]__cf_chl_/.test(location.search) && thin) return 'blocked';
  if (thin && shown('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], iframe[src*="arkoselabs"], #challenge-form, #challenge-stage, .cf-turnstile')) return 'blocked';
  if (/sign in to confirm (that )?you('|\u2019)re not a bot|unusual traffic from your computer|you('|\u2019)ve been blocked by network security|whoa there, pardner|please verify you are a human/i.test(text)) return 'blocked';
  if (/(^|\.)consent\.(youtube|google)\.com$/.test(location.hostname)) return 'consent page';
  if (/(?:^|\/)(?:login|signin|sign-in|auth|oauth|i\/flow\/login|onboarding)(?:\/|$)/i.test(location.pathname)) return 'needs sign-in';
  if (thin && shown('input[type="password"]')) return 'needs sign-in';
  if (!text.trim()) return 'blank page';
  return null;
}

// Runs in the page: is a sign-in prompt visible (for checks that found nothing to act on)?
function signInVisible() {
  const candidates = Array.from(document.querySelectorAll('a, button')).slice(0, 4000);
  return candidates.some(e => {
    const label = (e.textContent ?? '').trim() + ' ' + (e.getAttribute('aria-label') ?? '');
    if (!/^\s*(sign in|log in|login|sign up)\b/i.test(label.trim())) return false;
    const r = e.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
}

// Never accept tracking: only buttons that reject or keep the necessary ones.
const REJECT = /^(?:(?:reject|decline|refuse)(?: all| optional| non-essential| additional)?(?: cookies)?|(?:use |allow )?(?:only )?(?:necessary|essential|required)(?: cookies)? only|(?:use |allow )?only (?:allow )?(?:necessary|essential|required)(?: cookies)?)$/i;

// Locator.count() takes no timeout and never settles in some ad frames, so
// every frame gets a bounded look.
const bounded = (promise, ms, fallback) => Promise.race([promise.catch(() => fallback), new Promise(resolve => setTimeout(() => resolve(fallback), ms))]);

async function dismissConsent(page) {
  for (let round = 0; round < 2; round++) {
    let clicked = false;
    for (const frame of page.frames()) {
      // Frames without a URL (ad slots written by script) hold no consent banner.
      const url = frame.url();
      if (frame !== page.mainFrame() && (!url || url === 'about:blank' || frame.isDetached())) continue;
      try {
        const buttons = frame.locator('button, [role="button"], input[type="button"], input[type="submit"], a[role="button"]');
        const count = Math.min(await bounded(buttons.count(), 2000, 0), 300);
        for (let i = 0; i < count && !clicked; i++) {
          const b = buttons.nth(i);
          const label = ((await b.innerText({ timeout: 500 }).catch(() => '')) || (await b.getAttribute('aria-label', { timeout: 500 }).catch(() => '')) || (await b.getAttribute('value', { timeout: 500 }).catch(() => '')) || '').trim().replace(/\s+/g, ' ');
          if (REJECT.test(label) && await b.isVisible().catch(() => false)) {
            await b.click({ timeout: 3000 }).catch(() => {});
            clicked = true;
          }
        }
      } catch {}
      if (clicked) break;
    }
    if (!clicked) return round > 0;
    await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  return true;
}

async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: IDLE_CAP }).catch(() => {});
  // Like Yab, check once the page has been still for a moment.
  await page.waitForTimeout(1500);
}

// A challenge page that solves itself (Cloudflare's) gets up to 20 s.
async function waitOutChallenge(page) {
  for (let waited = 0; waited < 20_000; waited += 2000) {
    const wall = await page.evaluate(detectWall).catch(() => 'blocked');
    if (wall !== 'blocked' && wall !== 'blank page') return;
    await page.waitForTimeout(2000);
  }
}

// Lazy pages fill in as people scroll: scroll three screens, then back up.
async function scrollThrough(page) {
  for (let i = 0; i < 3; i++) { await page.mouse.wheel(0, 800).catch(() => {}); await page.waitForTimeout(700); }
  await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {});
  await page.waitForTimeout(800);
}

// Runs in the page: bring the largest thing a hide check is about into view,
// so the pictures show what the boost changes.
function focusHidden(selectors) {
  let best = null, area = 0;
  for (const selector of selectors) {
    let list = [];
    try { list = Array.from(document.querySelectorAll(selector)); } catch { continue; }
    for (const e of list) {
      const r = e.getBoundingClientRect();
      if (r.width * r.height > area && getComputedStyle(e).visibility !== 'hidden') { best = e; area = r.width * r.height; }
    }
  }
  if (!best) return 0;
  const r = best.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= innerHeight) return window.scrollY;
  window.scrollTo(0, Math.max(0, window.scrollY + r.top - 120));
  return window.scrollY;
}

// sharp when installed, else the cwebp tool, else plain PNG.
const encoding = (async () => {
  try { return { kind: 'sharp', sharp: (await import('sharp')).default }; } catch {}
  if (spawnSync('cwebp', ['-version']).status === 0) return { kind: 'cwebp' };
  return null;
})();
async function webp(png, target) {
  const encoder = await encoding;
  if (encoder?.kind === 'sharp') { await encoder.sharp(png).webp({ quality: 82 }).toFile(target + '.webp'); return 'webp'; }
  if (encoder?.kind === 'cwebp') {
    writeFileSync(target + '.png', png);
    const done = spawnSync('cwebp', ['-quiet', '-q', '82', target + '.png', '-o', target + '.webp']);
    if (done.status === 0) { rmSync(target + '.png'); return 'webp'; }
    return 'png';
  }
  writeFileSync(target + '.png', png);
  return 'png';
}

async function checkOne(browser, id) {
  const boost = readBoost(id);
  const { preview, checks, sites } = boost.boost;
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const result = { state: 'unchecked', at, note: null, url: preview, before: null, after: null, pictures: {} };
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light' });
  const page = await context.newPage();
  try {
    const response = await page.goto(preview, { waitUntil: 'load', timeout: LOAD_TIMEOUT }).catch(error => { result.loadError = String(error.message ?? error).split('\n')[0]; return null; });
    await settle(page);
    await waitOutChallenge(page);
    if (await dismissConsent(page)) { result.consent = 'rejected'; await settle(page); }
    await scrollThrough(page);
    result.url = page.url();
    result.status = response?.status() ?? null;
    let wall = await page.evaluate(detectWall).catch(() => null);
    const host = new URL(result.url).hostname;
    if (!wall && !sites.includes(host)) wall = /consent/.test(host) ? 'consent page' : 'needs sign-in';
    const hides = checks.filter(c => c.kind === 'none').map(c => c.selector);
    if (!wall && hides.length) await page.evaluate(focusHidden, hides).catch(() => 0);
    const folder = join(OUT, 'pictures', id);
    rmSync(folder, { recursive: true, force: true });
    mkdirSync(folder, { recursive: true });
    await page.addStyleTag({ content: CHECKER_CSS }).catch(() => {});
    const before = await page.evaluate(evaluateChecks, { checks, cssText: boost.css });
    result.before = before;
    const stylesBefore = await page.evaluate(sampleStyles, boost.css).catch(() => ({}));
    const format = await webp(await page.screenshot({ type: 'png' }), join(folder, 'before'));
    result.pictures.before = `pictures/${id}/before.${format}`;
    await page.addStyleTag({ content: boost.css });
    await page.waitForTimeout(600);
    const after = await page.evaluate(evaluateChecks, { checks, cssText: boost.css });
    result.after = after;
    result.styles = styleChanges(stylesBefore, await page.evaluate(sampleStyles, boost.css).catch(() => ({})));
    const afterFormat = await webp(await page.screenshot({ type: 'png' }), join(folder, 'after'));
    result.pictures.after = `pictures/${id}/after.${afterFormat}`;

    const ran = after.checks.filter(c => c.state !== 'skipped');
    const failed = ran.filter(c => c.state === 'fail');
    // A `none of` check that already passed before the CSS proves nothing on this page.
    const noneChecks = checks.map((c, i) => ({ c, i })).filter(({ c }) => c.kind === 'none');
    const vacuous = noneChecks.length > 0 && noneChecks.every(({ i }) => before.checks[i]?.state === 'pass');
    if (wall) { result.state = 'unchecked'; result.note = wall; }
    else if (!ran.length) { result.state = 'unchecked'; result.note = `the preview opened ${after.path}, which no check covers`; }
    else if (failed.length) { result.state = 'fails'; result.note = failed.map(c => c.line + (c.found !== undefined ? ` (found ${c.found})` : '') + (c.error ? ` (${c.error})` : '')).join('; '); }
    else if (vacuous) {
      result.state = 'unchecked';
      result.note = (await page.evaluate(signInVisible).catch(() => false)) && Object.values(before.matched).every(n => n <= 0)
        ? 'needs sign-in: nothing to hide on the signed-out page'
        : 'nothing to hide on the preview page today';
    }
    else if (result.styles.changed === 0) { result.state = 'fails'; result.note = `the checks pass, but the boost's CSS changes nothing on the preview page (${result.styles.sampled} elements sampled)`; }
    else { result.state = 'works'; }
  } catch (error) {
    result.state = 'unchecked';
    result.note = 'check did not run: ' + String(error.message ?? error).split('\n')[0];
  } finally {
    await context.close().catch(() => {});
  }
  return result;
}

// The timer is cleared when the check finishes, or it keeps the process alive.
const withTimeout = (promise, ms, id) => {
  let timer;
  const late = new Promise(resolve => { timer = setTimeout(() => resolve({
    state: 'unchecked', at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), note: `check timed out after ${ms / 1000} s`, before: null, after: null, pictures: {},
  }), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
};

async function main() {
  const ids = selectedIds();
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, 'results.json');
  const results = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  if (!ids.length) { console.log('No boosts to check.'); writeFileSync(file, JSON.stringify(results, null, 2) + '\n'); return; }
  const browser = await webkit.launch({ headless: !HEADED });
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const result = await withTimeout(checkOne(browser, id), BOOST_TIMEOUT, id);
      results[id] = result;
      console.log(`${result.state.padEnd(9)} ${id}${result.note ? `  (${result.note})` : ''}`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(JOBS, ids.length) }, worker));
  await browser.close();
  const sorted = Object.fromEntries(Object.keys(results).sort().map(k => [k, results[k]]));
  writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
  const summary = ['| Boost | State | Note |', '|---|---|---|', ...ids.map(id => `| ${id} | ${results[id].state} | ${results[id].note ?? ''} |`)].join('\n');
  writeFileSync(join(OUT, 'summary.md'), summary + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) writeFileSync(process.env.GITHUB_STEP_SUMMARY, summary + '\n', { flag: 'a' });
  console.log(`\n${ids.filter(id => results[id].state === 'works').length}/${ids.length} work; results in ${file}`);
  // A pull request fails only when a check really failed, not when a site needs sign-in.
  if (CHANGED && ids.some(id => results[id].state === 'fails')) process.exitCode = 1;
}

main().catch(error => { console.error(error); process.exit(2); });
