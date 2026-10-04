---
name: DuckDuckGo without AI
sites: duckduckgo.com
made: Yab recipe
preview: https://duckduckgo.com/?q=how+long+to+boil+an+egg&ia=web
checks:
  - on /: none of [data-testid='duckassist-answer-content'], [data-testid='duckbar'] a[href*='ia=chat'], [data-testid='search-form'] [data-testid='ask']
  - on /: some of [data-testid='result']
  - on /: some of [data-testid='search-form'] input
---

On DuckDuckGo, hide the AI: no Search Assist answers above the results, no Duck.ai tab or chat button in the search box. The search box, the tabs for Images, Videos and News, the results and related searches stay.
