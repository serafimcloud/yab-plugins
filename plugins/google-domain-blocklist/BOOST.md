---
name: Blocked Sites
sites: www.google.com
made: Yab recipe
preview: https://www.google.com/search?q=python+list+comprehension
checks:
  - on /search: some of .yab-block-pill
  - on /search: some of #rso a h3
  - on /search: script blockedHidden
---

Hide Google search results from sites I don't want to see. Give me a small pill on the results page to add or remove sites, kept on this Mac.
