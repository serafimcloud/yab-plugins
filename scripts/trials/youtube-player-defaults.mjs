// A remembered speed of 1.5: the video plays at 1.5, in theater mode, at
// the highest quality; ] raises the speed and keeps it. A second case puts
// up YouTube's "Continue watching?" dialog on a stand-in page.
import { readFileSync } from 'node:fs';

const KEY = 'yab.youtube-player-defaults.';

export default {
  seed: () => ({ 'www.youtube.com': { [KEY + 'speed']: '1.5' } }),
  async act(page, { phase, until, sleep }) {
    await until(page, () => {
      const player = document.querySelector('#movie_player');
      return player && !player.classList.contains('ad-showing') && document.querySelector('#movie_player video')?.readyState >= 2;
    }, null, 40_000);
    await page.evaluate(() => { const v = document.querySelector('#movie_player video'); v.muted = true; return v.play().catch(() => {}); });
    await sleep(phase === 'after' ? 6000 : 3000);
  },
  async expect(page, { until, sleep }) {
    const theater = await until(page, () => document.querySelector('ytd-watch-flexy')?.hasAttribute('theater'), null, 10_000);
    const rate = await page.evaluate(() => document.querySelector('#movie_player video').playbackRate);
    // The quality menu shows the chosen height once the player switched.
    const height = await until(page, () => { const h = document.querySelector('#movie_player video').videoHeight; return h >= 1080 ? h : null; }, null, 20_000);
    // ] is the person's key: Playwright's key presses are trusted.
    await page.keyboard.press(']');
    await sleep(500);
    const after = await page.evaluate(k => ({ rate: document.querySelector('#movie_player video').playbackRate, kept: localStorage.getItem(k + 'speed') }), KEY);
    // Back to 1.5 for the picture and the checks.
    await page.keyboard.press('[');
    await sleep(300);
    const problems = [];
    if (!theater) problems.push('not in theater mode');
    if (Math.abs(rate - 1.5) > 0.01) problems.push(`plays at ${rate}`);
    if (!height) problems.push('quality stayed below 1080p');
    if (Math.abs(after.rate - 1.75) > 0.01 || after.kept !== '1.75') problems.push(`] gave ${after.rate}, kept ${after.kept}`);
    return problems.length ? { ok: false, detail: problems.join('; ') }
      : { ok: true, detail: `theater, 1.5x from storage, ${height}p, ] to 1.75x kept` };
  },
  cases: [{
    name: '"Continue watching?" answered (stand-in page with YouTube\'s dialog markup)',
    url: 'https://www.youtube.com/watch?v=stillwatchin',
    routes: { 'https://www.youtube.com/watch?v=stillwatchin': 'youtube-still-watching.html' },
    checks: false,
    async expect(page, { until }) {
      const answered = await until(page, () => window.confirmed === true && !document.querySelector('#idle-dialog'), null, 6000);
      const other = await page.evaluate(() => !!document.querySelector('#other-dialog'));
      return answered && other ? { ok: true, detail: 'answered Yes; another dialog left alone' } : { ok: false, detail: `answered ${!!answered}, other dialog kept ${other}` };
    },
  }],
};
