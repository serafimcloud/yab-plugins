// Article and Comments, for Hacker News.
//
// Plugins cannot open Yab's Split View, so the article is one button above
// the comments: it opens in a new tab, and from there it can join the
// comments in Split View. The rest is what a page can do on its own:
// read-later, new comments since the last visit, new counts on lists.
// Everything is kept in this site's storage on this Mac.
const KEY = 'yab.hn-side-by-side.';
const KEEP_SEEN = 500;
const KEEP_LATER = 200;

function read(name, fallback) {
  try { const value = localStorage.getItem(KEY + name); return value === null ? fallback : JSON.parse(value); } catch { return fallback; }
}
function write(name, value) {
  try { localStorage.setItem(KEY + name, JSON.stringify(value)); } catch {}
}

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  node.append(...children);
  return node;
}

function ago(ms) {
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return minutes <= 1 ? 'a minute ago' : minutes + ' minutes ago';
  const hours = Math.round(minutes / 60);
  if (hours < 48) return hours === 1 ? 'an hour ago' : hours + ' hours ago';
  return Math.round(hours / 24) + ' days ago';
}

const added = [];
boost.cleanup(() => {
  for (const node of added) node.remove();
  for (const row of document.querySelectorAll('.yab-hn-new')) row.classList.remove('yab-hn-new');
});
const keep = node => { added.push(node); return node; };

// ---- read later -----------------------------------------------------------------

let later = read('later', []);
const saved = id => later.some(entry => entry.id === id);
function save(entry, on) {
  later = later.filter(item => item.id !== entry.id);
  if (on) later.unshift({ ...entry, at: Date.now() });
  later = later.slice(0, KEEP_LATER);
  write('later', later);
  drawLater();
}

let laterLink = null;
let panel = null;
function drawLater() {
  const top = document.querySelector('.pagetop');
  if (!top) return;
  if (!laterLink) {
    laterLink = keep(el('a', { href: '#', class: 'yab-hn-later-link', onclick: event => { event.preventDefault(); panel.hidden = !panel.hidden; place(); } }));
    top.append(' | ', laterLink);
    added.push(laterLink.previousSibling);
    panel = keep(el('div', { class: 'yab-hn-later-panel', hidden: true }));
    document.body.append(panel);
    boost.on(document, 'click', event => {
      if (!panel.hidden && event.target instanceof Node && !panel.contains(event.target) && event.target !== laterLink) panel.hidden = true;
    });
  }
  laterLink.textContent = later.length ? 'later (' + later.length + ')' : 'later';
  panel.replaceChildren(...(later.length ? later.map(entry => el('div', { class: 'yab-hn-row' },
    el('a', { href: entry.url || 'item?id=' + entry.id }, entry.title),
    el('a', { href: 'item?id=' + entry.id, style: 'flex: none; color: #828282' }, 'comments'),
    el('button', { type: 'button', title: 'Remove', onclick: () => { save(entry, false); syncButton(); } }, 'Remove'))) : [el('div', { class: 'yab-hn-empty' }, 'Nothing saved yet.')]));
}
function place() {
  const rect = laterLink.getBoundingClientRect();
  panel.style.top = window.scrollY + rect.bottom + 6 + 'px';
  panel.style.left = Math.max(8, window.scrollX + rect.left - 120) + 'px';
}

// "71 comments" (with a no-break space on HN), or null.
function commentCount(link) {
  const match = /^(\d+)\s*comments?$/.exec(link.textContent.replace(/\u00a0/g, ' ').trim());
  return match ? Number(match[1]) : null;
}

// ---- a discussion ---------------------------------------------------------------

let syncButton = () => {};

function discussion() {
  const id = new URLSearchParams(location.search).get('id');
  const story = document.querySelector('table.fatitem tr.athing.submission');
  if (!id || !story) return;
  const link = story.querySelector('.titleline > a');
  const external = link && /^https?:/.test(link.getAttribute('href') ?? '');
  const entry = { id, title: link?.textContent.trim() ?? 'Hacker News', url: external ? link.href : '' };
  const comments = Array.from(document.querySelectorAll('table.comment-tree tr.athing.comtr[id]'));
  const ids = comments.map(row => Number(row.id)).filter(Number.isFinite);

  const seen = read('seen', {});
  const before = seen[id];
  const fresh = before ? comments.filter(row => Number(row.id) > before.max) : [];
  for (const row of fresh) {
    row.classList.add('yab-hn-new');
    const head = row.querySelector('.comhead');
    if (head) head.append(keep(el('span', { class: 'yab-hn-new-tag' }, 'new')));
  }
  // The story's own count ("71 comments") is what lists show later.
  const counted = Array.from(document.querySelectorAll('table.fatitem .subtext a[href^="item?id="]'), a => commentCount(a)).find(n => n !== null);
  seen[id] = { max: Math.max(before?.max ?? 0, ...ids, 0), count: counted ?? comments.length, at: Date.now() };
  const trimmed = Object.entries(seen).sort((a, b) => b[1].at - a[1].at).slice(0, KEEP_SEEN);
  write('seen', Object.fromEntries(trimmed));

  const bar = keep(el('div', { class: 'yab-hn-bar' }));
  if (external) {
    const site = story.querySelector('.sitestr')?.textContent ?? new URL(link.href).hostname;
    bar.append(el('a', { class: 'yab-hn-article', href: link.href, target: '_blank', rel: 'noopener', title: 'Opens in a new tab; put it beside this one with Split View' }, 'Read the article on ' + site + ' ↗'));
  }
  const toggle = el('button', { type: 'button', onclick: () => { save(entry, !saved(id)); syncButton(); } });
  syncButton = () => {
    const on = saved(id);
    toggle.textContent = on ? 'Saved for later' : 'Read later';
    toggle.setAttribute('aria-pressed', String(on));
  };
  syncButton();
  bar.append(toggle);
  if (before) {
    if (fresh.length) {
      let next = 0;
      bar.append(
        el('span', {}, fresh.length + (fresh.length === 1 ? ' new comment' : ' new comments') + ' since ' + ago(before.at)),
        el('button', { type: 'button', onclick: () => {
          const below = fresh.findIndex(row => row.getBoundingClientRect().top > 80);
          next = below >= 0 && below !== next - 1 ? below : next % fresh.length;
          fresh[next].scrollIntoView({ block: 'start', behavior: 'smooth' });
          next = (next + 1) % fresh.length;
        } }, 'Next new ↓'));
    } else {
      bar.append(el('span', { class: 'yab-hn-quiet' }, 'No new comments since ' + ago(before.at)));
    }
  }
  document.querySelector('table.fatitem').after(bar);
}

// ---- lists: new comments on stories already opened ----------------------------------

function lists() {
  const seen = read('seen', {});
  for (const link of document.querySelectorAll('td.subtext a[href^="item?id="]')) {
    const match = /^(\d+)\s*comments?$/.exec(link.textContent.replace(/\u00a0/g, ' ').trim());
    const id = new URLSearchParams(link.getAttribute('href').split('?')[1]).get('id');
    const visit = seen[id];
    if (!match || !visit) continue;
    const fresh = Number(match[1]) - visit.count;
    if (fresh > 0) link.after(keep(el('span', { class: 'yab-hn-count' }, ' (' + fresh + ' new)')));
  }
}

drawLater();
if (location.pathname === '/item') discussion();
else lists();
