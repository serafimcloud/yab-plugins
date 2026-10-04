---
name: Hide Shorts
sites: www.youtube.com
made: Yab recipe
preview: https://www.youtube.com/results?search_query=minecraft
checks:
  - on /*: none of ytd-reel-shelf-renderer, ytd-rich-shelf-renderer[is-shorts], grid-shelf-view-model:has(a[href^='/shorts/']), a[href^='/shorts/']
  - on /*: some of body
---

Hide YouTube Shorts shelves and Shorts links.
