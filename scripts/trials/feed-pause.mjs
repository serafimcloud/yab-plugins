// Reddit's front page: the pause screen covers the feed, Open anyway waits
// five seconds, then opens the feed; a reload within 30 minutes opens at
// once. Cases: YouTube's home page pauses; a YouTube video does not; X's
// Home pauses (saved stand-in page, X needs sign-in).
const screen = () => {
  const node = document.querySelector('.yab-feed-pause');
  const open = node?.querySelector('button.yab-feed-open');
  return node && node.getClientRects().length ? { label: open?.textContent, disabled: open?.disabled } : null;
};

export default {
  async act(page, { phase, sleep }) { await sleep(phase === 'after' ? 1200 : 500); },
  async expect(page, { until, sleep }) {
    const first = await page.evaluate(screen);
    if (!first) return { ok: false, detail: 'no pause screen on the front page' };
    const ready = await until(page, () => document.querySelector('.yab-feed-pause button.yab-feed-open:not(:disabled)')?.textContent, null, 7000);
    await page.click('.yab-feed-pause button.yab-feed-open');
    await sleep(300);
    const gone = !(await page.evaluate(screen));
    const scroll = await page.evaluate(() => document.documentElement.style.overflow);
    await page.reload({ waitUntil: 'load' });
    await sleep(1500);
    const again = await page.evaluate(screen);
    // 30 minutes later (the record removed): the countdown from the start,
    // which is also the picture.
    await page.evaluate(() => localStorage.removeItem('yab.feed-pause.shown'));
    await page.reload({ waitUntil: 'domcontentloaded' });
    const counting = await until(page, () => {
      const open = document.querySelector('.yab-feed-pause button.yab-feed-open');
      return open?.disabled ? open.textContent : null;
    }, null, 8000);
    await sleep(1200);
    const problems = [];
    if (!/^Open anyway in [1-5]$/.test(counting ?? '')) problems.push(`countdown: ${counting}`);
    if (ready !== 'Open anyway') problems.push(`after five seconds: ${ready}`);
    if (!gone || scroll === 'hidden') problems.push('Open anyway did not open the feed');
    if (again) problems.push('paused again within 30 minutes');
    return problems.length ? { ok: false, detail: problems.join('; ') } : { ok: true, detail: `"${counting}" disabled, then "Open anyway" opens the feed; no second pause within 30 minutes` };
  },
  cases: [
    {
      name: 'YouTube home pauses',
      url: 'https://www.youtube.com/',
      async expect(page, { sleep }) { await sleep(1000); const s = await page.evaluate(screen); return s ? { ok: true, detail: s.label } : { ok: false, detail: 'no pause screen' }; },
    },
    {
      name: 'a YouTube video opens at once',
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      async expect(page, { sleep }) { await sleep(1500); const s = await page.evaluate(screen); return !s ? { ok: true, detail: 'no pause' } : { ok: false, detail: 'paused a video page' }; },
    },
    {
      name: 'X Home pauses (saved stand-in page, needs sign-in live)',
      url: 'https://x.com/home',
      routes: { 'https://x.com/': 'x-home.html' },
      async expect(page, { sleep }) { await sleep(1000); const s = await page.evaluate(screen); return s ? { ok: true, detail: s.label } : { ok: false, detail: 'no pause screen' }; },
    },
  ],
};
