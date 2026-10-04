---
name: Bing without Copilot
sites: www.bing.com
made: Yab recipe
preview: https://www.bing.com/search?q=how+long+to+boil+an+egg&setlang=en
checks:
  - on /search: none of #copans_container, #b_copilot_search_container, #b-scopeListItem-copilotsearch, a[href^='/copilotsearch']
  - on /search: some of #b_results > li.b_algo
  - on /search: some of #sb_form_q
---

On Bing, hide Copilot: the AI answer above the results, the AI Mode tab, and the Copilot question box and suggestions under the results, so the page starts with the web links.
