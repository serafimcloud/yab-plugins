# Plugins

Boosts with code (the Page, Tool and App rungs) live here once they have a
reviewed release: `tools.js`, `service.js`, `app/`, `skills/`, `commands.json`.
Look boosts go in `boosts/`.

Try one outside Yab with `scripts/try-service.mjs`: service ticks with storage
carried over and fixtures to stage a change, tools against their live API,
and pictures of app pages:

```sh
node scripts/try-service.mjs hn-mention-watch --ticks 2 --storage '{"words":["webkit"]}'
node scripts/try-service.mjs github-tools --evals
node scripts/try-service.mjs github-release-watch --storage '{"repos":[{"repo":"oven-sh/bun"}]}' --shot out/app.png
```
