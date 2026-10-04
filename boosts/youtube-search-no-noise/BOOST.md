---
name: Plain search results
sites: www.youtube.com
made: Yab recipe
preview: https://www.youtube.com/results?search_query=lofi
checks:
  - on /results: none of ytd-search ytd-shelf-renderer, ytd-search grid-shelf-view-model, ytd-search ytd-reel-shelf-renderer, ytd-search ytd-horizontal-card-list-renderer
  - on /results: some of ytd-search ytd-video-renderer
---

In YouTube search, show only the videos and channels I searched for: hide shelves like People also watched, For you, Latest from a channel, Shorts and ads.
