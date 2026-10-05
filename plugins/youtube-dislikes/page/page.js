// Dislike Counts: Return YouTube Dislike's numbers beside the dislike button.
//
// YouTube hid public dislike counts in 2021. Return YouTube Dislike keeps
// the counts from before then and estimates newer ones from its users' votes,
// so the number is an estimate and says so on hover.
const API = 'https://returnyoutubedislikeapi.com/votes?videoId=';
const cache = new Map();
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });
const exact = new Intl.NumberFormat('en-US');
let loading = null;

// Watch pages only: Shorts draw their buttons differently.
function currentId() {
  if (location.pathname !== '/watch') return null;
  const id = new URLSearchParams(location.search).get('v');
  return id && /^[\w-]{11}$/.test(id) ? id : null;
}

async function votes(id) {
  if (cache.has(id)) return cache.get(id);
  if (loading?.id === id) return loading.promise;
  const promise = (async () => {
    try {
      const response = await fetch(API + encodeURIComponent(id), { credentials: 'omit' });
      if (!response.ok) return null;
      const data = await response.json();
      if (!Number.isFinite(data?.dislikes)) return null;
      const result = { dislikes: data.dislikes, likes: data.likes };
      cache.set(id, result);
      return result;
    } catch {
      return null;
    } finally {
      if (loading?.id === id) loading = null;
    }
  })();
  loading = { id, promise };
  return promise;
}

function button() {
  return document.querySelector('ytd-watch-metadata dislike-button-view-model button');
}

async function refresh() {
  const id = currentId();
  if (!id) return;
  const target = button();
  if (!target) return;
  const shown = target.querySelector('.yab-dislikes');
  if (shown && shown.dataset.video === id) return;
  const result = await votes(id);
  if (!result || currentId() !== id) return;
  const again = button();
  if (!again) return;
  let label = again.querySelector('.yab-dislikes');
  if (!label) {
    label = document.createElement('span');
    label.className = 'yab-dislikes';
    again.append(label);
  }
  label.dataset.video = id;
  label.textContent = compact.format(result.dislikes);
  label.title = exact.format(result.dislikes) + ' dislikes (estimate from Return YouTube Dislike)';
}

boost.on(document, 'yt-navigate-finish', refresh);
// YouTube redraws its buttons when the video or the like state changes.
const timer = setInterval(refresh, 1000);
boost.cleanup(() => {
  clearInterval(timer);
  for (const label of document.querySelectorAll('.yab-dislikes')) label.remove();
});
refresh();
