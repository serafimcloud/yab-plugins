---
name: Quiet Replies
sites: x.com
made: Yab recipe
preview: https://x.com/jack/status/20
checks:
  - on /*/status/*: script repliesSorted
  - on /*/status/*: some of article[data-testid="tweet"]
---

On X, under a post, fold the replies from paid blue-check accounts and from handles that end in five or more digits into one line that says how many are hidden, with Show to open them.
