---
name: Amazon without Rufus
sites: www.amazon.com
made: Yab recipe
preview: https://www.amazon.com/dp/B0FQFB8FMG
checks:
  - on /*: none of #nav-rufus-disco, .rufus-ingress-div-block
  - on /*: some of #twotabsearchtextbox
  - on /dp/*: some of #productTitle
---

On Amazon, hide Rufus, the shopping assistant (now called Alexa for shopping): the button next to the search bar, its chat panel, the Price history links that open it, and its suggested questions. Search, the cart, prices, Add to Cart and Buy Now stay, and the page keeps its full width.
