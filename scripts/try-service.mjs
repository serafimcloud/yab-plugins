#!/usr/bin/env node
// Tries a plugin's code the way Yab runs it, outside Yab.
//
//   node scripts/try-service.mjs <id> [--ticks n] [--storage <json|file>]
//        [--fixture <tick|*>:<url>=<file>]... [--log <file>] [--save <file>]
//        [--strict-cors] [--shot <png> [--dark] [--standalone]]
//   node scripts/try-service.mjs <id> --tool <name> '<json args>'
//   node scripts/try-service.mjs <id> --evals
//
// Service ticks (BoostServices.swift): service.js runs with `export` removed,
// in the same scope as Yab's own `signal`, `storage`, `originalFetch`, `fetch`
// and `timer`, so a clashing name fails here as it would in Yab. `fetch`
// reaches only the plugin's sites (and yab.hosts), HTTPS, no cookies, no
// redirects. Ticks stop at 25 s. Storage round-trips through JSON between
// ticks and must stay under 64 KB. A `wake` counts only with yab:task, at most
// 8,000 characters, and not when it repeats the previous wake. Yab makes the
// service's requests itself (BoostServiceFetch), so CORS does not apply;
// --strict-cors still refuses answers without Access-Control-Allow-Origin
// `*` or `null`, as Yab builds before the store-code release did. A fixture answers one URL
// from a local file on a given tick (or every tick), to stage a change.
//
// Tools (BoostTools.swift, BoostToolRuntime.swift): arguments are validated
// against the manifest schema; `site.json(path)` does a real GET on the
// plugin's first site with Accept: application/json and no cookies;
// `site.post` is refused unless the tool declares `acts`, and even then it is
// only printed here, never sent (Yab asks the person on every call).
//
// --shot serves app/ the way Yab does (its shell and Content-Security-Policy
// in front of the page), stubs chrome.yab.storage with the storage after the
// ticks, and saves a WebKit picture. --standalone leaves chrome.yab.storage
// out, as in a Yab without that bridge: the page keeps its own list.
import { readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { join, dirname, extname, resolve } from 'node:path';
import vm from 'node:vm';
import { ROOT } from './lib/boosts.mjs';

const SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const EXPORTS = /\bexport\s+(?=(?:const|let|var|async\s+function|function)\s)/g;

// ---- arguments ---------------------------------------------------------------

const argv = process.argv.slice(2);
const id = argv.shift();
if (!id || id.startsWith('-')) {
  console.error('usage: node scripts/try-service.mjs <plugin id> [--ticks n] [--storage json|file] [--fixture tick:url=file] [--log file] [--save file] [--shot png] | --tool name json | --evals');
  process.exit(2);
}
const options = { ticks: null, fixtures: [], storage: '{}', log: null, save: null, shot: null, dark: false, strict: false, tool: null, toolArgs: '{}', evals: false };
while (argv.length) {
  const flag = argv.shift();
  if (flag === '--ticks') options.ticks = Number(argv.shift());
  else if (flag === '--storage') options.storage = argv.shift();
  else if (flag === '--fixture') options.fixtures.push(argv.shift());
  else if (flag === '--log') options.log = resolve(argv.shift());
  else if (flag === '--save') options.save = resolve(argv.shift());
  else if (flag === '--shot') options.shot = resolve(argv.shift());
  else if (flag === '--dark') options.dark = true;
  else if (flag === '--standalone') options.standalone = true;
  else if (flag === '--strict-cors') options.strict = true;
  else if (flag === '--tool') { options.tool = argv.shift(); if (argv[0] && !argv[0].startsWith('--')) options.toolArgs = argv.shift(); }
  else if (flag === '--evals') options.evals = true;
  else { console.error('unknown option ' + flag); process.exit(2); }
}

const folder = join(ROOT, 'plugins', id);
if (!existsSync(folder)) { console.error('no plugin folder ' + folder); process.exit(2); }
const read = path => readFileSync(join(folder, path), 'utf8');
const manifest = JSON.parse(read('manifest.json'));
const yab = manifest.yab || {};
const sites = (/^sites:\s*(.+)$/m.exec(read('BOOST.md')) || [, ''])[1].split(',').map(s => s.trim()).filter(Boolean);
const hosts = Array.isArray(yab.hosts) ? yab.hosts : [];
const allowed = new Set([...sites, ...hosts]);

const lines = [];
function out(text = '') {
  console.log(text);
  lines.push(text);
}
function flushLog() {
  if (options.log) appendFileSync(options.log, lines.join('\n') + '\n');
  lines.length = 0;
}
const size = bytes => bytes >= 1e6 ? (bytes / 1e6).toFixed(1) + ' MB' : bytes >= 1e3 ? (bytes / 1e3).toFixed(1) + ' KB' : bytes + ' B';

// ---- network ----------------------------------------------------------------

function fixtureFor(tick, url) {
  for (const entry of options.fixtures) {
    const match = /^(\*|\d+):(https:\/\/[^=]+)=(.+)$/.exec(entry);
    if (!match) throw Error('bad --fixture ' + entry + ' (want tick:url=file)');
    if ((match[1] === '*' || Number(match[1]) === tick) && match[2] === url) return resolve(ROOT, match[3]);
  }
  return null;
}

function serviceFetch(tick, requests) {
  return async (input, init = {}) => {
    const target = new URL(String(input));
    if (target.protocol !== 'https:' || !allowed.has(target.hostname) || target.port || target.username || target.password) {
      requests.push(`  REFUSED ${target.href} (not one of ${[...allowed].join(', ')})`);
      throw new TypeError('Refused to connect: Content Security Policy allows only ' + [...allowed].join(', '));
    }
    if (init.credentials !== 'omit' || init.redirect !== 'error') throw Error('harness bug: Yab always sends credentials omit, redirect error');
    const method = (init.method || 'GET').toUpperCase();
    const fixture = method === 'GET' ? fixtureFor(tick, target.href) : null;
    if (fixture) {
      const body = readFileSync(fixture, 'utf8');
      requests.push(`  GET ${target.href} -> fixture ${fixture.slice(ROOT.length)} (${size(body.length)})`);
      return new Response(body, { status: 200, headers: { 'content-type': extname(fixture) === '.json' ? 'application/json' : 'text/html' } });
    }
    const started = Date.now();
    const response = await fetch(target, {
      method,
      body: init.body,
      headers: { 'User-Agent': SAFARI, 'Accept-Language': 'en-US,en;q=0.9', Origin: 'null', ...(init.headers || {}) },
      redirect: 'manual',
      signal: init.signal
    });
    const body = await response.arrayBuffer();
    const cors = response.headers.get('access-control-allow-origin');
    const readable = cors === '*' || cors === 'null';
    requests.push(`  ${method} ${target.href} -> ${response.status} ${size(body.byteLength)} ${Date.now() - started} ms` + (readable || !options.strict ? '' : '  CORS: no Access-Control-Allow-Origin for an opaque origin'));
    if (response.status >= 300 && response.status < 400) throw new TypeError('Load failed: redirect refused (' + response.headers.get('location') + ')');
    if (!readable && options.strict) throw new TypeError('Load failed: CORS');
    return new Response(body, { status: response.status, headers: response.headers });
  };
}

// ---- service ----------------------------------------------------------------

async function runTicks() {
  if (!yab.service) { console.error(id + ' has no service'); process.exit(2); }
  const source = read(yab.service).replace(EXPORTS, '');
  let saved = existsSync(resolve(options.storage)) ? readFileSync(resolve(options.storage), 'utf8') : options.storage;
  JSON.parse(saved);
  let lastWake = null;
  const ticks = options.ticks ?? 2;
  const wakes = [];
  out(`# ${id}: ${ticks} ticks, every ${yab.every} in Yab, sites ${[...allowed].join(', ')}, permissions ${(yab.permissions || []).join(', ') || 'none'}`);
  for (let tick = 1; tick <= ticks; tick++) {
    const requests = [];
    const context = vm.createContext({ console, URL, URLSearchParams, TextDecoder, TextEncoder, AbortController, setTimeout, clearTimeout, Response, Headers });
    const wrapped = `(async function (saved, originalFetch) {
const abortTick = new AbortController();
const signal=abortTick.signal, storage=JSON.parse(saved);
const fetch=(url,options={})=>originalFetch(url,{...options,credentials:'omit',redirect:'error',signal});
${source}
let timer;
try { const result=await Promise.race([tick({signal,storage,fetch}),new Promise((_,reject)=>{timer=setTimeout(()=>{abortTick.abort();reject(Error('Tick timed out'))},25000)})]);return JSON.stringify({result,storage}); }
finally {clearTimeout(timer);abortTick.abort()}
})`;
    const started = Date.now();
    let answer, error;
    try {
      const run = vm.runInContext(wrapped, context, { filename: `plugins/${id}/${yab.service}` });
      answer = await run(saved, serviceFetch(tick, requests));
    } catch (problem) { error = problem; }
    out(`\n[${new Date().toISOString()}] tick ${tick} (${((Date.now() - started) / 1000).toFixed(1)} s, ${requests.length} requests)`);
    requests.forEach(line => out(line));
    if (error) { out('  ERROR ' + (error.stack || error).toString().split('\n')[0] + '  (Yab keeps the old storage)'); continue; }
    if (Buffer.byteLength(answer) > 64000) { out(`  ERROR result and storage are ${size(Buffer.byteLength(answer))}, over 64 KB: Yab drops this tick`); continue; }
    const value = JSON.parse(answer);
    saved = JSON.stringify(value.storage ?? {});
    const wake = value.result && value.result.wake;
    if (typeof wake === 'string' && wake) {
      if (wake.length > 8000) out('  wake IGNORED: over 8,000 characters');
      else if (!(yab.permissions || []).includes('yab:task')) out('  wake IGNORED: the manifest lacks yab:task');
      else if (wake === lastWake) out('  wake IGNORED: same as the previous wake');
      else {
        lastWake = wake;
        wakes.push(wake);
        out('  WAKE (starts an agent task, one AI call of the daily ' + (yab.daily_limit ?? 20) + '):');
        wake.split('\n').forEach(line => out('    ' + line));
      }
    } else out('  quiet (no AI)');
    out(`  storage ${size(Buffer.byteLength(saved))}`);
    flushLog();
  }
  flushLog();
  if (options.save) writeFileSync(options.save, JSON.stringify(JSON.parse(saved), null, 2) + '\n');
  return JSON.parse(saved);
}

// ---- tools ------------------------------------------------------------------

function validateArgs(schema, args) {
  for (const key of Object.keys(args)) if (!(key in schema.params)) throw Error('Unknown tool argument: ' + key);
  for (const [key, type] of Object.entries(schema.params)) {
    const bare = type.replace('?', '');
    if (!(key in args)) { if (!type.endsWith('?')) throw Error('Missing argument: ' + key); continue; }
    const value = args[key];
    const ok = bare === 'string' ? typeof value === 'string'
      : bare === 'boolean' ? typeof value === 'boolean'
      : bare === 'number' ? typeof value === 'number'
      : bare === 'integer' ? Number.isInteger(value)
      : bare === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value)
      : bare === 'array' ? Array.isArray(value) : false;
    if (!ok) throw Error(`${key} must be ${bare}.`);
  }
}

async function runTool(name, args) {
  const schema = (yab.tools || {})[name];
  if (!schema) throw Error(`${id} has no tool ${name}`);
  validateArgs(schema, args);
  const origin = new URL('https://' + sites[0] + '/');
  const requests = [];
  const site = async (method, address, body) => {
    const target = new URL(address, origin);
    if (target.origin !== origin.origin || target.username || target.password) throw Error("The request exceeds this tool's approved scope or its task ended.");
    if (method === 'POST') {
      if (!schema.acts) throw Error("The request exceeds this tool's approved scope or its task ended.");
      requests.push(`  POST ${target.href} NOT SENT (Yab asks the person first): ${JSON.stringify(body).slice(0, 300)}`);
      return { harness: 'POST not sent' };
    }
    const started = Date.now();
    const response = await fetch(target, { headers: { Accept: 'application/json', 'User-Agent': SAFARI }, redirect: 'manual' });
    const text = await response.text();
    requests.push(`  GET ${target.href} -> ${response.status} ${size(text.length)} ${Date.now() - started} ms`);
    if (response.status < 200 || response.status > 299 || text.length > 2_000_000) throw Error('The endpoint failed, redirected or returned too much data.' + (response.status === 403 ? ' (' + text.slice(0, 120) + ')' : ''));
    return JSON.parse(text);
  };
  const source = read('tools.js').replace(EXPORTS, '');
  const wrapped = `(async function (args, siteRequest) {
const request=(method,address,body)=>siteRequest(method,address,body);
const site=Object.freeze({json:address=>request('GET',address,null),post:(address,body)=>request('POST',address,body)});
${source}
const selected=${name};
let timer;
try { return await Promise.race([typeof selected==='function'?selected(args,site):selected.run(args,site),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Tool timed out; its effect may be unknown')),30000)})]); }
finally { clearTimeout(timer); }
})`;
  const context = vm.createContext({ console, URL, URLSearchParams, encodeURIComponent, decodeURIComponent, setTimeout, clearTimeout });
  const started = Date.now();
  out(`\n[${new Date().toISOString()}] ${id}.${name} ${JSON.stringify(args)}${schema.acts ? '  (acts: ' + schema.acts + ', asks every call)' : ''}`);
  try {
    const value = await vm.runInContext(wrapped, context, { filename: `plugins/${id}/tools.js` })(JSON.parse(JSON.stringify(args)), site);
    requests.forEach(line => out(line));
    const text = JSON.stringify(value, null, 2);
    out(`  -> ${((Date.now() - started) / 1000).toFixed(1)} s, ${size(text.length)}`);
    out(text.split('\n').slice(0, 60).map(line => '  ' + line).join('\n') + (text.split('\n').length > 60 ? '\n  ...' : ''));
  } catch (error) {
    requests.forEach(line => out(line));
    out('  ERROR ' + error.message);
  }
  flushLog();
}

function readEvals() {
  const text = read('evals.yaml');
  const items = [];
  for (const line of text.split('\n')) {
    const match = /^\s*(?:- )?(ask|tool|args):\s*(.+)$/.exec(line);
    if (!match) continue;
    if (line.trimStart().startsWith('- ')) items.push({});
    const value = match[1] === 'tool' ? match[2].trim() : JSON.parse(match[2]);
    items[items.length - 1][match[1]] = value;
  }
  return items;
}

// ---- app picture ------------------------------------------------------------

async function shoot(storage) {
  if (!yab.app) { console.error(id + ' has no app page'); return; }
  const { webkit } = await import('playwright');
  const policy = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const shell = `<meta charset='utf-8'><meta http-equiv='Content-Security-Policy' content="${policy}"><style>:root{color-scheme:light dark;font:15px -apple-system}body{margin:24px}button,input,textarea{font:inherit}button{padding:7px 12px;border-radius:8px}</style>`;
  const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' };
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname.slice(1));
    const file = join(folder, path);
    if (!path.startsWith('app/') || !types[extname(path)] || !existsSync(file)) { response.writeHead(404); response.end(); return; }
    const text = readFileSync(file, 'utf8');
    response.writeHead(200, { 'content-type': types[extname(path)] });
    response.end(extname(path) === '.html' ? shell + text : text);
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  const browser = await webkit.launch();
  const page = await browser.newPage({ viewport: { width: 720, height: 640 }, deviceScaleFactor: 2, colorScheme: options.dark ? 'dark' : 'light' });
  const problems = [];
  page.on('pageerror', error => problems.push('page error: ' + error.message));
  page.on('console', message => { if (message.type() === 'error') problems.push('console: ' + message.text()); });
  if (!options.standalone) await page.addInitScript(saved => {
    let value = saved;
    window.chrome = { yab: Object.freeze({ storage: Object.freeze({
      get: async () => JSON.parse(JSON.stringify(value)),
      set: async next => { value = JSON.parse(JSON.stringify(next)); }
    }) }) };
  }, storage);
  await page.goto(`http://127.0.0.1:${server.address().port}/${yab.app}`);
  await page.waitForTimeout(400);
  const height = await page.evaluate(() => Math.min(document.documentElement.scrollHeight, 1400));
  await page.setViewportSize({ width: 720, height: Math.max(320, height) });
  await page.screenshot({ path: options.shot });
  await browser.close();
  server.close();
  out(`picture ${options.shot}` + (problems.length ? '\n  ' + problems.join('\n  ') : ''));
  flushLog();
}

// ---- main -------------------------------------------------------------------

if (options.tool) {
  await runTool(options.tool, JSON.parse(options.toolArgs));
} else if (options.evals) {
  for (const example of readEvals()) {
    const schema = (yab.tools || {})[example.tool];
    out(`\n# eval: "${example.ask}"`);
    if (schema && schema.acts) { out(`  skipped running ${example.tool}: it ${schema.acts}s, so Yab asks first; schema check only`); validateArgs(schema, example.args); continue; }
    await runTool(example.tool, example.args);
  }
  flushLog();
} else {
  let storage = JSON.parse(existsSync(resolve(options.storage)) ? readFileSync(resolve(options.storage), 'utf8') : options.storage);
  if (options.ticks !== 0) storage = await runTicks();
  if (options.shot) await shoot(storage);
}
