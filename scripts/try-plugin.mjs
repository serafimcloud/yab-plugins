#!/usr/bin/env node
// Tries plugins (plugins/<id>) on their live pages in WebKit: the page as it
// is, then the page with the plugin running under a stand-in for Yab's page
// sandbox, then the plugin's BOOST.md checks and its trial's own assertions
// (scripts/trials/<id>.mjs). Takes before and after pictures.
//
//   node scripts/try-plugin.mjs                       every plugin
//   node scripts/try-plugin.mjs youtube-dislikes ...  the plugins named
//
// Options: --out <dir> (default out), --pics <dir> (also writes
// <id>-before.jpg and <id>-after.jpg there, 1280 wide, at most 250 KB),
// --headed.
//
// The stand-in: Yab runs each plugin in a WebKit content world of its own,
// which Playwright cannot create. Here the plugin runs in the page's world,
// in the same wrapper Yab uses (BoostScript.swift): its code is the body of
// function (boost) { ... }, after DOMContentLoaded (document_end), in the
// main frame only, with boost.on, boost.observe, boost.cleanup and
// boost.check. fetch is the plugin's own: the page's origin, plus the
// manifest's yab.hosts over HTTPS without cookies or redirects. XHR,
// WebSocket and EventSource throw. The page's own CSP still applies, as it
// would in Yab.
//
// Sites that need sign-in (X) or show automated browsers a captcha (Google)
// are tried on a saved page in scripts/fixtures/, served at the real
// address; the result says so in its note.
//
// Writes out/results.json entries ({state, at, note, pictures, ...}) that
// catalog.mjs reads the same way as check.mjs's: `works` only on the live
// page; a pass on a saved page is `unchecked` with a note saying so.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { webkit } from 'playwright';
import { PLUGINS, ROOT, hostsOf, pluginIds, readBoost } from './lib/boosts.mjs';
import { detectWall, dismissConsent, evaluateChecks, settle, waitOutChallenge } from './lib/page.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); if (i < 0) return fallback; const [, value] = args.splice(i, 2); return value; };
const flag = name => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const OUT = resolve(ROOT, option('--out', 'out'));
const PICS = option('--pics', null);
const HEADED = flag('--headed');
const LOAD_TIMEOUT = 45_000, PLUGIN_TIMEOUT = 180_000, MAX_JPEG = 250_000;
const FIXTURES = join(ROOT, 'scripts', 'fixtures');
const TRIALS = join(ROOT, 'scripts', 'trials');

// ---- the stand-in for Yab's page sandbox ---------------------------------------

/// The init script for one plugin: storage seeds, then the plugin at document_end.
export function standIn(plugin, seed = {}) {
  const content = (plugin.manifest.content_scripts ?? []).map(script => ({
    matches: script.matches ?? [],
    css: (script.css ?? []).map(path => plugin.files[path] ?? '').join('\n'),
    js: (script.js ?? []).map(path => plugin.files[path] ?? '').join('\n;\n'),
  }));
  const json = value => JSON.stringify(value).replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
  const blocks = content.map(entry => `
    if (${json(entry.matches)}.some(matches)) {
      const style = document.createElement('style'); style.dataset.yabBoost = ${json(plugin.id)};
      style.textContent = ${json(entry.css)}; (document.head || document.documentElement).append(style); styles.push(style);
      ${entry.js ? `try { const cleanup = (function (boost, fetch, XMLHttpRequest, WebSocket, EventSource) {\n${entry.js}\n})(api, pluginFetch, Closed, Closed, Closed); if (typeof cleanup === 'function') cleanups.push(cleanup); } catch (e) { errors.push(String(e && e.stack || e)); }` : ''}
    }`).join('\n');
  const checks = plugin.files['checks.js']
    ? `try { (function (boost) {\n${plugin.files['checks.js']}\n})(api); } catch (e) { errors.push(String(e && e.stack || e)); }`
    : '';
  return `(() => {
  if (window.top !== window) return;
  const seed = ${json(seed)};
  for (const [key, value] of Object.entries(seed[location.hostname] ?? {})) {
    try { if (!sessionStorage.getItem('yab-try-seeded:' + key)) { localStorage.setItem(key, value); sessionStorage.setItem('yab-try-seeded:' + key, '1'); } } catch {}
  }
  const errors = [], requests = [], scripted = {}, styles = [], cleanups = [];
  window.__yabTry = { errors, requests, checks: scripted, stop: () => { for (const f of cleanups.reverse()) { try { f(); } catch {} } for (const s of styles) s.remove(); } };
  const start = () => {
    const sensitive = !['http:', 'https:'].includes(location.protocol) ||
      /(?:^|\\/)(?:login|signin|sign-in|auth|oauth|checkout|payment|wallet)(?:\\/|$)/i.test(location.pathname) ||
      !!document.querySelector('input[type="password"], input[autocomplete^="cc-"], input[autocomplete="one-time-code"]');
    if (sensitive) { errors.push('skipped: sign-in or payment page'); return; }
    const sites = ${json(plugin.boost.sites)}, hosts = ${json(hostsOf(plugin.manifest))};
    if (!sites.includes(location.hostname)) return;
    const glob = (pattern, value) => new RegExp('^' + pattern.split('*').map(x => x.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&')).join('.*') + '$').test(value);
    const matches = pattern => { const u = new URL(pattern); return u.protocol === location.protocol && u.hostname === location.hostname && glob(u.pathname, location.pathname); };
    let stopped = false;
    const api = Object.freeze({
      check(name, fn) { if (typeof fn !== 'function') throw Error('A check must be a function'); scripted[name] = fn; },
      on(target, event, fn, options) { target.addEventListener(event, fn, options); cleanups.push(() => target.removeEventListener(event, fn, options)); },
      observe(target, fn, options) {
        if (!target || target === document || target === document.documentElement) throw Error('Observe the closest stable parent.');
        let frame; const observer = new MutationObserver(records => {
          cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { if (!stopped) { try { fn(records); } catch (e) { errors.push(String(e && e.stack || e)); } } });
        }); observer.observe(target, options || { childList: true });
        cleanups.push(() => { observer.disconnect(); cancelAnimationFrame(frame); }); return observer;
      },
      cleanup(fn) { if (typeof fn === 'function') cleanups.push(fn); }
    });
    cleanups.push(() => { stopped = true; });
    // The page's origin, or a declared host over HTTPS: no cookies, no redirects.
    const pageFetch = window.fetch.bind(window);
    const pluginFetch = (input, options = {}) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href);
      const other = url.origin !== location.origin;
      if (other && !(url.protocol === 'https:' && hosts.includes(url.hostname))) {
        requests.push({ url: url.href, blocked: true });
        return Promise.reject(Error('Plugin network requests stay on this origin and the hosts the plugin declares.'));
      }
      requests.push({ url: url.href });
      return pageFetch(input, { ...options, redirect: 'error', ...(other ? { credentials: 'omit' } : {}) });
    };
    const Closed = class { constructor() { throw Error('Not available to plugins: use fetch.'); } };
    ${blocks}
    ${checks}
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();`;
}

// ---- pictures ------------------------------------------------------------------

const sharp = await import('sharp').then(m => m.default).catch(() => null);

async function picture(page, id, side) {
  // A busy video page can miss WebKit's first frame: one more try.
  const png = await page.screenshot({ type: 'png', timeout: 20_000 }).catch(() => page.screenshot({ type: 'png', timeout: 40_000, animations: 'disabled' }));
  const out = {};
  if (!sharp) {
    const folder = join(OUT, 'pictures', id); mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, side + '.png'), png);
    return { store: `pictures/${id}/${side}.png` };
  }
  const folder = join(OUT, 'pictures', id); mkdirSync(folder, { recursive: true });
  await sharp(png).resize({ width: 1280 }).webp({ quality: 82 }).toFile(join(folder, side + '.webp'));
  out.store = `pictures/${id}/${side}.webp`;
  if (PICS) {
    mkdirSync(PICS, { recursive: true });
    let jpeg;
    for (const quality of [82, 72, 62, 52, 42]) {
      jpeg = await sharp(png).resize({ width: 1280 }).jpeg({ quality, mozjpeg: true }).toBuffer();
      if (jpeg.length <= MAX_JPEG) break;
    }
    const path = join(PICS, `${id}-${side}.jpg`);
    writeFileSync(path, jpeg);
    out.jpeg = path;
  }
  return out;
}

// ---- one plugin ----------------------------------------------------------------

async function newContext(browser, trial, routes) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', ...(trial.context ?? {}) });
  // Routes map an address prefix to a saved page in scripts/fixtures/.
  for (const [prefix, file] of Object.entries(routes ?? {})) {
    const body = readFileSync(join(FIXTURES, file), 'utf8');
    await context.route(url => url.href.startsWith(prefix), route => {
      if (route.request().resourceType() === 'document') {
        return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body, headers: { 'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:" } });
      }
      return route.abort();
    });
  }
  return context;
}

async function open(page, url) {
  const response = await page.goto(url, { waitUntil: 'load', timeout: LOAD_TIMEOUT }).catch(error => ({ error }));
  await settle(page);
  await waitOutChallenge(page);
  if (await dismissConsent(page)) await settle(page);
  return response;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
// As in check.mjs: sign-in popups (Google One Tap) cover the pictures and
// are not part of any page.
const CHECKER_CSS = '#credential_picker_container, #credential_picker_iframe, iframe[src*="accounts.google.com/gsi"] { display: none !important; }';
/// Polls fn in the page until it returns something truthy, up to ms.
export async function until(page, fn, arg, ms = 15_000) {
  const end = Date.now() + ms;
  let value;
  while (Date.now() < end) {
    value = await page.evaluate(fn, arg).catch(() => null);
    if (value) return value;
    await sleep(400);
  }
  return value;
}

async function tryOne(browser, id) {
  const plugin = readBoost(id, PLUGINS);
  const trialFile = join(TRIALS, `${id}.mjs`);
  const trial = existsSync(trialFile) ? (await import(pathToFileURL(trialFile).href)).default : {};
  const at = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const url = trial.url ?? plugin.boost.preview;
  const result = { state: 'unchecked', at, note: null, url, before: null, after: null, pictures: {}, cases: [] };
  const tools = { until: (page, fn, arg, ms) => until(page, fn, arg, ms), sleep };
  let routes = trial.routes ?? null;
  const notes = [];
  if (trial.note) notes.push(trial.note);

  // Before: the page as it is.
  let context = await newContext(browser, trial, routes);
  let page = await context.newPage();
  let data = null;
  try {
    await open(page, url);
    let wall = await page.evaluate(detectWall).catch(() => null);
    if (wall && trial.fallback) {
      notes.push(`${wall} live: tried on a saved page (${Object.values(trial.fallback).join(', ')})`);
      routes = trial.fallback;
      await context.close();
      context = await newContext(browser, trial, routes);
      page = await context.newPage();
      await open(page, url);
      wall = null;
    }
    if (wall) { result.note = wall; return result; }
    data = trial.prepare ? await trial.prepare(page, tools) : null;
    if (trial.act) await trial.act(page, { phase: 'before', data, ...tools });
    result.before = await page.evaluate(evaluateChecks, { checks: plugin.boost.checks, cssText: plugin.css });
    if (trial.shot) await trial.shot(page, { phase: 'before', ...tools });
    await page.addStyleTag({ content: CHECKER_CSS }).catch(() => {});
    result.pictures.before = await picture(page, id, 'before');
  } finally {
    await context.close().catch(() => {});
  }

  // After: the same page with the plugin.
  context = await newContext(browser, trial, routes);
  const seed = trial.seed ? trial.seed(data) : {};
  await context.addInitScript({ content: standIn(plugin, seed) });
  page = await context.newPage();
  // Uncaught errors from timers and listeners can't be told apart from the
  // site's own; they are kept for reading, not counted.
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(String(error.message ?? error).split('\n')[0]));
  try {
    await open(page, url);
    if (trial.act) await trial.act(page, { phase: 'after', data, ...tools });
    const expectation = trial.expect ? await trial.expect(page, { data, ...tools }) : { ok: true, detail: 'no trial assertions' };
    result.after = await page.evaluate(evaluateChecks, { checks: plugin.boost.checks, cssText: plugin.css });
    const sandbox = await page.evaluate(() => ({ errors: window.__yabTry?.errors ?? null, requests: window.__yabTry?.requests ?? [] }));
    result.requests = sandbox.requests;
    if (trial.shot) await trial.shot(page, { phase: 'after', ...tools });
    await page.addStyleTag({ content: CHECKER_CSS }).catch(() => {});
    result.pictures.after = await picture(page, id, 'after');
    result.expect = expectation;

    // Extra cases: other pages and paths of the same plugin, no pictures.
    for (const extra of trial.cases ?? []) {
      const caseContext = await newContext(browser, trial, extra.routes ?? null);
      await caseContext.addInitScript({ content: standIn(plugin, extra.seed ?? {}) });
      const casePage = await caseContext.newPage();
      try {
        await open(casePage, extra.url);
        const wall = await casePage.evaluate(detectWall).catch(() => null);
        if (wall) { result.cases.push({ name: extra.name, ok: null, detail: wall }); continue; }
        const outcome = await extra.expect(casePage, tools);
        // A stand-in page has only the part the case is about: no BOOST.md checks.
        const checks = extra.checks === false ? { checks: [] } : await casePage.evaluate(evaluateChecks, { checks: plugin.boost.checks, cssText: plugin.css });
        const failed = checks.checks.filter(c => c.state === 'fail');
        result.cases.push({ name: extra.name, ok: outcome.ok && !failed.length, detail: outcome.detail + (failed.length ? '; checks failed: ' + failed.map(c => c.line).join('; ') : '') });
      } catch (error) {
        result.cases.push({ name: extra.name, ok: false, detail: String(error.message ?? error).split('\n')[0] });
      } finally {
        await caseContext.close().catch(() => {});
      }
    }

    const ran = result.after.checks.filter(c => c.state !== 'skipped');
    const failed = ran.filter(c => c.state === 'fail');
    const blocked = sandbox.requests.filter(r => r.blocked);
    const errors = (sandbox.errors ?? ['the plugin did not run']).filter(e => !e.startsWith('skipped:'));
    result.pageErrors = pageErrors.slice(0, 20);
    const caseFailures = result.cases.filter(c => c.ok === false);
    const problems = [
      ...(!expectation.ok ? [`trial: ${expectation.detail}`] : []),
      ...failed.map(c => `check failed: ${c.line}` + (c.found !== undefined ? ` (found ${c.found})` : '') + (c.error ? ` (${c.error})` : '')),
      ...blocked.map(r => `blocked request: ${r.url}`),
      ...errors.map(e => `error: ${e.split('\n')[0]}`),
      ...caseFailures.map(c => `case ${c.name}: ${c.detail}`),
    ];
    if (!ran.length && !trial.expect) { result.state = 'unchecked'; notes.push(`no check covers ${result.after.path}`); }
    else if (problems.length) { result.state = 'fails'; notes.push(...problems); }
    // "Works today" in the Store means the live page: a pass on a saved page
    // stays unchecked, with the note saying where it passed.
    else if (routes) { result.state = 'unchecked'; result.saved = true; notes.push('passes on the saved page'); }
    else result.state = 'works';
    result.detail = expectation.detail;
  } catch (error) {
    result.state = 'unchecked';
    notes.push('try did not run: ' + String(error.message ?? error).split('\n')[0]);
  } finally {
    await context.close().catch(() => {});
  }
  result.note = notes.length ? notes.join('; ') : null;
  return result;
}

const withTimeout = (promise, ms) => Promise.race([promise, new Promise(r => setTimeout(() => r({
  state: 'unchecked', at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'), note: `try timed out after ${ms / 1000} s`, pictures: {},
}), ms))]);

async function main() {
  const all = pluginIds();
  for (const id of args) if (!all.includes(id)) throw Error(`No such plugin: ${id}`);
  // Plugins without page scripts (services, tools, app pages) have no page
  // to try here: scripts/try-service.mjs tries them.
  const pageless = id => !(readBoost(id, PLUGINS).manifest?.content_scripts ?? []).length;
  const ids = (args.length ? args : all).filter(id => {
    if (!pageless(id)) return true;
    console.log(`skipped   ${id}: no page scripts; try it with scripts/try-service.mjs`);
    return false;
  });
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, 'results.json');
  const results = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
  const browser = await webkit.launch({ headless: !HEADED });
  for (const id of ids) {
    rmSync(join(OUT, 'pictures', id), { recursive: true, force: true });
    const result = await withTimeout(tryOne(browser, id), PLUGIN_TIMEOUT);
    // catalog.mjs reads pictures as paths inside out/.
    const pictures = result.pictures ?? {};
    results[id] = { ...result, pictures: { before: pictures.before?.store, after: pictures.after?.store } };
    console.log(`${result.state.padEnd(9)} ${id}${result.detail ? `: ${result.detail}` : ''}${result.note ? `\n          (${result.note})` : ''}`);
    for (const c of result.cases ?? []) console.log(`          case ${c.ok === null ? 'unchecked' : c.ok ? 'works' : 'FAILS'}: ${c.name}: ${c.detail}`);
    if (pictures.before?.jpeg) console.log(`          ${pictures.before.jpeg}\n          ${pictures.after?.jpeg ?? ''}`);
  }
  await browser.close();
  const sorted = Object.fromEntries(Object.keys(results).sort().map(k => [k, results[k]]));
  writeFileSync(file, JSON.stringify(sorted, null, 2) + '\n');
  const works = ids.filter(id => results[id].state === 'works').length;
  const saved = ids.filter(id => results[id].saved).length;
  console.log(`\n${works}/${ids.length} work live${saved ? `, ${saved} pass on saved pages` : ''}; results in ${file}`);
  if (ids.some(id => results[id].state === 'fails')) process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exit(2); });
