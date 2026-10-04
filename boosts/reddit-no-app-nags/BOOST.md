---
name: No Reddit app nags
sites: www.reddit.com
made: Yab recipe
preview: https://www.reddit.com/r/AskReddit/comments/1wsoqrp/whats_a_fact_that_could_save_your_life/
checks:
  - on /*: none of [source='xpromo'], #left-sidebar-container:has([source='xpromo']), auth-flow-google-one-tap-prompt
  - on /*: some of shreddit-app
---

On Reddit when I'm signed out, hide the join and open-in-app banners and the Google sign-in prompt, and give the space back to the post.
