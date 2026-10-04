---
name: Following only
sites: x.com
made: Yab recipe
preview: https://x.com/home
checks:
  - on /home: none of [aria-label='Home timeline'] [data-testid='ScrollSnap-List'] > [role='presentation']:first-child
  - on /home: some of [aria-label='Home timeline'] [role='tab']
---

On X, I only want the Following timeline: hide the For you tab so Following (and any lists I pinned) are the only tabs on Home. This only hides the tab. X may still open Home on For you now and then, and then I tap Following once; opening on Following by itself needs a script, which a plugin can add later.
