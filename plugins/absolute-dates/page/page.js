// Real Dates: the actual date beside relative times.
//
// Reddit: every time element carries its exact moment, so every post and
// comment gets a date (and a time, this year).
// YouTube: the open video's upload date, from the page's own video
// description. Lists and comments on YouTube carry no dates in the page, so
// they keep YouTube's wording.
const thisYear = new Date().getFullYear();
const withTime = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const dayOnly = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

function label(date, time) {
  const node = document.createElement('span');
  node.className = 'yab-abs-date';
  node.textContent = '· ' + (time && date.getFullYear() === thisYear ? withTime : dayOnly).format(date);
  node.title = date.toString();
  return node;
}

// ---- Reddit ---------------------------------------------------------------------

function reddit() {
  for (const stamp of document.querySelectorAll('faceplate-timeago[ts]:not([data-yab-dated])')) {
    const date = new Date(stamp.getAttribute('ts').replace(/(\.\d{3})\d*/, '$1').replace(/\+0000$/, 'Z'));
    stamp.setAttribute('data-yab-dated', '');
    if (Number.isNaN(date.getTime())) continue;
    stamp.after(label(date, true));
  }
}

// ---- YouTube --------------------------------------------------------------------

function uploadDate(id) {
  const script = document.querySelector('#microformat script[type="application/ld+json"]');
  try {
    const data = JSON.parse(script?.textContent ?? 'null');
    const forThisVideo = [data?.embedUrl, data?.['@id'], data?.url].some(value => typeof value === 'string' && value.includes(id));
    return forThisVideo && data.uploadDate ? new Date(data.uploadDate) : null;
  } catch { return null; }
}

function youtube() {
  if (location.pathname !== '/watch') return;
  const id = new URLSearchParams(location.search).get('v');
  const anchor = document.querySelector('ytd-watch-metadata ytd-watch-info-text #date-text');
  if (!id || !anchor) return;
  const shown = anchor.parentElement.querySelector(':scope > .yab-abs-date');
  if (shown?.dataset.video === id) return;
  const date = uploadDate(id);
  shown?.remove();
  if (!date || Number.isNaN(date.getTime())) return;
  const node = label(date, false);
  node.dataset.video = id;
  anchor.after(node);
}

// ---- both -----------------------------------------------------------------------

const run = location.hostname === 'www.reddit.com' ? reddit : youtube;
if (location.hostname === 'www.reddit.com') {
  // Posts and comments arrive as people scroll.
  boost.observe(document.body, run, { childList: true, subtree: true });
} else {
  boost.on(document, 'yt-navigate-finish', run);
  const timer = setInterval(run, 1000);
  boost.cleanup(() => clearInterval(timer));
}
boost.cleanup(() => {
  for (const node of document.querySelectorAll('.yab-abs-date')) node.remove();
  for (const stamp of document.querySelectorAll('[data-yab-dated]')) stamp.removeAttribute('data-yab-dated');
});
run();
