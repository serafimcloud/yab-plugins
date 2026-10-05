// Shared reading of boost folders. The rules mirror Yab's own reader
// (Sources/Fast/BoostPackage.swift and BoostShare.swift) so a package that
// passes here also verifies in Yab.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const BOOSTS = join(ROOT, 'boosts');
/// Code (Page, Tool, App rungs): reviewed releases only.
export const PLUGINS = join(ROOT, 'plugins');
/// Files a plugin folder keeps for the store, outside the package.
export const STORE_ONLY = new Set(['listing.json', 'review.json']);
export const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9][a-z0-9-]*$/;

/// Sorted keys, no spaces, raw UTF-8: the same bytes as Python's
/// json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)
/// and Swift's JSONEncoder with .sortedKeys and .withoutEscapingSlashes.
export function canonical(value) {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isInteger(value)) throw Error('Canonical JSON takes integers only');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  const keys = Object.keys(value).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + keys.map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
}

export const sha256 = text => createHash('sha256').update(Buffer.from(text, 'utf8')).digest('hex');

/// Every boost id in boosts/ (or plugin id in plugins/), sorted.
export function boostIds(dir = BOOSTS) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(name => !name.startsWith('.') && statSync(join(dir, name)).isDirectory()).sort();
}
export const pluginIds = () => boostIds(PLUGINS);

/// Every file in a boost folder, as {"relative/path": text}, sorted by path.
export function folderFiles(id, dir = BOOSTS) {
  const base = join(dir, id), files = {};
  const walk = dir => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files[relative(base, path).split(sep).join('/')] = readFileSync(path, 'utf8');
    }
  };
  walk(base);
  return files;
}

/// BOOST.md: front matter between "---" lines, then the intent.
export function parseBoostMd(text) {
  if (!text.startsWith('---\n')) throw Error('BOOST.md must start with front matter (---)');
  const end = text.indexOf('\n---', 4);
  if (end < 0) throw Error('BOOST.md front matter is not closed');
  const header = text.slice(4, end), intent = text.slice(end + 4).trim();
  const fields = {}, checks = [];
  for (const raw of header.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('- on ')) { checks.push(line.slice(2)); continue; }
    const match = /^([a-z][a-z-]*):\s*(.*)$/.exec(line);
    if (match) fields[match[1]] = match[2];
  }
  const sites = (fields.sites ?? '').split(',').map(s => s.trim()).filter(Boolean);
  return { name: fields.name, sites, made: fields.made, preview: fields.preview, checks: checks.map(parseCheck), intent };
}

/// The check grammar, exactly as BoostCheck.parse reads it.
export function parseCheck(line) {
  const colon = line.indexOf(': ');
  if (!line.startsWith('on /') || colon < 0) throw Error(`Invalid check: ${line}`);
  const path = line.slice(3, colon), expression = line.slice(colon + 2);
  for (const [prefix, kind] of [['none of ', 'none'], ['some of ', 'some']]) {
    if (expression.startsWith(prefix)) {
      const selector = expression.slice(prefix.length);
      if (!selector) throw Error('A check needs a selector.');
      return { line, path, kind, selector };
    }
  }
  if (expression.startsWith('script ')) {
    const name = expression.slice(7);
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(name)) throw Error('A script check needs a function name.');
    return { line, path, kind: 'script', selector: name };
  }
  const row = expression.indexOf(' per row in ');
  if (row >= 0) {
    const head = expression.slice(0, row);
    const n = /^[0-9]+$/.test(head) ? Number(head) : NaN;
    if (n > 0 && n <= 100) {
      const selector = expression.slice(row + 12);
      if (!selector) throw Error('A row check needs a selector.');
      return { line, path, kind: 'rows', selector, count: n };
    }
  }
  if (expression.startsWith('text ')) {
    const split = expression.lastIndexOf(' in ');
    if (split >= 5) {
      const words = expression.slice(5, split), selector = expression.slice(split + 4);
      if (!words || !selector) throw Error('A text check needs words and a selector.');
      return { line, path, kind: 'text', selector, words };
    }
  }
  throw Error(`Unsupported check: ${line}. Use none of, some of, per row in, or text ... in ....`);
}

/// The rung, worked out from the files the way BoostPackage.read does it.
export function rungOf(manifest, files) {
  const yab = manifest.yab ?? {};
  const scripts = manifest.content_scripts ?? [];
  const permissions = yab.permissions ?? [];
  const sites = matchHosts(manifest);
  if (sites.includes('<all_urls>') || files['commands.json'] || yab.app || yab.service || permissions.some(p => p !== 'yab:ask')) return 'App';
  if (Object.keys(yab.tools ?? {}).length || permissions.length || Object.keys(files).some(p => p.startsWith('skills/'))) return 'Tool';
  // Hosts make a package at least Page: it has code to use them.
  if (scripts.every(s => !(s.js ?? []).length) && !files['checks.js'] && !Object.keys(files).some(p => p.endsWith('.js')) && !hostsOf(manifest).length) return 'Look';
  return 'Page';
}

/// The Keep card's words, from store.md (Look: "No code runs."), with the
/// other hosts a plugin talks to ("Talks to sponsor.ajay.app.").
export function rightsOf(rung, sites, hosts = []) {
  const list = sites.join(', ');
  if (sites.includes('<all_urls>')) return 'Read and change every site you visit.';
  if (rung === 'Look') return `Change how ${list} looks. No code runs.`;
  return `Run code on ${list}. It can read and change these pages.` + (hosts.length ? ` Talks to ${hosts.join(', ')}.` : '');
}

/// The hosts beyond its sites that a plugin's fetch may reach (yab.hosts).
export const hostsOf = manifest => (Array.isArray(manifest?.yab?.hosts) ? manifest.yab.hosts : []);

export function matchHosts(manifest) {
  const hosts = [];
  for (const script of manifest.content_scripts ?? []) {
    for (const pattern of script.matches ?? []) {
      if (pattern === '<all_urls>') { hosts.push(pattern); continue; }
      const match = /^https?:\/\/([^/]+)\//.exec(pattern);
      hosts.push(match ? match[1] : pattern);
    }
  }
  return [...new Set(hosts)];
}

export const displayHost = site => (site.startsWith('www.') ? site.slice(4) : site);

/// Reads one boost folder (or plugin folder, with dir = PLUGINS) into
/// everything the scripts need.
export function readBoost(id, dir = BOOSTS) {
  const base = join(dir, id);
  const files = folderFiles(id, dir);
  const manifest = JSON.parse(files['manifest.json'] ?? 'null');
  const boost = parseBoostMd(files['BOOST.md'] ?? '');
  const listing = JSON.parse(files['listing.json'] ?? 'null');
  const review = files['review.json'] === undefined ? null : JSON.parse(files['review.json']);
  const css = (manifest?.content_scripts ?? []).flatMap(s => s.css ?? []).map(path => files[path] ?? '').join('\n');
  const js = (manifest?.content_scripts ?? []).flatMap(s => s.js ?? []).map(path => files[path] ?? '').join('\n;\n');
  return { id, base, plugin: dir === PLUGINS, files, manifest, boost, listing, review, css, js };
}

/// The files that travel in a package: everything the boost needs to run and
/// be read again (manifest, BOOST.md, the files the manifest names, checks.js
/// and plugin folders). listing.json and review.json stay in the store; they
/// are not the boost, and a review names the revision it read.
export function packageFiles(files) {
  const out = {};
  for (const [path, text] of Object.entries(files)) {
    if (STORE_ONLY.has(path) || path.startsWith('.') || path.split('/').some(part => part.startsWith('.'))) continue;
    out[path] = text;
  }
  return out;
}

/// {revision, payload}: the envelope BoostShare.read verifies.
export function envelopeOf(boost) {
  const payload = { format: 1, id: boost.id, sites: boost.boost.sites, files: packageFiles(boost.files) };
  return { revision: sha256(canonical(payload)), payload };
}
