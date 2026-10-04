#!/usr/bin/env node
// Builds the Store catalog (docs/store.md in the Yab repo) from boosts/, the
// latest check results and the check history.
//
//   node scripts/catalog.mjs [--out out] [--history state/history.json]
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
import { dirname, extname, join } from 'node:path';
import { ROOT, boostIds, canonical, displayHost, envelopeOf, readBoost, rightsOf, rungOf } from './lib/boosts.mjs';

const args = process.argv.slice(2);
const option = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const OUT = join(ROOT, option('--out', 'out'));
const HISTORY = join(ROOT, option('--history', 'state/history.json'));
const KEEP_DAYS = 30;

const iso = date => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback);
const git = (...a) => { try { return execFileSync('git', a, { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };

/// Commits that touched a boost, oldest first: {commit, date, note}.
function versionsOf(id) {
  const lines = git('log', '--abbrev=7', '--format=%h%x09%as%x09%s', '--', `boosts/${id}`).split('\n').filter(Boolean).reverse();
  return lines.map((line, i) => {
    const [commit, date, ...subject] = line.split('\t');
    return { commit, date, note: i === 0 ? 'First version' : subject.join('\t') };
  });
}

/// The last date after the first version when the boost's page files changed.
function fixedOf(id, versions) {
  if (versions.length < 2) return null;
  const changed = new Set(git('log', '--abbrev=7', '--format=%h', '--', `boosts/${id}/page`).split('\n').filter(Boolean));
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
  const ids = boostIds();
  if (git('status', '--porcelain', '--', 'boosts')) console.warn('warning: boosts/ has uncommitted changes; commits and versions describe the last commit');

  rmSync(join(OUT, 'b'), { recursive: true, force: true });
  rmSync(join(OUT, 'store', 'p'), { recursive: true, force: true });
  const items = [];
  for (const id of ids) {
    const boost = readBoost(id);
    const { listing, manifest, boost: md } = boost;
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

    const versions = versionsOf(id);
    const rung = rungOf(manifest, boost.files);
    items.push({
      id,
      name: listing.name,
      intent: listing.intent,
      sites: md.sites,
      host: listing.host ?? displayHost(md.sites[0]),
      rung,
      rights: rightsOf(rung, md.sites.map(displayHost)),
      revision: envelope.revision,
      commit: versions.length ? versions[versions.length - 1].commit : null,
      by: listing.by,
      picks: listing.picks === true,
      added: listing.added,
      fixed: fixedOf(id, versions),
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
  console.log(`catalog.json: ${items.length} items (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')}), ${items.length} packages in ${join(OUT, 'b')}`);
}

main();
