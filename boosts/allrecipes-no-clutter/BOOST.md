---
name: Just the recipe
sites: www.allrecipes.com
made: Yab recipe
preview: https://www.allrecipes.com/recipe/10813/best-chocolate-chip-cookies/
checks:
  - on /recipe/*: none of [id^='mm-ads-'], .jwplayer.jw-flag-floating .jw-wrapper, [id^='push-sdk-prompt']
  - on /recipe/*: some of #mm-recipes-structured-ingredients__heading_1-0, .mm-recipes-structured-ingredients
---

On Allrecipes, keep the recipe and hide the ads, the video that follows me down the page and the notification prompt.
