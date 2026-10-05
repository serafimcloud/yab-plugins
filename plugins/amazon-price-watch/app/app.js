// The watched list lives in the plugin's service storage, which this page
// reads and writes through chrome.yab.storage. Outside Yab (or in a Yab
// without that bridge) a stand-in keeps the list in this page's own storage.
const MAX_ITEMS = 25;
const shared = window.chrome && window.chrome.yab && window.chrome.yab.storage;
const store = shared || standIn('amazon-price-watch');

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

function asinOf(text) {
  const value = text.trim();
  if (/^[A-Za-z0-9]{10}$/.test(value)) return value.toUpperCase();
  const match = /\/(?:dp|gp\/product|gp\/aw\/d|product)\/([A-Za-z0-9]{10})(?:[/?#]|$)/.exec(value);
  return match ? match[1].toUpperCase() : null;
}

async function add(text) {
  const asin = asinOf(text);
  if (!asin) { say('That is not an Amazon product link or a 10-character ASIN.', true); return; }
  const state = await store.get();
  const items = Array.isArray(state.items) ? state.items : [];
  if (items.some(item => item.asin === asin)) { say('Already watched.'); return; }
  if (items.length >= MAX_ITEMS) { say('You can watch up to 25 products. Stop one first.', true); return; }
  items.push({ asin, title: asin, added: Date.now() });
  state.items = items;
  await store.set(state);
  say('Watching ' + asin + '. The first price appears after the next check.');
  render();
}

async function remove(asin) {
  const state = await store.get();
  state.items = (state.items || []).filter(item => item.asin !== asin);
  await store.set(state);
  render();
}

function say(text, bad) {
  hint.textContent = text;
  hint.className = bad ? 'hint bad' : 'hint';
}

function ago(time) {
  if (!time) return 'not checked yet';
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60000));
  if (minutes < 1) return 'checked just now';
  if (minutes < 60) return 'checked ' + minutes + 'm ago';
  const hours = Math.round(minutes / 60);
  return hours < 48 ? 'checked ' + hours + 'h ago' : 'checked ' + Math.round(hours / 24) + 'd ago';
}

function spark(history) {
  const points = (history || []).map(point => point[1]);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const width = 96, height = 28;
  svg.setAttribute('class', 'spark');
  svg.setAttribute('width', width);
  svg.setAttribute('height', height);
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  if (points.length < 2) return svg;
  const low = Math.min(...points), high = Math.max(...points), span = high - low || 1;
  const x = index => 2 + (index / (points.length - 1)) * (width - 4);
  const y = value => height - 3 - ((value - low) / span) * (height - 6);
  const line = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('points', points.map((value, index) => x(index).toFixed(1) + ',' + y(value).toFixed(1)).join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', 'currentColor');
  line.setAttribute('stroke-width', '1.5');
  line.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(line);
  const dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
  dot.setAttribute('cx', x(points.length - 1));
  dot.setAttribute('cy', y(points[points.length - 1]));
  dot.setAttribute('r', '2.5');
  dot.setAttribute('fill', 'currentColor');
  svg.appendChild(dot);
  const last = points[points.length - 1], first = points[0];
  svg.style.color = last < first ? 'var(--good)' : last > first ? 'var(--warn)' : 'var(--soft)';
  return svg;
}

function row(item) {
  const li = document.createElement('li');
  const left = document.createElement('div');
  const name = document.createElement('a');
  name.className = 'name';
  name.href = 'https://www.amazon.com/dp/' + item.asin;
  name.target = '_blank';
  name.textContent = item.title || item.asin;
  const meta = document.createElement('div');
  meta.className = 'meta';
  const state = item.state === 'in' ? 'In stock' : item.state === 'out' ? 'Out of stock' : '';
  meta.textContent = [item.asin, state, item.error ? 'last check failed' : ago(item.checked)].filter(Boolean).join(' · ');
  left.append(name, meta);

  const right = document.createElement('div');
  right.className = 'right';
  right.appendChild(spark(item.history));
  const price = document.createElement('div');
  price.className = 'price';
  price.textContent = item.state === 'in' && item.display ? item.display : '';
  const stop = document.createElement('button');
  stop.className = 'quiet';
  stop.textContent = 'Stop';
  stop.title = 'Stop watching';
  stop.addEventListener('click', () => remove(item.asin));
  right.append(price, stop);
  li.append(left, right);
  return li;
}

async function render() {
  const state = await store.get();
  const items = Array.isArray(state.items) ? state.items : [];
  list.replaceChildren(...items.map(row));
  empty.hidden = items.length > 0;
}

document.getElementById('add').addEventListener('submit', event => {
  event.preventDefault();
  add(field.value).then(() => { field.value = ''; });
});

const wanted = new URLSearchParams(location.search).get('add');
if (wanted) add(wanted); else render();
