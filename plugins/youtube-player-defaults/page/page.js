// Player Defaults: speed and quality kept, theater mode, no "Continue watching?".
//
// The script runs beside YouTube's own code, not inside it, so it works
// through the page: the video element's playbackRate for speed, and the
// player's own settings menu for quality (kept out of sight while it works).
const KEY = 'yab.youtube-player-defaults.';
const SPEEDS = { min: 0.25, max: 4, step: 0.25 };

function read(name, fallback) {
  try { const value = localStorage.getItem(KEY + name); return value === null ? fallback : JSON.parse(value); } catch { return fallback; }
}
function write(name, value) {
  try { localStorage.setItem(KEY + name, JSON.stringify(value)); } catch {}
}

let speed = Number(read('speed', 1)) || 1;
// "highest", "auto" (leave it to YouTube) or a height such as 1080.
let quality = read('quality', 'highest');
let lastInput = -Infinity;
let video = null;
let videoId = null;
let resets = 0;
let applying = false;
let qualityDoneFor = null;
let theaterDoneFor = null;
let theaterTries = 0;
let badge = null;
let badgeTimer = 0;

const player = () => document.querySelector('#movie_player');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const adShowing = () => !!player()?.classList.contains('ad-showing');

function currentId() {
  if (location.pathname !== '/watch') return null;
  return new URLSearchParams(location.search).get('v');
}

// Only a person's own keys and clicks count as choosing a speed or quality.
boost.on(document, 'keydown', event => { if (event.isTrusted) lastInput = performance.now(); }, true);
boost.on(document, 'pointerdown', event => { if (event.isTrusted) lastInput = performance.now(); }, true);
const byPerson = () => performance.now() - lastInput < 1500;

// ---- speed ----------------------------------------------------------------

function setRate(rate) {
  if (!video || adShowing()) return;
  applying = true;
  video.playbackRate = rate;
  applying = false;
}

function onRateChange() {
  if (applying || !video || adShowing()) return;
  if (byPerson()) {
    speed = video.playbackRate;
    write('speed', speed);
  } else if (Math.abs(video.playbackRate - speed) > 0.01 && resets < 5) {
    // YouTube set its own speed back when the video loaded.
    resets++;
    setRate(speed);
  }
}

function showSpeed() {
  const host = player();
  if (!host) return;
  if (!badge || !badge.isConnected) {
    badge = document.createElement('div');
    badge.className = 'yab-defaults-speed';
    host.append(badge);
  }
  badge.textContent = speed.toFixed(2).replace(/\.?0+$/, '') + '×';
  badge.hidden = false;
  clearTimeout(badgeTimer);
  badgeTimer = setTimeout(() => { if (badge) badge.hidden = true; }, 900);
}

boost.on(document, 'keydown', event => {
  if (event.key !== '[' && event.key !== ']') return;
  if (event.metaKey || event.ctrlKey || event.altKey || !currentId() || !video) return;
  const target = event.target;
  if (target instanceof Element && target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
  event.preventDefault();
  event.stopPropagation();
  const next = speed + (event.key === ']' ? SPEEDS.step : -SPEEDS.step);
  speed = Math.min(SPEEDS.max, Math.max(SPEEDS.min, Math.round(next / SPEEDS.step) * SPEEDS.step));
  write('speed', speed);
  setRate(speed);
  showSpeed();
}, true);

// ---- quality --------------------------------------------------------------

// A height chosen by hand in YouTube's quality menu becomes the preference.
boost.on(document, 'click', event => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const item = event.target.closest('.ytp-settings-menu .ytp-menuitem');
  if (!item) return;
  const text = item.textContent.trim();
  const height = /^(\d{3,4})p/.exec(text);
  if (height) { quality = Number(height[1]); write('quality', quality); }
  else if (/^Auto$/i.test(text) && item.closest('.ytp-quality-menu')) { quality = 'auto'; write('quality', quality); }
}, true);

async function pickQuality(id) {
  const host = player();
  const button = host?.querySelector('.ytp-settings-button');
  if (!host || !button || quality === 'auto') return true;
  host.classList.add('yab-defaults-busy');
  try {
    button.click();
    await sleep(150);
    // The Quality row is the one whose value reads "Auto (720p)" or "1080p".
    const row = Array.from(host.querySelectorAll('.ytp-settings-menu .ytp-menuitem'))
      .find(item => /^(Auto|\d{3,4}p)/.test(item.querySelector('.ytp-menuitem-content')?.textContent.trim() ?? ''));
    if (!row) return false;
    row.click();
    await sleep(150);
    const items = Array.from(host.querySelectorAll('.ytp-settings-menu .ytp-menuitem'))
      .map(item => ({ item, height: Number(/^(\d{3,4})p/.exec(item.textContent.trim())?.[1] ?? NaN) }))
      .filter(entry => Number.isFinite(entry.height))
      .sort((a, b) => b.height - a.height);
    if (!items.length) return false;
    const wanted = quality === 'highest' ? items[0] : items.find(entry => entry.height <= Number(quality)) ?? items[items.length - 1];
    if (currentId() === id && wanted.item.getAttribute('aria-checked') !== 'true') wanted.item.click();
    return true;
  } finally {
    await sleep(100);
    // Choosing a quality closes the menu; otherwise close it here.
    const menu = host.querySelector('.ytp-settings-menu');
    if (menu && menu.style.display !== 'none') button.click();
    host.classList.remove('yab-defaults-busy');
  }
}

// ---- theater and "Continue watching?" -----------------------------------------

// Done for a video once the page shows theater mode; YouTube may still be
// setting up its layout on the first try, so up to three tries.
function theater(id) {
  const flexy = document.querySelector('ytd-watch-flexy');
  if (!flexy || theaterDoneFor === id || document.fullscreenElement) return;
  if (flexy.hasAttribute('theater')) { theaterDoneFor = id; return; }
  const size = player()?.querySelector('.ytp-size-button');
  if (!size || theaterTries >= 3) return;
  theaterTries++;
  size.click();
}

function stillWatching() {
  for (const dialog of document.querySelectorAll('ytd-popup-container yt-confirm-dialog-renderer')) {
    if (!dialog.getClientRects().length || !/continue watching\?/i.test(dialog.textContent)) continue;
    // The button itself, not its wrapper: one selector at a time.
    const confirm = ['#confirm-button button', '#confirm-button tp-yt-paper-button', '#confirm-button']
      .map(selector => dialog.querySelector(selector)).find(Boolean);
    if (!confirm) continue;
    confirm.click();
    if (video?.paused) video.play().catch(() => {});
  }
}

// ---- the video on screen --------------------------------------------------

function bindVideo() {
  const next = player()?.querySelector('video');
  if (next === video) return;
  video = next;
  if (!video) return;
  boost.on(video, 'ratechange', onRateChange);
  boost.on(video, 'loadeddata', () => { resets = 0; setRate(speed); });
  boost.on(video, 'playing', () => { if (Math.abs(video.playbackRate - speed) > 0.01 && !byPerson()) setRate(speed); });
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    bindVideo();
    stillWatching();
    const id = currentId();
    if (id !== videoId) { videoId = id; resets = 0; theaterTries = 0; if (id) setRate(speed); }
    if (!id || !video || adShowing()) return;
    theater(id);
    if (qualityDoneFor !== id && video.readyState >= 2) {
      if (await pickQuality(id)) qualityDoneFor = id;
    }
  } finally {
    busy = false;
  }
}

boost.on(document, 'yt-navigate-finish', tick);
const timer = setInterval(tick, 1000);
boost.cleanup(() => {
  clearInterval(timer);
  clearTimeout(badgeTimer);
  badge?.remove();
  player()?.classList.remove('yab-defaults-busy');
});
tick();
