---
name: Hide engagement counts
sites: x.com
made: Yab recipe
preview: https://x.com/home
checks:
  - on /*: none of [data-testid='tweet'] [data-testid='app-text-transition-container']
  - on /*: some of body
---

Hide numerical engagement counts on X tweets, keeping the action buttons.
