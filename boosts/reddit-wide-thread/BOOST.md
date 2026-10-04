---
name: Wide Reddit threads
sites: www.reddit.com
made: Yab recipe
preview: https://www.reddit.com/r/AskReddit/comments/1wsoqrp/whats_a_fact_that_could_save_your_life/
checks:
  - on /r/*/comments/*: none of #right-sidebar-container, shreddit-comments-page-ad, shreddit-ad-post
  - on /r/*/comments/*: some of shreddit-comment
---

On a Reddit post, give the post and its comments the full width: hide the right rail with related posts and ads, and the ads between comments.
