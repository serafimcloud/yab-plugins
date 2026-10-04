// Following First: X's home opens on Following.
//
// Each arrival at /home selects Following once. Choosing For you afterwards
// is left alone until the next arrival.
let arrived = null;
let tries = 0;

function tabs() {
  return Array.from(document.querySelectorAll('[role="tablist"] [role="tab"]'));
}

function choose() {
  if (location.pathname !== '/home') { arrived = null; return; }
  if (arrived === 'done') return;
  if (arrived === null) { arrived = 'waiting'; tries = 0; delete document.documentElement.dataset.yabFollowing; }
  // X draws the tabs after the page loads: give it ten seconds.
  if (++tries > 20) { arrived = 'done'; return; }
  const list = tabs();
  const following = list.find(tab => /^following$/i.test(tab.textContent.trim()));
  if (!following) return;
  arrived = 'done';
  if (following.getAttribute('aria-selected') !== 'true') following.click();
}

// A person's own click on another tab after arriving: leave it.
boost.on(document, 'click', event => {
  if (!event.isTrusted || !(event.target instanceof Element)) return;
  const tab = event.target.closest('[role="tablist"] [role="tab"]');
  if (tab && !/^following$/i.test(tab.textContent.trim())) document.documentElement.dataset.yabFollowing = 'left';
}, true);

const timer = setInterval(choose, 500);
boost.cleanup(() => {
  clearInterval(timer);
  delete document.documentElement.dataset.yabFollowing;
});
choose();
