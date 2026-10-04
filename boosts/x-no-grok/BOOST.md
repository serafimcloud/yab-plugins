---
name: X without Grok and upsells
sites: x.com
made: Yab recipe
preview: https://x.com/home
checks:
  - on /*: none of a[href='/i/grok'], [data-testid='GrokDrawer'], article [aria-label*='Grok']
  - on /*: none of a[data-testid='premium-hub-tab'], a[href='/i/premium'], a[href='/i/verified-orgs-signup'], aside[aria-label='Subscribe to Premium']
  - on /*: some of [data-testid='AppTabBar_Home_Link']
  - on /home: some of [data-testid='primaryColumn']
---

On X, take Grok out of the way: no Grok in the side menu, no Grok drawer in the corner, no Grok button on posts (the one that explains a post) or in the composer. Also hide Premium, Business (Verified Orgs), Communities and Jobs from the menus, and the boxes asking me to subscribe to Premium. Everything else stays: Home, Explore, Notifications, Chat, Profile, posting, and every post.
