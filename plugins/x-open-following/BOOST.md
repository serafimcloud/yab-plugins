---
name: Following First
sites: x.com
made: Yab recipe
preview: https://x.com/home
checks:
  - on /home: some of [role="tablist"] [role="tab"][aria-selected="true"]
  - on /home: script followingOpen
---

When I open X's home timeline, show the Following tab instead of For you. If I switch back to For you, leave it.
