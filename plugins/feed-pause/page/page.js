// Feed Pause: a five-second pause before the feed on X, YouTube and Reddit.
//
// Only the feeds pause: X's Home, YouTube's home page, Reddit's front page,
// r/popular and r/all. Posts, videos, searches and profiles open at once.
// Once a pause has run its five seconds, the site stays open for 30 minutes
// (kept in the site's own storage, so each site counts on its own). A pause
// cut short, such as by a site's own reload, does not count.
const WAIT = 5;
const QUIET_MINUTES = 30;
const KEY = 'yab.feed-pause.shown';

const FEEDS = {
  'x.com': path => path === '/home',
  'www.youtube.com': path => path === '/',
  'www.reddit.com': path => /^\/(?:(?:best|hot|new|top|rising)\/?)?$/.test(path) || /^\/r\/(?:popular|all)(?:\/(?:best|hot|new|top|rising)?)?\/?$/.test(path),
};

function lastShown() {
  try { return Number(localStorage.getItem(KEY)) || 0; } catch { return 0; }
}
function markShown() {
  try { localStorage.setItem(KEY, String(Date.now())); } catch {}
}

let screen = null;
let countdown = 0;
let overflow = null;
let lastPath = null;

function close() {
  clearInterval(countdown);
  screen?.remove();
  screen = null;
  if (overflow !== null) { document.documentElement.style.overflow = overflow; overflow = null; }
}

function show() {
  const breath = document.createElement('div');
  breath.className = 'yab-feed-breath';
  const title = document.createElement('h1');
  title.textContent = 'A breath before the feed';
  const words = document.createElement('p');
  const site = location.hostname.replace(/^www\./, '');
  words.textContent = 'Did you open ' + site + ' for something in particular? The feed will still be there.';
  const back = document.createElement('button');
  back.type = 'button';
  back.textContent = 'Go back';
  back.addEventListener('click', () => { if (history.length > 1) history.back(); else close(); });
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'yab-feed-open';
  open.disabled = true;
  open.addEventListener('click', close);
  const actions = document.createElement('div');
  actions.className = 'yab-feed-actions';
  actions.append(back, open);
  screen = document.createElement('div');
  screen.className = 'yab-feed-pause';
  screen.setAttribute('role', 'dialog');
  screen.setAttribute('aria-label', 'Feed Pause');
  screen.append(breath, title, words, actions);
  document.body.append(screen);
  overflow = document.documentElement.style.overflow;
  document.documentElement.style.overflow = 'hidden';

  let left = WAIT;
  const label = () => { open.textContent = left > 0 ? 'Open anyway in ' + left : 'Open anyway'; };
  label();
  countdown = setInterval(() => {
    left--;
    label();
    if (left <= 0) { clearInterval(countdown); markShown(); open.disabled = false; open.focus(); }
  }, 1000);
}

function check() {
  if (location.pathname === lastPath) return;
  lastPath = location.pathname;
  const feed = FEEDS[location.hostname]?.(location.pathname);
  if (!feed) { close(); return; }
  if (screen) return;
  if (Date.now() - lastShown() < QUIET_MINUTES * 60000) return;
  show();
}

// These sites change pages without loading a new document.
const timer = setInterval(check, 300);
boost.cleanup(() => { clearInterval(timer); close(); });
check();
