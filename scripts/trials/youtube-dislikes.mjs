// The count beside the dislike button is Return YouTube Dislike's number for
// this video, in YouTube's short style (521K).
const ID = 'dQw4w9WgXcQ';

export default {
  async act(page, { sleep }) {
    await page.evaluate(() => document.querySelector('ytd-watch-metadata')?.scrollIntoView({ block: 'center' }));
    await sleep(1500);
  },
  async expect(page, { until }) {
    const shown = await until(page, () => document.querySelector('dislike-button-view-model .yab-dislikes')?.textContent, null, 15_000);
    const api = await fetch('https://returnyoutubedislikeapi.com/votes?videoId=' + ID).then(r => r.json()).catch(() => null);
    const expected = api ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(api.dislikes) : null;
    if (!shown) return { ok: false, detail: 'no count beside the dislike button' };
    if (expected && shown !== expected) return { ok: false, detail: `shows ${shown}, the API says ${expected}` };
    return { ok: true, detail: `shows ${shown} dislikes (API: ${api?.dislikes})` };
  },
};
