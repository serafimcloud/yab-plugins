---
name: Hide HN scores
sites: news.ycombinator.com
made: Yab recipe
preview: https://news.ycombinator.com/
checks:
  - on /*: none of .score
  - on /*: some of body
---

Hide Hacker News scores while keeping stories and comments.
