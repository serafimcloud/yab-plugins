// Skip Sponsors: SponsorBlock segments on YouTube.
//
// Privacy: the video id never leaves the page. Yab asks SponsorBlock for
// every video whose id hashes to the same 4-character SHA-256 prefix and
// picks this video out of the answer.
const API = 'https://sponsor.ajay.app/api/skipSegments/';
const CATEGORIES = ['sponsor', 'intro', 'outro', 'selfpromo'];
const LABELS = { sponsor: 'sponsor', intro: 'intro', outro: 'outro', selfpromo: 'self-promotion' };
const cache = new Map();
let videoId = null;
let segments = [];
let skipped = new Set();
let video = null;
let toast = null;
let toastTimer = 0;
let retryAt = 0;
let ownSeek = false;

function currentId() {
  if (location.pathname !== '/watch') return null;
  const id = new URLSearchParams(location.search).get('v');
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

async function hashPrefix(id) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id));
  return Array.from(new Uint8Array(digest).slice(0, 2), b => b.toString(16).padStart(2, '0')).join('');
}

async function load(id) {
  if (cache.has(id)) return cache.get(id);
  const query = '?categories=' + encodeURIComponent(JSON.stringify(CATEGORIES)) + '&actionTypes=' + encodeURIComponent('["skip"]');
  let list = [];
  try {
    const response = await fetch(API + (await hashPrefix(id)) + query, { credentials: 'omit' });
    // 404 means no video with this prefix has segments.
    if (response.ok) {
      const entries = await response.json();
      const entry = Array.isArray(entries) ? entries.find(e => e.videoID === id) : null;
      list = (entry?.segments ?? [])
        .filter(s => s.actionType === 'skip' && CATEGORIES.includes(s.category) && Array.isArray(s.segment))
        .map(s => ({ start: Number(s.segment[0]), end: Number(s.segment[1]), category: s.category, uuid: String(s.UUID) }))
        .filter(s => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end - s.start >= 1)
        .sort((a, b) => a.start - b.start);
    } else if (response.status !== 404) {
      return null;
    }
  } catch {
    return null;
  }
  cache.set(id, list);
  return list;
}

function player() {
  return document.querySelector('#movie_player');
}

function showToast(segment, from) {
  const host = player();
  if (!host) return;
  if (!toast || !toast.isConnected) {
    toast = document.createElement('div');
    toast.className = 'yab-sponsor-toast';
    toast.setAttribute('role', 'status');
    const words = document.createElement('span');
    const undo = document.createElement('button');
    undo.type = 'button';
    undo.textContent = 'Undo';
    toast.append(words, undo);
    host.append(toast);
  }
  toast.querySelector('span').textContent = 'Skipped ' + LABELS[segment.category];
  const undo = toast.querySelector('button');
  undo.onclick = event => {
    event.stopPropagation();
    if (video) video.currentTime = from;
    toast.hidden = true;
  };
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { if (toast) toast.hidden = true; }, 4000);
}

function check() {
  if (!video || !segments.length || video.paused && video.currentTime === 0) return;
  // Ads play in the same element; the segment times belong to the video.
  if (player()?.classList.contains('ad-showing')) return;
  const now = video.currentTime;
  for (const segment of segments) {
    if (skipped.has(segment.uuid)) continue;
    if (now >= segment.start && now < segment.end - 0.5) {
      skipped.add(segment.uuid);
      const end = Math.min(segment.end, (video.duration || segment.end) - 0.1);
      ownSeek = true;
      video.currentTime = end;
      showToast(segment, now);
      return;
    }
  }
}

function bindVideo() {
  const next = document.querySelector('#movie_player video');
  if (next === video) return;
  video = next;
  if (video) {
    boost.on(video, 'timeupdate', check);
    // A seek by the person puts the note away; the skip's own seek does not.
    boost.on(video, 'seeking', () => {
      if (ownSeek) { ownSeek = false; return; }
      if (toast) toast.hidden = true;
    });
  }
}

async function refresh() {
  bindVideo();
  const id = currentId();
  if (id === videoId && !(retryAt && Date.now() > retryAt)) return;
  videoId = id;
  retryAt = 0;
  segments = [];
  skipped = new Set();
  if (!id) return;
  const list = await load(id);
  if (videoId !== id) return;
  segments = list ?? [];
  // SponsorBlock did not answer: ask again in half a minute.
  if (!list) retryAt = Date.now() + 30000;
  const host = player();
  if (host && list) {
    host.dataset.yabSponsorVideo = id;
    host.dataset.yabSponsorSegments = String(segments.length);
  }
  check();
}

boost.on(document, 'yt-navigate-finish', refresh);
// YouTube swaps the page without loading a new document; a light poll
// covers the cases its navigation event misses.
const timer = setInterval(refresh, 1000);
boost.cleanup(() => {
  clearInterval(timer);
  clearTimeout(toastTimer);
  toast?.remove();
  const host = player();
  if (host) { delete host.dataset.yabSponsorVideo; delete host.dataset.yabSponsorSegments; }
});
refresh();
