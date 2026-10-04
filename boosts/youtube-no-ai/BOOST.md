---
name: YouTube without AI and Premium nags
sites: www.youtube.com
made: Yab recipe
preview: https://www.youtube.com/watch?v=MM-C3JqCXBk
checks:
  - on /watch: none of .you-chat-entrypoint-button, yt-video-description-youchat-section-view-model, ytd-engagement-panel-section-list-renderer[target-id='PAyouchat'], video-summary-content-view-model
  - on /watch: none of .ytp-menuitem:has(.ytp-premium-label), ytd-mealbar-promo-renderer, ytd-banner-promo-renderer
  - on /watch: some of ytd-watch-metadata
  - on /watch: some of like-button-view-model
---

On YouTube, hide the AI extras: the Ask button under videos, its chat panel and the AI summary in the description. Also hide Premium upsells: paid quality choices such as 1080p Premium, the Premium entry in the menu, and Premium promo bars and banners. The player, likes, Share, Save, the description and comments stay.
