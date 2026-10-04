---
name: No Autoplay
sites: www.youtube.com
made: Yab recipe
preview: https://www.youtube.com/@mkbhd
checks:
  - on /@*: script trailerStill
  - on /@*: some of ytd-channel-video-player-renderer
  - on /watch: some of #movie_player video
---

On YouTube, play only what I start: don't play channel trailers on their own, don't play previews when I hover over a video, and don't go on to the next video when one ends.
