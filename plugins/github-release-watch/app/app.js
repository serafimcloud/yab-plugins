// The watched repositories live in the plugin's service storage, which this
// page reads and writes through chrome.yab.storage. Outside Yab (or in a Yab
// without that bridge) a stand-in keeps the list in this page's own storage.
const MAX_REPOS = 20;
const shared = window.chrome && window.chrome.yab && window.chrome.yab.storage;
const store = shared || standIn('github-release-watch');

function standIn(key) {
  let memory = {};
  return {
    async get() {
      try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return memory; }
    },
    async set(value) {
      memory = value;
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* memory only */ }
    }
  };
}

const list = document.getElementById('list');
const empty = document.getElementById('empty');
const hint = document.getElementById('hint');
const field = document.getElementById('field');
if (!shared) {
  const note = document.getElementById('note');
  note.textContent = 'Preview: this list is saved in this page only, so the hourly check does not see it yet.';
  note.hidden = false;
}

function repoOf(text) {
  const value = text.trim().replace(/\.git$/, '').replace(/\/+$/, '');
  const link = /^(?:https?:\/\/)?(?:www\.)?github\.com\/([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)/.exec(value);
  if (link) return link[1];
  return /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(value) ? value : null;
}

async function change(update) {
  const state = await store.get();
  state.repos = Array.isArray(state.repos) ? state.repos : [];
  const message = update(state);
  await store.set(state);
  render();
  return message;
}

async function add(text) {
  const repo = repoOf(text);
  if (!repo) { say('Use owner/repo or a github.com link.', true); return; }
  const message = await change(state => {
    if (state.repos.some(entry => entry.repo.toLowerCase() === repo.toLowerCase())) return 'Already watched.';
    if (state.repos.length >= MAX_REPOS) return 'You can watch up to 20 repositories. Stop one first.';
    state.repos.push({ repo, pre: false });
    return 'Watching ' + repo + '. Its next release will show up here and in Yab.';
  });
  say(message, message.startsWith('You can'));
}

function say(text, bad) {
  hint.textContent = text;
  hint.className = bad ? 'hint bad' : 'hint';
}

function since(iso) {
  if (!iso) return '';
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000);
  return days < 1 ? 'released today' : days === 1 ? 'released yesterday' : days < 60 ? `released ${days} days ago` : 'released ' + iso.slice(0, 10);
}

function row(entry) {
  const li = document.createElement('li');
  const left = document.createElement('div');
  const name = document.createElement('a');
  name.className = 'name';
  name.href = entry.url || `https://github.com/${entry.repo}/releases`;
  name.target = '_blank';
  name.textContent = entry.repo;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = entry.error ? entry.error
    : !entry.checked ? 'not checked yet'
    : entry.tag ? [entry.tag, since(entry.published)].filter(Boolean).join(' · ')
    : 'no releases yet';
  if (entry.error) meta.classList.add('bad');
  left.append(name, meta);

  const right = document.createElement('div');
  right.className = 'right';
  const pre = document.createElement('label');
  pre.className = 'meta';
  const box = document.createElement('input');
  box.type = 'checkbox';
  box.checked = !!entry.pre;
  box.style.flex = 'none';
  box.addEventListener('change', () => change(state => {
    const found = state.repos.find(item => item.repo === entry.repo);
    if (found) found.pre = box.checked;
  }));
  pre.append(box, ' Pre-releases');
  const stop = document.createElement('button');
  stop.className = 'quiet';
  stop.textContent = 'Stop';
  stop.title = 'Stop watching';
  stop.addEventListener('click', () => change(state => { state.repos = state.repos.filter(item => item.repo !== entry.repo); }));
  right.append(pre, stop);
  li.append(left, right);
  return li;
}

async function render() {
  const state = await store.get();
  const repos = Array.isArray(state.repos) ? state.repos : [];
  list.replaceChildren(...repos.map(row));
  empty.hidden = repos.length > 0;
  if (state.limited && Date.now() - state.limited < 3600000) say('GitHub asked Yab to slow down; the next check catches up.', true);
}

document.getElementById('add').addEventListener('submit', event => {
  event.preventDefault();
  add(field.value).then(() => { field.value = ''; });
});

const wanted = new URLSearchParams(location.search).get('add');
if (wanted) add(wanted); else render();
