// Checks the watched repositories' releases on GitHub's public API and wakes
// the agent with a short "what's new" when one publishes a new release.
//
// Storage (shared with app/index.html):
//   repos: [{repo: "owner/name", pre: false, tag, name, published, url, checked, error}]
// A repository's first check only records its latest release, so adding one
// never reports old news.

const API = 'https://api.github.com/repos/';
const MAX_REPOS = 20;
const BUDGET_MS = 18000;

export async function tick({ signal, storage, fetch }) {
  const started = Date.now();
  const repos = (Array.isArray(storage.repos) ? storage.repos : [])
    .filter(entry => entry && /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(entry.repo))
    .slice(0, MAX_REPOS);
  storage.repos = repos;
  const news = [];

  for (const entry of [...repos].sort((a, b) => (a.checked || 0) - (b.checked || 0))) {
    if (signal.aborted || Date.now() - started > BUDGET_MS) break;
    let latest;
    try {
      // Stable releases come from /releases/latest; with pre-releases on,
      // the newest of the last few releases counts.
      const response = await fetch(API + entry.repo + (entry.pre ? '/releases?per_page=5' : '/releases/latest'));
      if (response.status === 403 || response.status === 429) { storage.limited = Date.now(); break; }
      if (response.status === 404 && !entry.pre) {
        const exists = await fetch(API + entry.repo);
        entry.checked = Date.now();
        if (exists.ok) { delete entry.error; entry.tag = entry.tag || null; } else entry.error = 'No such public repository.';
        continue;
      }
      if (!response.ok) { entry.error = 'HTTP ' + response.status; entry.checked = Date.now(); continue; }
      const value = await response.json();
      latest = Array.isArray(value) ? value.find(release => !release.draft) : value;
    } catch (error) {
      entry.error = String(error && error.message || error).slice(0, 120);
      continue;
    }
    delete entry.error;
    const first = !entry.checked;
    entry.checked = Date.now();
    if (!latest || latest.tag_name === entry.tag) continue;
    const known = entry.tag;
    entry.tag = latest.tag_name;
    entry.name = (latest.name || latest.tag_name).slice(0, 80);
    entry.published = latest.published_at;
    entry.url = latest.html_url;
    if (first || !known) continue;
    const day = (latest.published_at || '').slice(0, 10);
    news.push(`${entry.repo} ${latest.tag_name}${latest.prerelease ? ' (pre-release)' : ''}, ${day}, after ${known}. What's new: ${gist(latest.body)} ${latest.html_url}`);
  }
  if (news.length) return { wake: ('New releases:\n' + news.join('\n')).slice(0, 8000) };
  return {};
}

// The first few meaningful lines of release notes, without Markdown noise.
function gist(body) {
  const lines = String(body || '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .split(/\r?\n/)
    .filter(line => !/^\s*#/.test(line))
    .map(line => line.replace(/^\s*(?:[-*+]|\d+\.|#+)\s*/, '').replace(/[*_`>]/g, '').trim())
    .filter(line => line.length > 3 && !/^(what'?s changed|full changelog|new contributors|changelog|release notes|highlights|to install|to upgrade|windows:|thanks to|released on|@)/i.test(line) && !/^https?:\/\//.test(line));
  const text = lines.slice(0, 4).join('; ');
  if (!text) return 'the notes are only a link, see the release.';
  return text.length > 320 ? text.slice(0, 317).replace(/\s+\S*$/, '') + '...' : text;
}
