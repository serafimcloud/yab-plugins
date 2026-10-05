#!/usr/bin/env node
// Builds the Store catalog (docs/store.md in the Yab repo) from boosts/ and
// plugins/, the latest check results and the check history.
//
//   node scripts/catalog.mjs [--out out] [--history state/history.json] [--unreviewed]
//
// Plugins (code: the Page, Tool and App rungs) are listed only with a
// review.json ({by, date}, written by the person who read the code), which
// becomes the item's `reviewed`. --unreviewed lists the others too, with
// `reviewed: null`, for trying the catalog locally; Yab installs code only
// from reviewed items.
//
// Writes:
//   out/catalog.json                    format 1, one item per boost
//   out/b/<revision>/package.boost      {"payload", "revision"}, canonical JSON
//   out/store/p/<id>/{before,after}.*   the check's pictures
//   state/history.json, out/state/history.json   per boost, the state of each day
//
// check.state: "works" today; "fix" after failing two checked days running;
// "unchecked" with a note when the check could not run. A single failed day
// keeps the last pass (its time ages out of "Works today" after 36 hours), or
// says "unchecked" when the boost never passed.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { BOOSTS, PLUGINS, ROOT, boostIds, canonical, displayHost, envelopeOf, hostsOf, pluginIds, readBoost, rightsOf, rungOf } from './lib/boosts.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const OUT = resolve(ROOT, option('--out', 'out'));
const HISTORY = resolve(ROOT, option('--history', 'state/history.json'));
const KEEP_DAYS = 30;
const UNREVIEWED = args.includes('--unreviewed');

const iso = date => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };

/// Commits that touched a boost (folder boosts/<id> or plugins/<id>), oldest
/// first: {commit, date, note}. A plugin's review.json is not a version.
function versionsOf(id, folder = `boosts/${id}`) {
  const lines = git('log', '--abbrev=7', '--format=%h%x09%as%x09%s', '--', folder, `:!${folder}/review.json`).split('\n').filter(Boolean).reverse();
  return lines.map((line, i) => {
    const [commit, date, ...subject] = line.split('\t');
    return { commit, date, note: i === 0 ? 'First version' : subject.join('\t') };
  });
}

/// The last date after the first version when the boost's page files changed.
function fixedOf(id, versions, folder = `boosts/${id}`) {
  if (versions.length < 2) return null;
  const changed = new Set(git('log', '--abbrev=7', '--format=%h', '--', `${folder}/page`).split('\n').filter(Boolean));
  const later = versions.slice(1).filter(v => changed.has(v.commit));
  return later.length ? later[later.length - 1].date : null;
}

function checkOf(id, result, record) {
  if (!result) return { state: 'unchecked', at: null, note: 'not checked yet' };
  if (result.state === 'works') return { state: 'works', at: result.at, note: null };
  if (result.state === 'unchecked') return { state: 'unchecked', at: result.at, note: result.note ?? 'check could not run' };
  // fails: count the checked days running that failed, today included.
  let running = 0;
  for (const day of Object.keys(record.days).sort().reverse()) {
    const state = record.days[day];
    if (state === 'fails') running++;
    else if (state === 'works') break;
  }
  if (running >= 2) return { state: 'fix', at: result.at, note: result.note ?? null };
  if (record.lastWorks) return { state: 'works', at: record.lastWorks, note: null };
  return { state: 'unchecked', at: result.at, note: 'check failed once; checking again tomorrow' };
}

function main() {
  const results = readJson(join(OUT, 'results.json'), {});
  const history = readJson(HISTORY, {});
  const entries = [...boostIds().map(id => ({ id, dir: BOOSTS, source: `boosts/${id}` })), ...pluginIds().map(id => ({ id, dir: PLUGINS, source: `plugins/${id}` }))];
  if (git('status', '--porcelain', '--', 'boosts', 'plugins')) console.warn('warning: boosts/ or plugins/ has uncommitted changes; commits and versions describe the last commit');
  const unreviewed = [];

  rmSync(join(OUT, 'b'), { recursive: true, force: true });
  rmSync(join(OUT, 'store', 'p'), { recursive: true, force: true });
  const items = [];
  for (const { id, dir, source } of entries) {
    const boost = readBoost(id, dir);
    const { listing, manifest, boost: md } = boost;
    if (boost.plugin && !boost.review) {
      unreviewed.push(id);
      if (!UNREVIEWED) continue;
    }
    const result = results[id];

    const record = history[id] ?? { days: {}, lastWorks: null };
    if (result?.at) {
      record.days[result.at.slice(0, 10)] = result.state;
      if (result.state === 'works' && (!record.lastWorks || result.at > record.lastWorks)) record.lastWorks = result.at;
    }
    record.days = Object.fromEntries(Object.entries(record.days).sort().slice(-KEEP_DAYS));
    history[id] = record;

    const envelope = envelopeOf(boost);
    const folder = join(OUT, 'b', envelope.revision);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'package.boost'), canonical(envelope));

    let pictures = null;
    if (result?.pictures?.before && result?.pictures?.after) {
      pictures = {};
      for (const side of ['before', 'after']) {
        const source = join(OUT, result.pictures[side]);
        if (!existsSync(source)) { pictures = null; break; }
        const name = side + extname(source);
        mkdirSync(join(OUT, 'store', 'p', id), { recursive: true });
        copyFileSync(source, join(OUT, 'store', 'p', id, name));
        pictures[side] = `/store/p/${id}/${name}`;
      }
    }

    const versions = versionsOf(id, source);
    const rung = rungOf(manifest, boost.files);
    const hosts = hostsOf(manifest);
    // The commit the reviewer read: named in review.json, else the last
    // change to the plugin's own files.
    const reviewed = !boost.plugin ? undefined : boost.review ? {
      by: boost.review.by,
      date: boost.review.date,
      commit: boost.review.commit ?? (versions.length ? versions[versions.length - 1].commit : null),
    } : null;
    items.push({
      id,
      name: listing.name,
      intent: listing.intent,
      sites: md.sites,
      host: listing.host ?? displayHost(md.sites[0]),
      rung,
      rights: rightsOf(rung, md.sites.map(displayHost), hosts),
      ...(reviewed === undefined ? {} : { reviewed }),
      revision: envelope.revision,
      commit: versions.length ? versions[versions.length - 1].commit : null,
      by: listing.by,
      picks: listing.picks === true,
      added: listing.added,
      fixed: fixedOf(id, versions, source),
      check: checkOf(id, result, record),
      kept: null,
      pictures,
      versions: versions.slice().reverse(),
      preview: md.preview,
    });
  }

  const catalog = { format: 1, generated: iso(new Date()), items };
  writeFileSync(join(OUT, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n');
  const sortedHistory = Object.fromEntries(Object.keys(history).sort().map(k => [k, history[k]]));
  for (const path of [HISTORY, join(OUT, 'state', 'history.json')]) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(sortedHistory, null, 2) + '\n');
  }
  const counts = items.reduce((n, item) => ({ ...n, [item.check.state]: (n[item.check.state] ?? 0) + 1 }), {});
  if (unreviewed.length) console.log(`${UNREVIEWED ? 'listed without review' : 'not listed, no review.json'}: ${unreviewed.join(', ')}`);
  console.log(`catalog.json: ${items.length} items (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}), ${items.length} packages in ${join(OUT, 'b')}`);
}

main();
