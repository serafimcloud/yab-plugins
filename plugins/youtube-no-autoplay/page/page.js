// No Autoplay: YouTube plays only what the person starts.
//
// - Channel trailers: paused when they start without a click or key.
// - Hover previews: hidden (style.css) and paused, so they don't stream.
// - Up next: the player's Autoplay switch is turned off once; YouTube
//   remembers it. The end-of-video countdown is cancelled too.
let lastInput = -Infinity;
let autonavDone = false;
let autonavTries = 0;
let autonavAt = 0;
const byPerson = () => performance.now() - lastInput < 1500;

boost.on(document, 'pointerdown', event => { if (event.isTrusted) lastInput = performance.now(); }, true);
boost.on(document, 'keydown', event => { if (event.isTrusted) lastInput = performance.now(); }, true);

function trailer(video) {
  return !!video.closest('ytd-channel-video-player-renderer');
}
function preview(video) {
  return !!video.closest('ytd-video-preview, #video-preview, #inline-preview-player, ytd-thumbnail-overlay-inline-playback-renderer');
}

function hold(video) {
  if (!video.paused) video.pause();
}

// "play" does not bubble, but it can be caught on its way down.
boost.on(document, 'play', event => {
  const video = event.target;
  if (!(video instanceof HTMLVideoElement)) return;
  if (preview(video)) { hold(video); return; }
  if (trailer(video)) {
    if (byPerson()) { video.dataset.yabStarted = 'person'; return; }
    if (video.dataset.yabStarted !== 'person') hold(video);
  }
}, true);

function sweep() {
  for (const video of document.querySelectorAll('video')) {
    if (video.paused) continue;
    if (preview(video) || (trailer(video) && video.dataset.yabStarted !== 'person')) hold(video);
  }
  if (location.pathname === '/watch') {
    // The switch is off when aria-checked is "false". The player may still
    // be setting up when the page loads and turn it back on: a few tries,
    // two seconds apart, until it reads off.
    // Only once the video has started, not during an ad: before that the
    // player sets the switch again from its own state.
    const player = document.querySelector('#movie_player');
    const started = player && !player.classList.contains('unstarted-mode') && !player.classList.contains('ad-showing');
    const toggle = document.querySelector('#movie_player .ytp-autonav-toggle-button[aria-checked="true"]');
    if (toggle && started && !autonavDone && autonavTries < 4 && performance.now() - autonavAt > 2000) {
      autonavTries++;
      autonavAt = performance.now();
      (toggle.closest('button') ?? toggle).click();
    }
    if (document.querySelector('#movie_player .ytp-autonav-toggle-button[aria-checked="false"]')) autonavDone = true;
    const cancel = document.querySelector('#movie_player .ytp-autonav-endscreen-upnext-cancel-button');
    if (cancel && cancel.getClientRects().length) cancel.click();
  }
}

boost.on(document, 'yt-navigate-finish', () => { autonavDone = false; autonavTries = 0; sweep(); });
const timer = setInterval(sweep, 500);
boost.cleanup(() => clearInterval(timer));
sweep();
