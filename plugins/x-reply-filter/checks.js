// Every reply on a post's page has been looked at.
boost.check('repliesSorted', () => {
  const replies = Array.from(document.querySelectorAll('[data-testid="cellInnerDiv"] article[data-testid="tweet"]'));
  return replies.length > 0 && replies.every(article => article.closest('[data-testid="cellInnerDiv"]').hasAttribute('data-yab-replies'));
});
