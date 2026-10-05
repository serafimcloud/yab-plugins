# Plugins

Boosts with code: the Page, Tool and App rungs. A folder here has the same
files as a boost in `boosts/` plus its code: `page/page.js` (a script on the
named sites), `checks.js` (checks that need code), `tools.js`, `service.js`,
`app/`, `skills/`, `commands.json`. Look boosts (CSS only) go in `boosts/`.

## Rules

`npm run validate` checks the same rules as a boost, and Yab's rules for code
(`BoostPackage.read` in Yab):

- Readable code: no line over 2,000 bytes, no invisible or
  direction-changing Unicode, no `eval`, `new Function` or `import()`
  anywhere (comments and strings too). Page scripts must parse as the body of
  `function (boost) { ... }`, which is how Yab runs them.
- Content scripts on exact hosts, main frame only, `document_end` or
  `document_idle`; at most 32 files and 512 KB.
- `yab` metadata with the keys Yab reads. A plugin that talks to an API on
  another site names it in `"yab": {"hosts": [...]}`: one to four exact host
  names, not one of its sites. The page script's `fetch` may reach them
  (GET or POST, JSON, no cookies, no redirects); nothing else leaves the
  site.

## Review

A plugin reaches the Store only when a person has read its code: they add
`review.json` next to `manifest.json`,

```json
{"by": "serafimcloud", "date": "2026-10-04", "commit": "4ac91e2"}
```

with `commit` optional (the last commit that changed the plugin otherwise).
`by` says honestly who read it; a review by an AI says so, as in
`"Claude (AI review)"`, and still wants a person's second review.
`catalog.mjs` lists a plugin only with a review; its item carries `rung`,
`rights` (the Keep card's words, with "Talks to <hosts>." for `yab.hosts`)
and `reviewed`. `review.json` and `listing.json` stay out of the package, so
the reviewed revision is the one Yab installs. Any change to a plugin's files
needs a second reviewer. `node scripts/catalog.mjs --unreviewed` lists the
others too (`reviewed: null`) for trying the catalog locally; Yab does not
install them.

Plugins with no page scripts (a service, tools or an app page) have no page
for the daily check: the catalog lists them as unchecked, "no page to
check", and `scripts/try-service.mjs` tries them.

## Trying a plugin

```sh
node scripts/try-plugin.mjs youtube-sponsor-skip --pics /tmp/pics
```

`try-plugin.mjs` opens the plugin's preview page in WebKit twice: as it is,
and with the plugin running in a stand-in for Yab's page sandbox (its code
as the body of `function (boost)`, at `document_end`, with `boost.on`,
`boost.observe`, `boost.cleanup`, `boost.check`, and a `fetch` limited to
the site and its `yab.hosts`). Playwright cannot make WebKit's separate
content world, so the plugin shares the page's world there; the page's own
CSP still applies, as in Yab. It then runs the BOOST.md checks (script checks
included) and the plugin's trial in `scripts/trials/<id>.mjs`: what to do on
the page and what must be true after, plus extra cases on other pages. Sites
that need sign-in (X) or show automated browsers a captcha (Google) are
tried on a saved page in `scripts/fixtures/` served at the real address, and
the result says so. Results go to `out/results.json` like `check.mjs`'s, and
pictures to `out/pictures/<id>/`.

Services, tools and app pages are tried with `scripts/try-service.mjs`:
service ticks with storage carried over and fixtures to stage a change, tools
against their live API, and pictures of app pages:

```sh
node scripts/try-service.mjs hn-mention-watch --ticks 2 --storage '{"words":["webkit"]}'
node scripts/try-service.mjs github-tools --evals
node scripts/try-service.mjs github-release-watch --storage '{"repos":[{"repo":"oven-sh/bun"}]}' --shot out/app.png
```

## Plugins here

| Plugin | What it does | Talks to |
|---|---|---|
| `youtube-sponsor-skip` | Skips SponsorBlock's sponsor, intro, outro and self-promotion segments, with a short note and Undo | sponsor.ajay.app (by a 4-character hash prefix of the video id) |
| `youtube-dislikes` | Return YouTube Dislike's estimate beside the dislike button | returnyoutubedislikeapi.com |
| `youtube-player-defaults` | Remembered speed (`[` and `]`), highest or last chosen quality, theater mode, "Continue watching?" answered | |
| `youtube-no-autoplay` | No channel trailers, hover previews or next video by themselves | |
| `x-reply-filter` | Folds replies from paid blue checks and handles ending in five digits behind "N hidden · Show" | |
| `x-open-following` | Home opens on Following | |
| `hn-side-by-side` | The article above the comments, read later, new comments since the last visit | |
| `feed-pause` | Five seconds before the X, YouTube or Reddit feed, once per 30 minutes per site | |
| `google-domain-blocklist` | Hides results from listed sites, edited from a pill on the results page | |
| `absolute-dates` | Real dates beside "3 weeks ago" on Reddit and YouTube videos | |
| `amazon-price-watch` | Hourly price and stock check of watched Amazon items, a notification on a 10% drop | |
| `github-release-watch` | New releases of watched repositories, with what's new | |
| `hn-mention-watch` | New Hacker News stories and comments that name the watched words | |
| `github-tools` | Tools for agents: reviews waiting, CI status, prefilled issues on public repos | |
