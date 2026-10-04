---
name: Hide sponsored results
sites: www.amazon.com
made: Yab recipe
preview: https://www.amazon.com/s?k=usb+c+cable
checks:
  - on /s: none of .s-main-slot > .AdHolder, .s-main-slot > div:has(.puis-sponsored-label-text), .s-main-slot > div:has(.s-widget-sponsored-label-text)
  - on /s: some of .s-main-slot > [data-component-type='s-search-result']
---

Hide sponsored products and sponsored shelves in Amazon search results, keep the real results.
