// The Dropbox launch discussion (item 8863): the last visit is set to three
// hours ago with the ten newest comments unseen. Expect the article button,
// those ten marked new, Read later saved, and the visit remembered. A case
// on the front page shows "(5 new)" for a story opened when it had five
// comments fewer.
const KEY = 'yab.hn-side-by-side.';
const NEW = 10;

export default {
  async prepare(page) {
    const ids = await page.evaluate(() => Array.from(document.querySelectorAll('tr.athing.comtr[id]'), row => Number(row.id)).sort((a, b) => a - b));
    return { threshold: ids[ids.length - NEW - 1], newest: ids[ids.length - 1] };
  },
  seed: data => ({ 'news.ycombinator.com': { [KEY + 'seen']: JSON.stringify({ 8863: { max: data.threshold, count: 60, at: Date.now() - 3 * 3600e3 } }) } }),
  async expect(page, { data, sleep }) {
    const bar = await page.evaluate(() => {
      const bar = document.querySelector('.yab-hn-bar');
      return bar && { text: bar.textContent, article: bar.querySelector('a.yab-hn-article')?.href, marked: document.querySelectorAll('tr.yab-hn-new').length };
    });
    if (!bar) return { ok: false, detail: 'no bar above the comments' };
    await page.click('.yab-hn-bar button:has-text("Read later")');
    await page.click('.yab-hn-bar button:has-text("Next new")');
    await sleep(800);
    const after = await page.evaluate(k => ({
      later: JSON.parse(localStorage.getItem(k + 'later') ?? '[]').map(e => e.id),
      seen: JSON.parse(localStorage.getItem(k + 'seen') ?? '{}')['8863'],
      button: document.querySelector('.yab-hn-bar button[aria-pressed]')?.textContent,
      jumped: (() => { const row = document.querySelector('tr.yab-hn-new'); const top = row?.getBoundingClientRect().top; return top !== undefined && top >= -2 && top < 200; })(),
      menu: document.querySelector('.yab-hn-later-link')?.textContent,
    }), KEY);
    await page.evaluate(() => window.scrollTo(0, 0));
    const problems = [];
    if (!/getdropbox\.com/.test(bar.article ?? '')) problems.push(`article link ${bar.article}`);
    if (bar.marked !== NEW) problems.push(`${bar.marked} comments marked new, expected ${NEW}`);
    if (!bar.text.includes(`${NEW} new comments since 3 hours ago`)) problems.push(`bar says "${bar.text}"`);
    if (!after.later.includes('8863') || after.button !== 'Saved for later' || after.menu !== 'later (1)') problems.push(`read later: ${JSON.stringify(after)}`);
    if (after.seen?.max !== data.newest) problems.push(`visit remembered up to ${after.seen?.max}, newest is ${data.newest}`);
    if (!after.jumped) problems.push('Next new did not scroll to a new comment');
    return problems.length ? { ok: false, detail: problems.join('; ') } : { ok: true, detail: `article button, ${NEW} new marked, Next new jumps, Read later saved, visit remembered` };
  },
  cases: [{
    name: 'front page: "(5 new)" on a story opened before',
    url: 'https://news.ycombinator.com/',
    async expect(page, { sleep }) {
      const story = await page.evaluate(() => {
        for (const link of document.querySelectorAll('td.subtext a[href^="item?id="]')) {
          const match = /^(\d+)\s*comments?$/.exec(link.textContent.replace(/ /g, ' ').trim());
          if (match && Number(match[1]) >= 5) return { id: new URLSearchParams(link.getAttribute('href').split('?')[1]).get('id'), count: Number(match[1]) };
        }
        return null;
      });
      if (!story) return { ok: false, detail: 'no story with comments on the front page' };
      await page.evaluate(({ k, s }) => localStorage.setItem(k + 'seen', JSON.stringify({ [s.id]: { max: 0, count: s.count - 5, at: Date.now() } })), { k: KEY, s: story });
      await page.reload({ waitUntil: 'load' });
      await sleep(1000);
      const shown = await page.evaluate(id => document.querySelector(`td.subtext a[href="item?id=${id}"] + .yab-hn-count`)?.textContent, story.id);
      return shown?.trim() === '(5 new)' ? { ok: true, detail: `item ${story.id}: "${shown.trim()}"` } : { ok: false, detail: `item ${story.id}: "${shown}"` };
    },
  }],
};
