---
name: Show media without blur
sites: x.com
made: Yab recipe
preview: https://x.com/home
checks:
  - on /*: some of [data-testid='AppTabBar_Home_Link']
  - on /home: some of article [data-testid='tweetPhoto'], article [data-testid='videoPlayer']
---

On X, show photos and videos in posts as they are, without the blur X puts over media it marks as possibly sensitive, so I don't have to click Show on each one. Only the blur goes; the posts, their text and the rest of the page stay as they are.
