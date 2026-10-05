// The preview video has a locked sponsor segment from 0:44 to 1:05. Both
// sides play from 0:44.5; with the plugin the player should land past 1:04
// and say what it skipped.
const START = 44.5, END = 64.5;

async function playFrom(page, until, time) {
  // Wait out a pre-roll ad, then start in the segment.
  await until(page, () => {
    const player = document.querySelector('#movie_player');
    return player && !player.classList.contains('ad-showing') && document.querySelector('#movie_player video')?.readyState >= 1;
  }, null, 40_000);
  await page.evaluate(t => {
    const video = document.querySelector('#movie_player video');
    video.muted = true;
    video.currentTime = t;
    return video.play().catch(() => {});
  }, time);
}

export default {
  async act(page, { phase, until, sleep }) {
    if (phase === 'after') await until(page, () => document.querySelector('#movie_player')?.dataset.yabSponsorVideo, null, 20_000);
    await playFrom(page, until, START);
    await sleep(phase === 'after' ? 2500 : 3000);
  },
  async expect(page, { until }) {
    const landed = await until(page, end => {
      const video = document.querySelector('#movie_player video');
      const toast = document.querySelector('.yab-sponsor-toast');
      return video && video.currentTime >= end && toast && !toast.hidden ? { time: video.currentTime, toast: toast.textContent } : null;
    }, END, 15_000);
    const state = await page.evaluate(() => ({
      time: document.querySelector('#movie_player video')?.currentTime,
      segments: document.querySelector('#movie_player')?.dataset.yabSponsorSegments,
      asked: (window.__yabTry?.requests ?? []).map(r => r.url),
    }));
    const prefixOnly = state.asked.length > 0 && state.asked.every(url => /\/api\/skipSegments\/[0-9a-f]{4}\?/.test(url) && !url.includes('1gxnANAbLuE'));
    if (!landed) return { ok: false, detail: `still at ${state.time?.toFixed(1)} s with ${state.segments} segments` };
    if (!prefixOnly) return { ok: false, detail: `asked ${state.asked.join(', ')}` };
    return { ok: true, detail: `${state.segments} segments; played from ${START} s, landed at ${landed.time.toFixed(1)} s, "${landed.toast.replace('Undo', '').trim()}"; asked by hash prefix only` };
  },
};
