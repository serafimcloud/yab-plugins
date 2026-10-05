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
import { detectWall, dismissConsent, evaluateChecks, settle, waitOutChallenge } from './lib/page.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const [, value] = args.splice(i, 2); return value; };
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const OUT = resolve(ROOT, option('--out', 'out'));
const JOBS = Number(option('--jobs', '4'));
const CHANGED = option('--changed', null);
const HEADED = flag('--headed');
const LOAD_TIMEOUT = 45_000, BOOST_TIMEOUT = 120_000;

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
