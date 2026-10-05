// Blocked: w3schools.com and geeksforgeeks.org. Their results disappear;
// docs.python.org and the rest stay; in the Videos block, which mixes
// YouTube and GeeksforGeeks, only the GeeksforGeeks video goes. Then the pill's
// panel adds stackoverflow.com with its "+ stackoverflow.com" button.
// Google shows automated WebKit its captcha page; the fallback is a saved
// results page at the same address (scripts/fixtures/google-results.html).
const KEY = 'yab.google-domain-blocklist.domains';

const shown = () => Array.from(document.querySelectorAll('#rso a[href] h3'))
  .filter(h => h.getClientRects().length)
  .map(h => new URL(h.closest('a').href).hostname.replace(/^www\./, ''));

export default {
  fallback: { 'https://www.google.com/search': 'google-results.html' },
  seed: () => ({ 'www.google.com': { [KEY]: JSON.stringify(['geeksforgeeks.org', 'w3schools.com']) } }),
  async act(page, { sleep }) { await sleep(800); },
  // The picture shows the panel open over the shorter results.
  async shot(page, { phase, sleep }) { if (phase === 'after') { await page.click('.yab-block-pill'); await sleep(300); } },
  async expect(page, { sleep }) {
    const visible = await page.evaluate(shown);
    const pill = await page.evaluate(() => document.querySelector('.yab-block-pill')?.textContent);
    await page.click('.yab-block-pill');
    await page.click('.yab-block-panel button:has-text("+ stackoverflow.com")');
    await page.click('.yab-block-panel button:has-text("Save")');
    await sleep(300);
    const later = await page.evaluate(shown);
    const stored = await page.evaluate(k => localStorage.getItem(k), KEY);
    // The picture: back to the two seeded sites.
    await page.evaluate(k => { localStorage.setItem(k, JSON.stringify(['geeksforgeeks.org', 'w3schools.com'])); }, KEY);
    await page.reload({ waitUntil: 'load' });
    await sleep(800);
    const problems = [];
    if (visible.some(h => /(^|\.)(w3schools\.com|geeksforgeeks\.org)$/.test(h))) problems.push(`still shown: ${visible.join(', ')}`);
    if (!visible.includes('docs.python.org') || !visible.includes('realpython.com') || !visible.includes('youtube.com')) problems.push(`missing kept results: ${visible.join(', ')}`);
    if (!/^\d+ hidden · Blocked sites$/.test(pill ?? '')) problems.push(`pill says "${pill}"`);
    if (later.includes('stackoverflow.com') || stored !== JSON.stringify(['geeksforgeeks.org', 'stackoverflow.com', 'w3schools.com'])) problems.push(`after adding stackoverflow.com: ${later.join(', ')}; stored ${stored}`);
    return problems.length ? { ok: false, detail: problems.join('; ') } : { ok: true, detail: `"${pill}"; shown: ${visible.join(', ')}; the panel added stackoverflow.com` };
  },
};
