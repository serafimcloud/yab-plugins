# yab-plugins

Boosts and plugins for Yab's Store. Every listing here is checked on its live
site every day, and the catalog Yab and yetanotherbrowser.com/store read is
built from this repository.

```
boosts/<id>/manifest.json    MV3: content_scripts for the named sites, css only for Look
boosts/<id>/BOOST.md         name, sites, made, preview, checks, then the intent
boosts/<id>/page/style.css   the Look itself
boosts/<id>/listing.json     the store's words: name, intent, host, by, picks, preview, added
plugins/<id>/                code (Page, Tool, App rungs), reviewed releases only
scripts/validate.mjs         the rules below, run on every pull request
scripts/check.mjs            Playwright WebKit: checks before and after, pictures
scripts/catalog.mjs          out/catalog.json, out/b/<revision>/package.boost, out/store/p/
```

## Commands

```sh
npm ci
npx playwright install webkit        # --with-deps on Linux
npm run validate                     # every boost, or: node scripts/validate.mjs <id> ...
npm run check                        # every boost on its live page
node scripts/check.mjs hn-readable   # some boosts
node scripts/check.mjs --changed origin/main...HEAD
npm run catalog                      # after check: out/catalog.json and packages
```

`check.mjs` writes `out/results.json` and `out/pictures/<id>/{before,after}.webp`
(PNG when neither sharp nor cwebp is available). Options: `--jobs <n>`,
`--headed`, `--out <dir>`.

## Adding a boost

1. Make it in Yab first (ask in ⌘J, try it, Keep). Site Controls › boost ›
   Share to Store… writes the listing and opens the pull request for you.
2. By hand: copy a folder in `boosts/`, name it `<site>-<what-it-does>`
   (lowercase letters, numbers, single hyphens), and edit the four files.
   - `BOOST.md` front matter: `name`, `sites` (exact hosts, comma separated),
     `made`, `preview` (a public page on one of the sites where the boost has
     something to change), `checks`. Below it, the intent in the person's
     own words.
   - `manifest.json`: `content_scripts` matching `https://<site>/*` with
     `"css": ["page/style.css"]`, `run_at` `document_end`.
   - `listing.json`: `name` and `intent` as in BOOST.md, `host` is the first
     site without `www.`, `by`, `picks` (false; Yab sets picks), `preview` as
     in BOOST.md, `added` (YYYY-MM-DD).
3. `npm run validate && node scripts/check.mjs <id>`, look at the pictures,
   open the pull request.

## Checks

A check is one line Yab can run in a page without a model, the same grammar
Yab uses (`BoostCheck` in Yab):

```
- on <path glob>: none of <selectors>       no visible element matches
- on <path glob>: some of <selectors>       at least one visible element matches
- on <path glob>: <n> per row in <selector> its first row has n visible children
- on <path glob>: text <words> in <selector> a visible match contains the words
- on <path glob>: script <name>             a function in checks.js (Page rung)
```

The path is matched against `location.pathname` with `*` as a wildcard, so
`on /*` covers every page. Visible means not `display: none`, not
`visibility: hidden`, and with a box (`display: contents` counts its
children). A check on another path is skipped.

A hide boost should have a `none of` check that fails without the boost and
passes with it; that is how the checker knows the preview page still has
something to hide. Style boosts should name the elements they style with
`some of`, so a redesign that renames them fails the check.

## What "Works today" means

`check.mjs` opens the preview page in WebKit at 1280×800 with no cookies,
waits for load and network idle (capped at 10 s), rejects cookie banners
(only buttons such as "Reject all" or "Necessary cookies only"; it never
accepts tracking), scrolls three screens to wake lazy content, then runs the
checks before and after adding the boost's CSS. A boost **works** when every
check passes with the CSS and the CSS changes the computed style of at least
one element. Otherwise:

- **fails**: a check fails with the CSS, or the CSS changes nothing;
- **unchecked**, with a note: `needs sign-in`, `consent page`, `blocked`
  (captcha or bot wall), `blank page`, or `nothing to hide on the preview
  page today` when every `none of` check already passed without the boost.

The catalog shows "Works today" only when the check passed in the last 36
hours. A boost that fails on two checked days running shows "Needs Fix"
(`fix`). One failed day keeps the last pass, which ages out on its own.

## Review rules

- A person merges every pull request (CODEOWNERS).
- Look boosts are CSS only: no `.js` or `.html`, no `url(...)`, `@import`,
  `image-set` or backslash escapes, exact hosts only, no wildcard hosts.
- New sites, new permissions or code, or a new owner (`by`), and any change
  to CODEOWNERS or workflows, get the `second review needed` label and need a
  second reviewer.
- Code (Page, Tool, App) is shared only through a reviewed release in
  `plugins/`, never as a listing in `boosts/`.

## Catalog and packages

`scripts/catalog.mjs` writes the catalog in the format of Yab's
`docs/store.md`, one package per boost at `out/b/<revision>/package.boost`:
`{"payload": {"files", "format": 1, "id", "sites"}, "revision"}` where the
revision is the sha256 of the canonical payload (sorted keys, no spaces, raw
UTF-8), the bytes Yab's `BoostShare.read` verifies. The payload carries every
file of the boost except `listing.json`. The daily workflow publishes `out/`
to the `catalog` branch, with `state/history.json` for the next day's run;
fast-web serves it and fills in `kept`.
