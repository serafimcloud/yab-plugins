// X needs sign-in, so Home is a saved stand-in with X's tabs
// (scripts/fixtures/x-home.html), For you selected as X does.
export default {
  note: 'needs sign-in: tried on a saved page with X\'s structure',
  routes: { 'https://x.com/': 'x-home.html' },
  async act(page, { sleep }) { await sleep(1500); },
  async expect(page, { sleep }) {
    const selected = await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim());
    // The person switches back: it stays on For you.
    await page.click('#tab-for-you');
    await sleep(1500);
    const stays = await page.evaluate(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim());
    await page.click('#tab-following');
    await sleep(300);
    if (selected !== 'Following') return { ok: false, detail: `selected tab is ${selected}` };
    if (stays !== 'For you') return { ok: false, detail: `switching back to For you did not stay (${stays})` };
    return { ok: true, detail: 'Following selected on arrival; For you stays when chosen' };
  },
};
