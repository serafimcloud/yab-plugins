// Blocked Sites: hide Google results from listed domains.
//
// The list lives in google.com's storage on this Mac. A domain also covers
// its subdomains: "pinterest.com" hides www.pinterest.com and
// uk.pinterest.com.
const KEY = 'yab.google-domain-blocklist.domains';

function load() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(list) ? list.filter(d => typeof d === 'string') : [];
  } catch { return []; }
}
function store(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch {}
}

// "https://www.Example.com/x" or "*.example.com" -> "example.com".
function clean(line) {
  let text = line.trim().toLowerCase().replace(/^\*\./, '');
  if (!text || text.startsWith('#')) return null;
  try { if (/^[a-z]+:\/\//.test(text)) text = new URL(text).hostname; } catch { return null; }
  text = text.replace(/^www\./, '').replace(/\/.*$/, '');
  return /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9-]{2,}$/.test(text) ? text : null;
}

let domains = load();
const blocked = host => domains.some(domain => host === domain || host.endsWith('.' + domain));

function hostOf(link) {
  try { return new URL(link.href).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// The block of one result: Google's own wrappers, from the closest out.
function resultOf(link) {
  return link.closest('[data-rpos], .MjjYud, .g, #rso > *');
}

function results() {
  const out = [];
  for (const title of document.querySelectorAll('#rso a[href] h3')) {
    const link = title.closest('a');
    const block = link && resultOf(link);
    if (block) out.push({ link, block, host: hostOf(link) });
  }
  return out;
}

// Within a block of several results (Videos, Top stories), the part that
// holds this result and no other.
function itemOf(link, block) {
  let node = link;
  while (node.parentElement && node.parentElement !== block && node.parentElement.querySelectorAll('a[href] h3').length === 1) node = node.parentElement;
  return node;
}

let hiddenCount = 0;
function apply() {
  const all = results();
  const byBlock = new Map();
  for (const result of all) byBlock.set(result.block, [...(byBlock.get(result.block) ?? []), result]);
  const hide = new Set();
  hiddenCount = 0;
  for (const [block, list] of byBlock) {
    const blockedHere = list.filter(result => blocked(result.host));
    hiddenCount += blockedHere.length;
    if (!blockedHere.length) continue;
    if (blockedHere.length === list.length) hide.add(block);
    else for (const result of blockedHere) hide.add(itemOf(result.link, block));
  }
  for (const node of document.querySelectorAll('[data-yab-blocked]')) if (!hide.has(node)) node.removeAttribute('data-yab-blocked');
  for (const node of hide) if (!node.hasAttribute('data-yab-blocked')) node.setAttribute('data-yab-blocked', '');
  drawPill();
}

// ---- the pill and its panel ------------------------------------------------------

let pill = null;
let panel = null;
let field = null;

function button(label, className, onClick) {
  const node = document.createElement('button');
  node.type = 'button';
  node.textContent = label;
  if (className) node.className = className;
  node.addEventListener('click', onClick);
  return node;
}

function drawPill() {
  if (!pill) {
    pill = button('', 'yab-block-pill', () => { if (panel && !panel.hidden) panel.hidden = true; else openPanel(); });
    document.body.append(pill);
  }
  pill.textContent = hiddenCount ? hiddenCount + ' hidden · Blocked sites' : domains.length ? 'Blocked sites (' + domains.length + ')' : 'Block sites';
}

function openPanel() {
  if (!panel) {
    panel = document.createElement('div');
    panel.className = 'yab-block-panel';
    panel.hidden = true;
    document.body.append(panel);
  }
  const title = document.createElement('h2');
  title.textContent = 'Hide results from these sites';
  field = document.createElement('textarea');
  field.placeholder = 'One site per line, such as pinterest.com';
  field.value = domains.join('\n');
  field.spellcheck = false;
  const here = document.createElement('div');
  here.className = 'yab-block-here';
  const onPage = [...new Set(results().map(r => r.host).filter(h => h && !blocked(h)))].slice(0, 12);
  for (const host of onPage) {
    here.append(button('+ ' + host, '', event => {
      const lines = field.value.split('\n').map(l => l.trim()).filter(Boolean);
      if (!lines.includes(host)) field.value = [...lines, host].join('\n');
      event.currentTarget.remove();
    }));
  }
  const actions = document.createElement('div');
  actions.className = 'yab-block-actions';
  actions.append(
    button('Cancel', '', () => { panel.hidden = true; }),
    button('Save', 'yab-block-save', () => {
      domains = [...new Set(field.value.split('\n').map(clean).filter(Boolean))].sort();
      store(domains);
      panel.hidden = true;
      apply();
    }));
  panel.replaceChildren(title, field, ...(onPage.length ? [here] : []), actions);
  panel.hidden = false;
  field.focus();
}

// Google adds results as people scroll ("More results") and on other tabs
// of the same search.
const center = document.querySelector('#center_col') ?? document.querySelector('#main');
if (center && center !== document.documentElement) boost.observe(center, apply, { childList: true, subtree: true });
// Another tab of Google changed the list.
boost.on(window, 'storage', event => { if (event.key === KEY) { domains = load(); apply(); } });
boost.cleanup(() => {
  pill?.remove();
  panel?.remove();
  for (const block of document.querySelectorAll('[data-yab-blocked]')) block.removeAttribute('data-yab-blocked');
});
apply();
