// Searches Hacker News (through hn.algolia.com's public API) for new stories
// and comments that mention the words the person set, and wakes the agent
// only for ones it has not reported before.
//
// Storage (shared with app/index.html):
//   words: ["yab", "webkit"]                 set on the app page
//   since: {word: unix seconds}              last search per word
//   seen: [objectID]                         reported items, newest last
//   recent: [{id, kind, word, title, text, by, at}]  shown on the app page
// A word's first search only marks the time, so adding a word never reports
// old threads.

const SEARCH = 'https://hn.algolia.com/api/v1/search_by_date';
const MAX_WORDS = 10;
const OVERLAP = 1800;      // search 30 minutes back again: the index lags a little
const MAX_SEEN = 400;
const MAX_RECENT = 30;
const MAX_REPORTED = 12;

export async function tick({ signal, storage, fetch }) {
  const words = (Array.isArray(storage.words) ? storage.words : [])
    .map(word => String(word).trim()).filter(word => word.length >= 2 && word.length <= 60)
    .slice(0, MAX_WORDS);
  storage.words = words;
  const since = storage.since && typeof storage.since === 'object' ? storage.since : {};
  for (const word of Object.keys(since)) if (!words.includes(word)) delete since[word];
  storage.since = since;
  const seen = new Set(Array.isArray(storage.seen) ? storage.seen : []);
  const now = Math.floor(Date.now() / 1000);
  const found = [];

  for (const word of words) {
    if (signal.aborted) break;
    if (!since[word]) { since[word] = now; continue; }
    const query = new URLSearchParams({
      query: '"' + word.replace(/"/g, '') + '"',
      tags: '(story,comment)',
      numericFilters: 'created_at_i>' + (since[word] - OVERLAP),
      hitsPerPage: '50'
    });
    let hits;
    try {
      const response = await fetch(SEARCH + '?' + query);
      if (!response.ok) { storage.error = 'HTTP ' + response.status; continue; }
      hits = (await response.json()).hits || [];
    } catch (error) {
      storage.error = String(error && error.message || error).slice(0, 120);
      continue;
    }
    delete storage.error;
    since[word] = now;
    const pattern = new RegExp('(^|[^\\p{L}\\p{N}])' + escape(word) + '($|[^\\p{L}\\p{N}])', 'iu');
    for (const hit of hits) {
      if (seen.has(hit.objectID)) continue;
      const kind = (hit._tags || []).includes('comment') ? 'comment' : 'story';
      const title = plain(hit.title || hit.story_title || '');
      const text = plain(hit.comment_text || hit.story_text || '');
      if (!pattern.test([title, text, hit.url || ''].join(' '))) continue;
      seen.add(hit.objectID);
      found.push({ id: hit.objectID, kind, word, title, text: snippet(text, pattern), by: hit.author, at: hit.created_at_i, points: hit.points });
    }
  }

  storage.seen = [...seen].slice(-MAX_SEEN);
  found.sort((a, b) => b.at - a.at);
  storage.recent = [...found, ...(Array.isArray(storage.recent) ? storage.recent : [])].slice(0, MAX_RECENT);
  if (!found.length) return {};
  const lines = found.slice(0, MAX_REPORTED).map(item => {
    const link = 'https://news.ycombinator.com/item?id=' + item.id;
    return item.kind === 'story'
      ? `- Story "${item.title}" by ${item.by} mentions "${item.word}". ${link}`
      : `- ${item.by} on "${item.title}" mentions "${item.word}": "${item.text}" ${link}`;
  });
  if (found.length > MAX_REPORTED) lines.push(`- and ${found.length - MAX_REPORTED} more.`);
  return { wake: ('New on Hacker News:\n' + lines.join('\n')).slice(0, 8000) };
}

function escape(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function plain(html) {
  return String(html)
    .replace(/<[^>]+>/g, ' ')
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&quot;/g, '"').replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

// About 200 characters around the first mention.
function snippet(text, pattern) {
  const match = pattern.exec(text);
  if (!match) return text.slice(0, 200);
  const start = Math.max(0, match.index - 80);
  const part = text.slice(start, start + 200).trim();
  return (start > 0 ? '...' : '') + part + (start + 200 < text.length ? '...' : '');
}
