#!/usr/bin/env node
// Validates every boost folder (or the ones named) against the rules Yab
// enforces when it reads a package, plus the store's own listing rules.
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
import {
  BOOSTS, HOST_PATTERN, ID_PATTERN, ROOT, boostIds, canonical, displayHost, envelopeOf,
  matchHosts, parseBoostMd, readBoost, rungOf,
} from './lib/boosts.mjs';

const MANIFEST_KEYS = new Set(['manifest_version', 'name', 'version', 'description', 'content_scripts', 'yab']);
const SCRIPT_KEYS = new Set(['matches', 'css', 'js', 'run_at', 'all_frames']);
const LISTING_KEYS = new Set(['name', 'intent', 'host', 'by', 'picks', 'preview', 'added']);
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

export function validate(id) {
  const problems = [];
  const fail = message => problems.push(message);
  if (!ID_PATTERN.test(id) || id.length > 64) fail(`folder name "${id}" must be lowercase letters, numbers and single hyphens, at most 64 characters`);
  let boost;
  try { boost = readBoost(id); } catch (error) { return [`cannot read: ${error.message}`]; }
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
  if (!Array.isArray(scripts) || !scripts.length || scripts.length > 8) fail('manifest needs one to eight content_scripts');
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
    if (canonical([...hosts].sort()) !== canonical([...md.sites].sort())) fail(`sites in BOOST.md (${md.sites.join(', ')}) differ from manifest matches (${hosts.join(', ')})`);
    if (!md.made) fail('BOOST.md needs made');
    if (!md.intent || md.intent.length > 8000) fail('BOOST.md needs the intent below the front matter, at most 8,000 characters');
    if (!md.checks.length) fail('BOOST.md needs at least one check; the store lists only boosts with checks');
    if (md.checks.length > 30) fail('use at most 30 checks');
    if (md.checks.some(c => c.kind === 'script') && !files['checks.js']) fail('script checks need checks.js');
    if (!md.preview) fail('BOOST.md needs preview');
    else {
      try {
        const url = new URL(md.preview);
        if (url.protocol !== 'https:') fail('preview must be https');
        if (!md.sites.includes(url.hostname)) fail(`preview host ${url.hostname} is not one of the sites`);
        if (!(scripts ?? []).some(s => (s.matches ?? []).some(p => patternHost(p) && globMatch(p, md.preview)))) fail('preview is not matched by any content script');
      } catch { fail(`preview ${md.preview} is not a URL`); }
    }
  }

  // Look boosts carry no code at all.
  const rung = rungOf(manifest, files);
  if (rung === 'Look' && Object.keys(files).some(p => p.endsWith('.js') || p.endsWith('.html'))) fail('Look boosts contain no JavaScript or HTML');
  if (rung !== 'Look') fail(`rung is ${rung}: code is shared only through a reviewed plugin release (plugins/), not as a boost listing`);

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

// ---- second review ----------------------------------------------------------

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
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
  const ids = args.length ? args : boostIds();
  let failed = 0;
  for (const id of ids) {
    if (!existsSync(join(BOOSTS, id))) { console.error(`${id}: no such boost`); failed++; continue; }
    const problems = validate(id);
    if (problems.length) { failed++; console.error(`${id}:\n  - ${problems.join('\n  - ')}`); }
  }
  console.log(`${ids.length - failed}/${ids.length} boosts valid`);
  process.exit(failed ? 1 : 0);
}
