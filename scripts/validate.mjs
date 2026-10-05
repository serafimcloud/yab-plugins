#!/usr/bin/env node
// Validates every boost folder in boosts/ and plugin folder in plugins/ (or
// the ones named) against the rules Yab enforces when it reads a package,
// plus the store's own listing rules. Plugins carry code: Yab's code rules
// (readable, no dynamic code), `yab.hosts`, and an optional review.json.
//
//   node scripts/validate.mjs [id ...]
//   node scripts/validate.mjs --review <base> [<head>]
//
// --review compares two git revisions and reports what needs a second
// review: new or changed sites, new permissions or code, a new owner, or
// changes to CODEOWNERS and workflows. It reads files through git only and
// never runs anything from the compared tree. In GitHub Actions it writes
// `second_review=true|false` and `reasons=...` to $GITHUB_OUTPUT.
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Script } from 'node:vm';
import {
  BOOSTS, HOST_PATTERN, ID_PATTERN, PLUGINS, ROOT, boostIds, canonical, displayHost, envelopeOf,
  hostsOf, matchHosts, parseBoostMd, pluginIds, readBoost, rungOf,
} from './lib/boosts.mjs';

const MANIFEST_KEYS = new Set(['manifest_version', 'name', 'version', 'description', 'content_scripts', 'yab']);
const SCRIPT_KEYS = new Set(['matches', 'css', 'js', 'run_at', 'all_frames']);
const LISTING_KEYS = new Set(['name', 'intent', 'host', 'by', 'picks', 'preview', 'added']);
const REVIEW_KEYS = new Set(['by', 'date', 'commit']);
// BoostPlugin.parse in Yab, plus hosts (docs/store.md, "Other hosts").
const YAB_KEYS = new Set(['permissions', 'tools', 'app', 'service', 'every', 'daily_limit', 'hosts']);
const PERMISSIONS = new Set(['yab:ask', 'yab:memory', 'yab:route', 'yab:notify', 'yab:summarize', 'yab:translate', 'yab:calendar', 'yab:rows', 'yab:live', 'yab:task']);
const MAX_HOSTS = 4;
// BoostPackage.read: code must be readable and load no code at run time.
const DYNAMIC_CODE = /\beval\s*\(|\bnew\s+Function\s*\(|\bimport\s*\(/i;
const MAX_LINE_BYTES = 2000;
// Bidi controls, zero-width characters, BOM and line/paragraph separators.
const INVISIBLE = new RegExp('[' + [[0x202A, 0x202E], [0x2066, 0x2069], [0x200B, 0x200D], [0xFEFF, 0xFEFF], [0x2028, 0x2029]].map(([a, b]) => String.fromCharCode(a) + '-' + String.fromCharCode(b)).join('') + ']');
const EM_DASH = String.fromCharCode(0x2014);
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/;

function validPath(path) {
  return path.length > 0 && Buffer.byteLength(path) <= 180 && !path.startsWith('/') && !path.includes('\\')
    && !path.includes(':') && !path.includes('\0') && path.split('/').length <= 9
    && path.split('/').every(part => part && !part.startsWith('.'));
}

function patternHost(pattern) {
  const match = /^https?:\/\/([a-z0-9.-]+)\/[^?#]*$/.exec(pattern);
  return match && HOST_PATTERN.test(match[1]) ? match[1] : null;
}

function globMatch(pattern, url) {
  const u = new URL(pattern), target = new URL(url);
  if (u.protocol !== target.protocol || u.hostname !== target.hostname) return false;
  const regex = new RegExp('^' + u.pathname.split('*').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return regex.test(target.pathname || '/');
}

/// The code rules for one .js or .html file.
function codeProblems(path, text) {
  const problems = [];
  const lines = text.split(/\r\n|\r|\n/);
  const long = lines.findIndex(line => Buffer.byteLength(line) > MAX_LINE_BYTES);
  if (long >= 0) problems.push(`${path}:${long + 1}: line over ${MAX_LINE_BYTES} bytes; code must be readable, not minified`);
  const dynamic = lines.findIndex(line => DYNAMIC_CODE.test(line));
  if (dynamic >= 0) problems.push(`${path}:${dynamic + 1}: eval, new Function and import() are not allowed (also in comments and strings)`);
  if (DYNAMIC_CODE.test(text) && dynamic < 0) problems.push(`${path}: eval, new Function or import() across lines`);
  // Page scripts and checks run as the body of function(boost) { ... }.
  // Services and tools are modules: Yab drops `export` before declarations
  // (BoostServices, BoostToolRuntime) and runs them in a blank page.
  if (path.endsWith('.js') && !path.endsWith('.mjs')) {
    const module = path === 'service.js' || path === 'tools.js';
    const code = module ? text.replace(/\bexport\s+(?=(?:const|let|var|async\s+function|function)\s)/g, '') : text;
    try { new Script('(async function (boost) {\n' + code + '\n})', { filename: path }); }
    catch (error) { problems.push(`${path}: does not parse: ${error.message}`); }
    if (module && /\bexport\b/.test(code)) problems.push(`${path}: export only before const, let, var or function declarations`);
  }
  return problems;
}

export function validate(id, dir = BOOSTS) {
  const problems = [];
  const fail = message => problems.push(message);
  const plugin = dir === PLUGINS;
  if (!ID_PATTERN.test(id) || id.length > 64) fail(`folder name "${id}" must be lowercase letters, numbers and single hyphens, at most 64 characters`);
  let boost;
  try { boost = readBoost(id, dir); } catch (error) { return [`cannot read: ${error.message}`]; }
  const { files, manifest, listing } = boost;

  for (const required of ['manifest.json', 'BOOST.md', 'listing.json']) if (!(required in files)) fail(`missing ${required}`);
  for (const [path, text] of Object.entries(files)) {
    if (!validPath(path)) fail(`invalid file path ${path}`);
    if (INVISIBLE.test(text)) fail(`${path} contains invisible or direction-changing Unicode`);
    if (CONTROL.test(text)) fail(`${path} contains control characters`);
    if (text.includes(EM_DASH)) fail(`${path} contains an em dash; use a comma, colon or full stop`);
  }
  const packaged = envelopeOf(boost).payload.files;
  if (Object.keys(packaged).length > 32 || Object.values(packaged).reduce((n, t) => n + Buffer.byteLength(t), 0) > 512_000) fail('a boost may contain at most 32 files and 512 KB');
  if (!manifest || typeof manifest !== 'object') return [...problems, 'manifest.json is not a JSON object'];

  // Manifest: MV3, named sites only, the keys Yab supports.
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
  if (typeof manifest.name !== 'string' || !manifest.name.trim() || manifest.name.length > 100) fail('manifest needs a name of at most 100 characters');
  if (typeof manifest.version !== 'string' || !/^\d+(\.\d+){0,3}$/.test(manifest.version)) fail('manifest needs a version like 1.0.0');
  for (const key of Object.keys(manifest)) if (!MANIFEST_KEYS.has(key)) fail(`manifest key "${key}" is not supported; declare plugin capabilities under "yab"`);
  const scripts = manifest.content_scripts;
  // A plugin may have no page scripts when it brings tools, an app page or a
  // service (BoostPackage.read).
  const yab = manifest.yab && typeof manifest.yab === 'object' ? manifest.yab : {};
  const pageless = plugin && scripts === undefined && (Object.keys(yab.tools ?? {}).length > 0 || !!yab.app || !!yab.service);
  if (!pageless && (!Array.isArray(scripts) || !scripts.length || scripts.length > 8)) fail('manifest needs one to eight content_scripts (or, for a plugin, tools, an app or a service)');
  for (const script of Array.isArray(scripts) ? scripts : []) {
    for (const key of Object.keys(script)) if (!SCRIPT_KEYS.has(key)) fail(`content_scripts key "${key}" is not supported`);
    if (script.all_frames !== undefined && script.all_frames !== false) fail('content scripts run in the main frame only');
    if (script.run_at !== undefined && !['document_end', 'document_idle'].includes(script.run_at)) fail('run_at must be document_end or document_idle');
    if (!Array.isArray(script.matches) || !script.matches.length) fail('each content script needs matches');
    for (const pattern of script.matches ?? []) if (!patternHost(pattern)) fail(`match pattern ${pattern} must be https://<exact host>/<path>, no wildcard hosts`);
    const css = script.css ?? [], js = script.js ?? [];
    if (!css.length && !js.length) fail('each content script needs css or js files');
    for (const file of [...css, ...js]) if (!validPath(file) || !(file in files)) fail(`missing content file ${file}`);
    for (const file of css) {
      const text = files[file] ?? '';
      if (text.includes('\\')) fail(`${file}: no backslash escapes in stylesheets`);
      if (/url\s*\(|@import|image-set\s*\(/i.test(text)) fail(`${file}: stylesheets must not load URLs, imports or image sets (no url(...), @import, image-set)`);
      if (/url\(\s*['"]?https?:/i.test(text)) fail(`${file}: remote URL in CSS`);
    }
  }

  // BOOST.md: front matter, checks, intent.
  let md;
  try { md = parseBoostMd(files['BOOST.md'] ?? ''); } catch (error) { fail(`BOOST.md: ${error.message}`); }
  if (md) {
    if (!md.name) fail('BOOST.md needs name');
    if (md.name !== manifest.name) fail(`BOOST.md name "${md.name}" differs from manifest name "${manifest.name}"`);
    if (!md.sites.length || md.sites.length > 8) fail('BOOST.md needs one to eight sites');
    for (const site of md.sites) if (!HOST_PATTERN.test(site) || site !== site.toLowerCase()) fail(`site ${site} must be an exact lowercase host`);
    const hosts = matchHosts(manifest);
    if (!pageless && canonical([...hosts].sort()) !== canonical([...md.sites].sort())) fail(`sites in BOOST.md (${md.sites.join(', ')}) differ from manifest matches (${hosts.join(', ')})`);
    if (!md.made) fail('BOOST.md needs made');
    if (!md.intent || md.intent.length > 8000) fail('BOOST.md needs the intent below the front matter, at most 8,000 characters');
    // Without page scripts there is no page to check; the catalog says so.
    if (!md.checks.length && !pageless) fail('BOOST.md needs at least one check; the store lists only boosts with checks');
    if (md.checks.length && pageless) fail('checks run on pages; a plugin without page scripts has none');
    if (md.checks.length > 30) fail('use at most 30 checks');
    if (md.checks.some(c => c.kind === 'script') && !files['checks.js']) fail('script checks need checks.js');
    if (!md.preview) fail('BOOST.md needs preview');
    else {
      try {
        const url = new URL(md.preview);
        if (url.protocol !== 'https:') fail('preview must be https');
        if (!md.sites.includes(url.hostname)) fail(`preview host ${url.hostname} is not one of the sites`);
        if (!pageless && !(scripts ?? []).some(s => (s.matches ?? []).some(p => patternHost(p) && globMatch(p, md.preview)))) fail('preview is not matched by any content script');
      } catch { fail(`preview ${md.preview} is not a URL`); }
    }
  }

  // Look boosts carry no code at all; plugins carry code under Yab's rules.
  const rung = rungOf(manifest, files);
  if (!plugin) {
    if (rung === 'Look' && Object.keys(files).some(p => p.endsWith('.js') || p.endsWith('.html'))) fail('Look boosts contain no JavaScript or HTML');
    if (rung !== 'Look') fail(`rung is ${rung}: code is shared only through a reviewed plugin release (plugins/), not as a boost listing`);
    if (manifest.yab !== undefined) fail('boosts have no "yab" metadata; plugins go in plugins/');
    if ('review.json' in files) fail('review.json belongs to plugins/');
  } else {
    if (rung === 'Look') fail('a plugin without code is a Look boost: move it to boosts/');
    for (const [path, text] of Object.entries(files)) {
      if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.html')) problems.push(...codeProblems(path, text));
    }
    pluginMetadata(manifest, md, files, fail);
    if ('review.json' in files) reviewRecord(boost.review, fail);
  }

  // listing.json: the store's words.
  if (!listing || typeof listing !== 'object') fail('listing.json is not a JSON object');
  else {
    for (const key of Object.keys(listing)) if (!LISTING_KEYS.has(key)) fail(`listing key "${key}" is not supported`);
    for (const key of LISTING_KEYS) if (!(key in listing)) fail(`listing needs ${key}`);
    if (md && listing.name !== md.name) fail('listing name differs from BOOST.md name');
    if (md && listing.intent !== md.intent) fail('listing intent differs from the intent in BOOST.md');
    if (md && listing.preview !== md.preview) fail('listing preview differs from BOOST.md preview');
    if (md && md.sites.length && listing.host !== displayHost(md.sites[0])) fail(`listing host "${listing.host}" must be "${displayHost(md.sites[0])}" (first site without www.)`);
    if (typeof listing.by !== 'string' || !listing.by.trim()) fail('listing needs by');
    if (typeof listing.picks !== 'boolean') fail('listing picks must be true or false');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(listing.added ?? '')) fail('listing added must be YYYY-MM-DD');
  }
  return problems;
}

/// manifest.yab: the keys Yab reads, its permissions, and the other hosts.
function pluginMetadata(manifest, md, files, fail) {
  const yab = manifest.yab;
  if (yab === undefined) return;
  if (!yab || typeof yab !== 'object' || Array.isArray(yab)) { fail('manifest "yab" must be an object'); return; }
  for (const key of Object.keys(yab)) if (!YAB_KEYS.has(key)) fail(`yab key "${key}" is not supported`);
  if (yab.permissions !== undefined) {
    if (!Array.isArray(yab.permissions)) fail('yab.permissions must be an array');
    else for (const permission of yab.permissions) if (!PERMISSIONS.has(permission)) fail(`unknown Yab permission ${permission}`);
  }
  if (yab.tools !== undefined) {
    if (!yab.tools || typeof yab.tools !== 'object' || Array.isArray(yab.tools)) fail('yab.tools must be an object of tool definitions');
    else if (!files['tools.js'] || Object.keys(yab.tools).length > 20) fail('tool plugins need tools.js and at most 20 tool definitions');
  }
  for (const key of ['app', 'service']) {
    if (yab[key] !== undefined && (typeof yab[key] !== 'string' || !(yab[key] in files))) fail(`missing plugin file for yab.${key}`);
  }
  if (typeof yab.app === 'string' && !(yab.app.startsWith('app/') && yab.app.endsWith('.html'))) fail('yab.app must be an HTML file inside app/');
  if (yab.service !== undefined) {
    const every = /^([1-9][0-9]*)(m|h|d)$/.exec(yab.every ?? '');
    const seconds = every ? Number(every[1]) * { m: 60, h: 3600, d: 86400 }[every[2]] : 0;
    if (!every || seconds < 900 || seconds > 604800) fail('a service needs yab.every from 15m to 7d, such as 30m, 1h or 1d');
  } else if (yab.every !== undefined) fail('yab.every goes with a service');
  if (yab.tools && typeof yab.tools === 'object' && !Array.isArray(yab.tools)) {
    const TYPES = ['string', 'boolean', 'number', 'integer', 'object', 'array'];
    for (const [name, tool] of Object.entries(yab.tools)) {
      if (!/^[a-z][a-z0-9_]{0,47}$/.test(name)) fail(`tool name ${name} must be lowercase letters, digits and underscores`);
      if (!tool || typeof tool !== 'object' || typeof tool.description !== 'string' || !tool.description || tool.description.length > 500) { fail(`tool ${name} needs a description of at most 500 characters`); continue; }
      for (const key of Object.keys(tool)) if (!['description', 'params', 'acts'].includes(key)) fail(`tool ${name}: key "${key}" is not supported`);
      const params = tool.params ?? null;
      if (!params || typeof params !== 'object' || Object.keys(params).length > 20 || Object.values(params).some(t => typeof t !== 'string' || !TYPES.includes(t.replace(/\?$/, '')))) fail(`tool ${name}: params must map up to 20 names to ${TYPES.join(', ')} (? for optional)`);
      if (tool.acts !== undefined && !['post', 'send', 'pay', 'delete', 'write'].includes(tool.acts)) fail(`tool ${name}: acts must be post, send, pay, delete or write`);
    }
    if (typeof files['tools.js'] === 'string') {
      for (const name of Object.keys(yab.tools)) if (!new RegExp(`\\bexport\\s+(?:async\\s+)?function\\s+${name}\\b`).test(files['tools.js'])) fail(`tools.js does not export ${name}`);
    }
  }
  if (typeof files['service.js'] === 'string' && yab.service === 'service.js' && !/\bexport\s+async\s+function\s+tick\b/.test(files['service.js'])) fail('service.js must export async function tick');
  if (yab.daily_limit !== undefined && !(Number.isInteger(yab.daily_limit) && yab.daily_limit >= 1 && yab.daily_limit <= 100)) fail('yab.daily_limit must be a whole number from 1 to 100');
  if (yab.hosts !== undefined) {
    const hosts = yab.hosts;
    if (!Array.isArray(hosts) || !hosts.length || hosts.length > MAX_HOSTS) { fail(`yab.hosts must list one to ${MAX_HOSTS} hosts`); return; }
    if (new Set(hosts).size !== hosts.length) fail('yab.hosts lists a host twice');
    for (const host of hosts) {
      if (typeof host !== 'string' || !HOST_PATTERN.test(host) || host !== host.toLowerCase()) fail(`yab.hosts: ${host} must be an exact lowercase host name, such as sponsor.ajay.app (no scheme, port, path or wildcard)`);
      else if (/^\d+(\.\d+){3}$/.test(host)) fail(`yab.hosts: ${host} must be a name, not an IP address`);
      else if (md?.sites.includes(host)) fail(`yab.hosts: ${host} is already one of the sites`);
    }
  }
}

/// review.json, written by the reviewer after reading the code: {by, date, commit?}.
function reviewRecord(review, fail) {
  if (!review || typeof review !== 'object' || Array.isArray(review)) { fail('review.json must be an object'); return; }
  for (const key of Object.keys(review)) if (!REVIEW_KEYS.has(key)) fail(`review key "${key}" is not supported`);
  if (typeof review.by !== 'string' || !review.by.trim()) fail('review.json needs by');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(review.date ?? '')) fail('review.json date must be YYYY-MM-DD');
  if (review.commit !== undefined && !/^[0-9a-f]{7,40}$/.test(review.commit)) fail('review.json commit must be a git commit hash');
}

// ---- second review ----------------------------------------------------------

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
const show = (rev, path) => { try { return git('show', `${rev}:${path}`); } catch { return null; } };
const json = text => { try { return JSON.parse(text); } catch { return null; } };
const sitesAt = (rev, id) => { try { return parseBoostMd(show(rev, `boosts/${id}/BOOST.md`) ?? '').sites; } catch { return []; } };

export function review(base, head = 'HEAD') {
  const reasons = [];
  const changed = git('diff', '--name-only', `${base}...${head}`).split('\n').filter(Boolean);
  for (const path of changed) {
    if (path === 'CODEOWNERS' || path.startsWith('.github/')) reasons.push(`${path} changed`);
  }
  const owners = new Set();
  for (const id of git('ls-tree', '--name-only', `${base}:boosts`).split('\n').filter(Boolean)) {
    const by = json(show(base, `boosts/${id}/listing.json`))?.by;
    if (by) owners.add(by);
  }
  // Code always gets a second reviewer.
  const plugins = [...new Set(changed.filter(p => p.startsWith('plugins/') && p.split('/').length > 2).map(p => p.split('/')[1]))];
  for (const id of plugins) {
    const paths = changed.filter(p => p.startsWith(`plugins/${id}/`));
    if (paths.some(p => p !== `plugins/${id}/listing.json`)) reasons.push(`${id}: plugin code or metadata changed (${paths.map(p => p.slice(`plugins/${id}/`.length)).join(', ')})`);
  }
  const ids = [...new Set(changed.filter(p => p.startsWith('boosts/')).map(p => p.split('/')[1]))];
  for (const id of ids) {
    const before = json(show(base, `boosts/${id}/manifest.json`)), after = json(show(head, `boosts/${id}/manifest.json`));
    const listingBefore = json(show(base, `boosts/${id}/listing.json`)), listingAfter = json(show(head, `boosts/${id}/listing.json`));
    if (!after) continue;
    const sitesBefore = sitesAt(base, id), sitesAfter = sitesAt(head, id);
    if (before && canonical([...sitesBefore].sort()) !== canonical([...sitesAfter].sort())) reasons.push(`${id}: sites changed (${sitesBefore.join(', ')} -> ${sitesAfter.join(', ')})`);
    const hostsBefore = before ? matchHosts(before) : [], hostsAfter = matchHosts(after);
    if (before && canonical(hostsBefore.sort()) !== canonical(hostsAfter.sort())) reasons.push(`${id}: manifest matches changed`);
    const capabilities = m => canonical({ yab: m?.yab ?? null, js: (m?.content_scripts ?? []).flatMap(s => s.js ?? []) });
    if (before ? capabilities(before) !== capabilities(after) : capabilities(after) !== capabilities({})) reasons.push(`${id}: permissions or code changed`);
    if (listingBefore && listingAfter && listingBefore.by !== listingAfter.by) reasons.push(`${id}: owner changed (${listingBefore.by} -> ${listingAfter.by})`);
    if (!listingBefore && listingAfter && !owners.has(listingAfter.by)) reasons.push(`${id}: new owner ${listingAfter.by}`);
  }
  return reasons;
}

// ---- main -------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  if (args[0] === '--review') {
    const reasons = review(args[1] ?? 'origin/main', args[2] ?? 'HEAD');
    console.log(reasons.length ? `Second review needed:\n- ${reasons.join('\n- ')}` : 'No second review needed.');
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `second_review=${reasons.length ? 'true' : 'false'}\nreasons<<EOF\n${reasons.join('\n')}\nEOF\n`);
    }
    process.exit(0);
  }
  const boosts = boostIds(), plugins = pluginIds();
  const ids = args.length ? args : [...boosts, ...plugins];
  let failed = 0;
  for (const id of ids) {
    const dir = existsSync(join(BOOSTS, id)) ? BOOSTS : existsSync(join(PLUGINS, id)) ? PLUGINS : null;
    if (!dir) { console.error(`${id}: no such boost or plugin`); failed++; continue; }
    const problems = validate(id, dir);
    // One id names one package in the catalog.
    if (boosts.includes(id) && plugins.includes(id)) problems.push('the same id is in boosts/ and plugins/');
    if (problems.length) { failed++; console.error(`${dir === PLUGINS ? 'plugins/' : ''}${id}:\n  - ${problems.join('\n  - ')}`); }
  }
  const count = (list, word) => `${list.filter(id => ids.includes(id)).length} ${word}`;
  console.log(`${ids.length - failed}/${ids.length} valid (${count(boosts, 'boosts')}, ${count(plugins, 'plugins')})`);
  process.exit(failed ? 1 : 0);
}
