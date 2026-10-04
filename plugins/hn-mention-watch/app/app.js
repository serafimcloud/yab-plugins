// The watched words live in the plugin's service storage, which this page
// reads and writes through chrome.yab.storage. Outside Yab (or in a Yab
// without that bridge) a stand-in keeps them in this page's own storage.
const MAX_WORDS = 10;
const shared = window.chrome && window.chrome.yab && window.chrome.yab.storage;
const store = shared || standIn('hn-mention-watch');

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

const words = document.getElementById('words');
const list = document.getElementById('list');
const empty = document.getElementById('empty');
const recentTitle = document.getElementById('recent-title');
const hint = document.getElementById('hint');
const field = document.getElementById('field');
if (!shared) {
  const note = document.getElementById('note');
  note.textContent = 'Preview: these words are saved in this page only, so the search does not see them yet.';
  note.hidden = false;
}

async function change(update) {
  const state = await store.get();
  state.words = Array.isArray(state.words) ? state.words : [];
  const message = update(state);
  await store.set(state);
  render();
  return message;
}

async function add(text) {
  const word = text.trim().replace(/"/g, '').replace(/\s+/g, ' ');
  if (word.length < 2 || word.length > 60) { say('Use a word or phrase of 2 to 60 characters.', true); return; }
  const message = await change(state => {
    if (state.words.some(item => item.toLowerCase() === word.toLowerCase())) return 'Already watched.';
    if (state.words.length >= MAX_WORDS) return 'You can watch up to 10 words. Remove one first.';
    state.words.push(word);
    return 'Watching "' + word + '". Mentions from now on will show up here and in Yab.';
  });
  say(message, message.startsWith('You can'));
}

function say(text, bad) {
  hint.textContent = text;
  hint.className = bad ? 'hint bad' : 'hint';
}

function ago(seconds) {
  const minutes = Math.max(0, Math.round((Date.now() / 1000 - seconds) / 60));
  if (minutes < 60) return minutes + 'm ago';
  const hours = Math.round(minutes / 60);
  return hours < 48 ? hours + 'h ago' : Math.round(hours / 24) + 'd ago';
}

function chip(word) {
  const span = document.createElement('span');
  span.className = 'word';
  const remove = document.createElement('button');
  remove.className = 'quiet';
  remove.textContent = '×';
  remove.title = 'Stop watching "' + word + '"';
  remove.addEventListener('click', () => change(state => { state.words = state.words.filter(item => item !== word); }));
  span.append(word, remove);
  return span;
}

function row(item) {
  const li = document.createElement('li');
  li.className = 'mention';
  const name = document.createElement('a');
  name.className = 'name';
  name.href = 'https://news.ycombinator.com/item?id=' + item.id;
  name.target = '_blank';
  name.textContent = item.title || 'Untitled thread';
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = [item.kind === 'story' ? 'Story' : 'Comment', 'by ' + item.by, '"' + item.word + '"', ago(item.at)].join(' · ');
  li.append(name, meta);
  if (item.kind === 'comment' && item.text) {
    const quote = document.createElement('p');
    quote.className = 'quote';
    quote.textContent = item.text;
    li.appendChild(quote);
  }
  return li;
}

async function render() {
  const state = await store.get();
  const watched = Array.isArray(state.words) ? state.words : [];
  const recent = Array.isArray(state.recent) ? state.recent : [];
  words.replaceChildren(...watched.map(chip));
  list.replaceChildren(...recent.map(row));
  recentTitle.hidden = recent.length === 0;
  empty.hidden = watched.length > 0;
}

document.getElementById('add').addEventListener('submit', event => {
  event.preventDefault();
  add(field.value).then(() => { field.value = ''; });
});

const wanted = new URLSearchParams(location.search).get('add');
if (wanted) add(wanted); else render();
