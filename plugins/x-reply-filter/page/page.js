// Quiet Replies: fold replies from paid blue checks and number-suffixed
// handles on X post pages, behind one "N hidden · Show" line.
//
// Gold (organizations) and grey (governments) checks are not paid
// subscriptions and stay. The post's author is never folded.
const DIGITS = /\d{5,}$/;
const folded = new Set();
const verdicts = new WeakMap();
let shown = false;
let pill = null;
let page = location.pathname;

function postPage() {
  return /^\/[^/]+\/status\/\d+/.test(location.pathname);
}

function author() {
  return location.pathname.split('/')[1]?.toLowerCase() ?? '';
}

function handleOf(article) {
  for (const link of article.querySelectorAll('[data-testid="User-Name"] a[href^="/"]')) {
    const text = link.textContent.trim();
    if (text.startsWith('@')) return text.slice(1);
  }
  const first = article.querySelector('[data-testid="User-Name"] a[href^="/"]');
  return first ? first.getAttribute('href').slice(1).split('/')[0] : '';
}

// Paid: a plain check in X's blue (29, 155, 240). Gold checks are drawn with
// a gradient; grey checks (130, 154, 171) are not blue enough.
function paidCheck(article) {
  const badge = article.querySelector('[data-testid="User-Name"] [data-testid="icon-verified"]');
  if (!badge) return false;
  if (badge.querySelector('linearGradient, radialGradient') || /url\(/.test(badge.getAttribute('fill') ?? '')) return false;
  const [r, g, b] = (getComputedStyle(badge).color.match(/\d+/g) ?? []).map(Number);
  if ([r, g, b].some(n => !Number.isFinite(n))) return true;
  return b > r + 100 && b > g + 40;
}

function sort(cell) {
  const article = cell.querySelector('article[data-testid="tweet"]');
  if (!article) return;
  const handle = handleOf(article);
  let fold = verdicts.get(article);
  if (fold === undefined) {
    fold = !!handle && handle.toLowerCase() !== author() && (paidCheck(article) || DIGITS.test(handle));
    verdicts.set(article, fold);
  }
  // The post itself is the first article on the page.
  const first = document.querySelector('article[data-testid="tweet"]') === article;
  const state = fold && !first ? (shown ? 'shown' : 'folded') : 'kept';
  if (cell.getAttribute('data-yab-replies') !== state) cell.setAttribute('data-yab-replies', state);
  const key = handle + '|' + (article.querySelector('time')?.getAttribute('datetime') ?? '');
  if (state === 'kept') folded.delete(key);
  else folded.add(key);
}

function render() {
  if (!pill || !pill.isConnected) {
    pill = document.createElement('div');
    pill.className = 'yab-replies-pill';
    pill.setAttribute('role', 'status');
    const words = document.createElement('span');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.addEventListener('click', () => {
      shown = !shown;
      for (const cell of document.querySelectorAll('[data-yab-replies="folded"], [data-yab-replies="shown"]')) {
        cell.setAttribute('data-yab-replies', shown ? 'shown' : 'folded');
      }
      render();
    });
    pill.append(words, toggle);
    document.body.append(pill);
  }
  pill.hidden = !postPage() || folded.size === 0;
  pill.querySelector('span').textContent = folded.size + ' hidden';
  pill.querySelector('button').textContent = shown ? 'Hide' : 'Show';
}

function run() {
  if (location.pathname !== page) {
    page = location.pathname;
    folded.clear();
    shown = false;
  }
  if (postPage()) {
    for (const cell of document.querySelectorAll('[data-testid="cellInnerDiv"]')) sort(cell);
  }
  render();
}

// X keeps one page and swaps its columns; watch the main column's subtree.
let observed = null;
function watch() {
  const main = document.querySelector('main[role="main"]') ?? document.querySelector('#react-root');
  if (main && main !== observed) {
    observed = main;
    boost.observe(main, run, { childList: true, subtree: true });
  }
  run();
}
const timer = setInterval(watch, 1000);
boost.cleanup(() => {
  clearInterval(timer);
  pill?.remove();
  for (const cell of document.querySelectorAll('[data-yab-replies]')) cell.removeAttribute('data-yab-replies');
});
watch();
