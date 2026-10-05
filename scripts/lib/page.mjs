// Page helpers shared by check.mjs (Look boosts) and try-plugin.mjs
// (plugins): Yab's check evaluation, walls, consent banners, settling.
// Functions passed to page.evaluate are self-contained.
export const IDLE_CAP = 10_000;

// Runs in the page. The same evaluation as Yab's report() in BoostScript.swift:
// checks count only visible elements, `display: contents` counts its children.
export function evaluateChecks({ checks, cssText }) {
  function visible(e) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden') return false; return s.display === 'contents' ? Array.from(e.children).some(visible) : e.getClientRects().length > 0; }
  const glob = (pattern, value) => new RegExp('^' + pattern.split('*').map(x => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(value);
  const results = checks.map(c => {
    if (!glob(c.path, location.pathname)) return { line: c.line, state: 'skipped', reason: 'Another page' };
    try {
      if (c.kind === 'script') {
        // try-plugin.mjs runs checks.js and keeps its functions here.
        const fn = window.__yabTry?.checks?.[c.selector];
        if (!fn) return { line: c.line, state: 'skipped', reason: 'Script checks need checks.js in Yab' };
        const answer = fn();
        return { line: c.line, state: answer === true ? 'pass' : 'fail', reason: typeof answer === 'boolean' ? '' : 'Checks must return a boolean synchronously' };
      }
      const all = Array.from(document.querySelectorAll(c.selector)), shown = all.filter(visible);
      let pass = false, found = shown.length;
      if (c.kind === 'none') pass = shown.length === 0;
      if (c.kind === 'some') pass = shown.length > 0;
      if (c.kind === 'text') pass = shown.some(e => e.textContent.includes(c.words));
      if (c.kind === 'rows') {
        const children = shown.flatMap(e => Array.from(e.children).filter(visible));
        const top = children.length ? Math.min(...children.map(e => e.getBoundingClientRect().top)) : NaN;
        found = children.filter(e => Math.abs(e.getBoundingClientRect().top - top) < 3).length;
        pass = found === c.count;
      }
      return { line: c.line, state: pass ? 'pass' : 'fail', found, present: all.length };
    } catch (e) { return { line: c.line, state: 'fail', error: String(e) }; }
  });
  // How many elements each of the boost's own selectors finds right now.
  const matched = {};
  const sheet = new CSSStyleSheet();
  try { sheet.replaceSync(cssText); } catch {}
  const walk = list => { for (const rule of list) {
    if (rule.selectorText) { try { matched[rule.selectorText] = document.querySelectorAll(rule.selectorText).length; } catch { matched[rule.selectorText] = -1; } }
    if (rule.cssRules) walk(rule.cssRules);
  } };
  walk(sheet.cssRules);
  return { path: location.pathname, checks: results, matched };
}

// Runs in the page: is this a wall rather than the page the boost is for?
export function detectWall() {
  const text = (document.body?.innerText ?? '').slice(0, 20000);
  const title = document.title;
  const shown = s => Array.from(document.querySelectorAll(s)).some(e => { const r = e.getBoundingClientRect(); return r.width > 30 && r.height > 30; });
  // A page that is mostly a challenge: little text, and a challenge title, form or widget.
  const thin = text.trim().length < 1500;
  if (/just a moment|attention required|access denied|are you a robot|verify you are human|security check/i.test(title) || /[?&]__cf_chl_/.test(location.search) && thin) return 'blocked';
  if (thin && shown('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="challenges.cloudflare.com"], iframe[src*="arkoselabs"], #challenge-form, #challenge-stage, .cf-turnstile')) return 'blocked';
  if (/sign in to confirm (that )?you('|\u2019)re not a bot|unusual traffic from your computer|you('|\u2019)ve been blocked by network security|whoa there, pardner|please verify you are a human/i.test(text)) return 'blocked';
  if (/(^|\.)consent\.(youtube|google)\.com$/.test(location.hostname)) return 'consent page';
  if (/(?:^|\/)(?:login|signin|sign-in|auth|oauth|i\/flow\/login|onboarding)(?:\/|$)/i.test(location.pathname)) return 'needs sign-in';
  if (thin && shown('input[type="password"]')) return 'needs sign-in';
  if (!text.trim()) return 'blank page';
  return null;
}

// Never accept tracking: only buttons that reject or keep the necessary ones.
export const REJECT = /^(?:(?:reject|decline|refuse)(?: all| optional| non-essential| additional)?(?: cookies)?|(?:use |allow )?(?:only )?(?:necessary|essential|required)(?: cookies)? only|(?:use |allow )?only (?:allow )?(?:necessary|essential|required)(?: cookies)?)$/i;

// Locator.count() takes no timeout and never settles in some ad frames, so
// every frame gets a bounded look.
const bounded = (promise, ms, fallback) => Promise.race([promise.catch(() => fallback), new Promise(resolve => setTimeout(() => resolve(fallback), ms))]);

export async function dismissConsent(page) {
  for (let round = 0; round < 2; round++) {
    let clicked = false;
    for (const frame of page.frames()) {
      // Frames without a URL (ad slots written by script) hold no consent banner.
      const url = frame.url();
      if (frame !== page.mainFrame() && (!url || url === 'about:blank' || frame.isDetached())) continue;
      try {
        const buttons = frame.locator('button, [role="button"], input[type="button"], input[type="submit"], a[role="button"]');
        const count = Math.min(await bounded(buttons.count(), 2000, 0), 300);
        for (let i = 0; i < count && !clicked; i++) {
          const b = buttons.nth(i);
          const label = ((await b.innerText({ timeout: 500 }).catch(() => '')) || (await b.getAttribute('aria-label', { timeout: 500 }).catch(() => '')) || (await b.getAttribute('value', { timeout: 500 }).catch(() => '')) || '').trim().replace(/\s+/g, ' ');
          if (REJECT.test(label) && await b.isVisible().catch(() => false)) {
            await b.click({ timeout: 3000 }).catch(() => {});
            clicked = true;
          }
        }
      } catch {}
      if (clicked) break;
    }
    if (!clicked) return round > 0;
    await page.waitForLoadState('load', { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);
  }
  return true;
}

export async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: IDLE_CAP }).catch(() => {});
  // Like Yab, check once the page has been still for a moment.
  await page.waitForTimeout(1500);
}

// A challenge page that solves itself (Cloudflare's) gets up to 20 s.
export async function waitOutChallenge(page) {
  for (let waited = 0; waited < 20_000; waited += 2000) {
    const wall = await page.evaluate(detectWall).catch(() => 'blocked');
    if (wall !== 'blocked' && wall !== 'blank page') return;
    await page.waitForTimeout(2000);
  }
}

