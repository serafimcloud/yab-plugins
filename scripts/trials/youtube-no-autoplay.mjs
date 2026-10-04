// A channel page plays its trailer by itself (muted) without the plugin and
// keeps it still with it. Cases: a video that ends does not lead to the
// next one, and a hover over a search result plays no preview.
export default {
  async act(page, { sleep }) {
    await sleep(6000);
  },
  async shot(page) {
    await page.evaluate(() => document.querySelector('ytd-channel-video-player-renderer')?.scrollIntoView({ block: 'center' }));
  },
  async expect(page) {
    const trailer = await page.evaluate(() => {
      const video = document.querySelector('ytd-channel-video-player-renderer video');
      return video ? { paused: video.paused, time: video.currentTime } : null;
    });
    if (!trailer) return { ok: false, detail: 'no channel trailer on the page' };
    return trailer.paused && trailer.time < 2 ? { ok: true, detail: `trailer still at ${trailer.time.toFixed(1)} s` } : { ok: false, detail: `trailer playing at ${trailer.time.toFixed(1)} s` };
  },
  cases: [
    {
      // Without the plugin, YouTube goes on to another video here.
      name: 'watch page: the next video does not start when this one ends',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      async expect(page, { until, sleep }) {
        // A person pressed play; a pre-roll ad runs first.
        await until(page, () => {
          const player = document.querySelector('#movie_player');
          const video = document.querySelector('#movie_player video');
          if (video?.paused) { video.muted = true; video.play().catch(() => {}); }
          return player && video?.readyState >= 2 && !player.classList.contains('ad-showing') && !player.classList.contains('unstarted-mode');
        }, null, 45_000);
        await page.evaluate(() => { const video = document.querySelector('#movie_player video'); video.currentTime = video.duration - 3; });
        await sleep(20_000);
        const state = await page.evaluate(() => ({
          video: new URLSearchParams(location.search).get('v'),
          ended: document.querySelector('#movie_player video')?.ended,
          toggle: document.querySelector('#movie_player .ytp-autonav-toggle-button')?.getAttribute('aria-checked'),
        }));
        return state.video === 'dQw4w9WgXcQ' && state.ended
          ? { ok: true, detail: `ended and stayed (Autoplay switch ${state.toggle === 'false' ? 'off' : 'on, countdown cancelled'})` }
          : { ok: false, detail: `went on to ${state.video}` };
      },
    },
    {
      name: 'search results: no hover preview',
      url: 'https://www.youtube.com/results?search_query=rick+astley',
      async expect(page, { sleep }) {
        const thumb = page.locator('ytd-video-renderer ytd-thumbnail').first();
        await thumb.hover({ timeout: 10_000 }).catch(() => {});
        await page.mouse.move(300, 300);
        await thumb.hover({ timeout: 10_000 }).catch(() => {});
        await sleep(4000);
        const playing = await page.evaluate(() => Array.from(document.querySelectorAll('video')).filter(v => !v.paused && v.closest('ytd-video-preview, #video-preview, #inline-preview-player')).length);
        const shown = await page.evaluate(() => Array.from(document.querySelectorAll('ytd-video-preview, #video-preview')).some(e => e.getClientRects().length && getComputedStyle(e).display !== 'none'));
        return !playing && !shown ? { ok: true, detail: 'no preview shown or playing after a hover' } : { ok: false, detail: `${playing} previews playing, shown ${shown}` };
      },
    },
  ],
};
