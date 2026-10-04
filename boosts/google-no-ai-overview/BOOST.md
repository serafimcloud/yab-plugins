---
name: Search without AI Overview
sites: www.google.com
made: Yab recipe
preview: https://www.google.com/search?q=how+long+to+boil+an+egg&hl=en
checks:
  - on /search: none of #Odp5De:has([data-subtree='mfc']), [data-subtree='mfc'], a[href*='udm=50']
  - on /search: some of #rso
---

On Google Search, hide the AI Overview and the AI Mode prompts so the results start with the web links.
