// X needs sign-in, so the post page is a saved stand-in with X's structure
// (scripts/fixtures/x-status.html): jack's first post and eight replies.
// Folded: a paid blue check (growthguru), a handle ending in digits
// (maria84720193), another paid check (cryptoking). Kept: no badge, a gold
// organization check (NASA), a grey government check (WhiteHouse), and the
// author's own reply.
const FOLDED = ['growthguru', 'maria84720193', 'cryptoking'];

const shownHandles = () => Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"]'))
  .filter(cell => cell.getClientRects().length)
  .map(cell => cell.querySelector('[data-testid="User-Name"] .handle')?.textContent.slice(1));

export default {
  note: 'needs sign-in: tried on a saved page with X\'s structure',
  routes: { 'https://x.com/': 'x-status.html' },
  async act(page, { sleep }) { await sleep(1500); },
  async expect(page, { sleep }) {
    const visible = await page.evaluate(shownHandles);
    const pill = await page.evaluate(() => document.querySelector('.yab-replies-pill:not([hidden])')?.textContent);
    const hiddenRight = FOLDED.every(h => !visible.includes(h)) && ['alicecodes', 'NASA', 'WhiteHouse', 'samwritesjs'].every(h => visible.includes(h)) && visible.filter(h => h === 'jack').length === 2;
    await page.click('.yab-replies-pill button');
    await sleep(300);
    const opened = await page.evaluate(shownHandles);
    const pillOpen = await page.evaluate(() => document.querySelector('.yab-replies-pill')?.textContent);
    await page.click('.yab-replies-pill button');
    await sleep(300);
    const problems = [];
    if (!hiddenRight) problems.push(`visible: ${visible.join(', ')}`);
    if (pill !== '3 hiddenShow') problems.push(`pill says "${pill}"`);
    if (!FOLDED.every(h => opened.includes(h)) || pillOpen !== '3 hiddenHide') problems.push(`after Show: ${opened.join(', ')}, pill "${pillOpen}"`);
    return problems.length ? { ok: false, detail: problems.join('; ') } : { ok: true, detail: `folded ${FOLDED.join(', ')}; kept no-badge, gold, grey and the author; Show opens them` };
  },
};
