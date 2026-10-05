// Reddit: every post's relative time gets its date, matching the time
// element's own moment. Case: a YouTube video shows its upload date
// (Rick Astley's video went up on Oct 24 or 25, 2009, depending on the time
// zone).
export default {
  async act(page, { sleep }) { await sleep(1500); },
  async expect(page) {
    const state = await page.evaluate(() => {
      const stamps = Array.from(document.querySelectorAll('faceplate-timeago[ts]'));
      const labelled = stamps.filter(s => s.nextElementSibling?.classList.contains('yab-abs-date'));
      const first = labelled[0];
      const when = first ? new Date(first.querySelector('time')?.getAttribute('datetime') ?? first.getAttribute('ts')) : null;
      const label = first?.nextElementSibling.textContent;
      const day = when ? new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(when) : null;
      return { stamps: stamps.length, labelled: labelled.length, label, day, relative: first?.textContent.trim() };
    });
    if (!state.stamps) return { ok: false, detail: 'no relative times on the page' };
    if (state.labelled !== state.stamps) return { ok: false, detail: `${state.labelled} of ${state.stamps} times dated` };
    if (!state.label?.includes(state.day)) return { ok: false, detail: `label "${state.label}" for ${state.day}` };
    return { ok: true, detail: `${state.labelled} times dated, such as "${state.relative} ${state.label}"` };
  },
  async shot(page) {
    await page.evaluate(() => document.querySelector('shreddit-post')?.scrollIntoView({ block: 'start' }));
  },
  cases: [{
    name: 'YouTube watch page: upload date beside "years ago"',
    url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    async expect(page, { until }) {
      const label = await until(page, () => document.querySelector('ytd-watch-info-text .yab-abs-date')?.textContent, null, 15_000);
      return /Oct 2[45], 2009/.test(label ?? '') ? { ok: true, detail: label } : { ok: false, detail: `label "${label}"` };
    },
  }],
};
