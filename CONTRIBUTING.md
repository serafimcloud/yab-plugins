# Contributing

Thanks for making Yab better on a site you use.

- One boost per pull request. Keep the intent short and in plain words; it
  is an instruction for every later repair, so it says what the person wants,
  not how the CSS does it.
- Run `npm run validate` and `node scripts/check.mjs <id>` before you open
  the pull request, and look at `out/pictures/<id>/`. The pull request runs
  the same checks and comments the results.
- Pick a public preview page where the boost visibly changes something. If
  the site needs sign-in for that, the check says "needs sign-in" and the
  listing shows it; that is fine, but say so in the pull request.
- Write American English. No em dashes: a comma, colon or full stop instead.
- Fixing a broken boost: change `page/style.css` and, when the site renamed
  things, the checks in `BOOST.md`. Keep the intent as it is.
- New sites, permissions or owners need a second review; the label is added
  for you.
- By contributing you agree that your work is released under the MIT
  license in `LICENSE`.
