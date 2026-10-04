---
name: YouTube home without recommendations
sites: www.youtube.com
made: Yab recipe
preview: https://www.youtube.com/
checks:
  - on /: none of ytd-browse[page-subtype='home'] ytd-rich-item-renderer, ytd-browse[page-subtype='home'] ytd-rich-shelf-renderer, ytd-browse[page-subtype='home'] yt-chip-cloud-chip-renderer
  - on /: some of input[name='search_query']
  - on /feed/subscriptions: some of ytd-browse[page-subtype='subscriptions'] ytd-rich-item-renderer
---

On YouTube, open to a calm home page: no grid of recommended videos, no Shorts shelves and no topic chips on Home. Search, the side menu, Subscriptions, my channels, history and playlists all stay, so I go to what I came for.
