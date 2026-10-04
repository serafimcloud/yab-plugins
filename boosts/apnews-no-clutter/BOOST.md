---
name: Quiet AP articles
sites: apnews.com
made: Yab recipe
preview: https://apnews.com/article/hemp-marijuana-cannabis-thc-mcconnell-a6f2a02b40c7c5d33d99c84f3221e93f
checks:
  - on /article/*: none of .LeaderBoardAd-Web, .FreeStar.Advertisement, [id^='primis_player'], iframe.dianomi-parent-iframe, [class^='ap-newsletter-embed']
  - on /article/*: some of .RichTextStoryBody, h1
---

On AP News articles, keep the story and its photos and hide the ads, the video that floats in the corner, paid content blocks and newsletter sign-up boxes.
