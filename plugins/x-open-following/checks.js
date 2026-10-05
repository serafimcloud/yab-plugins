// The selected home tab is Following, or the person chose another one.
boost.check('followingOpen', () => {
  const selected = document.querySelector('[role="tablist"] [role="tab"][aria-selected="true"]');
  return !!selected && (/^following$/i.test(selected.textContent.trim()) || document.documentElement.dataset.yabFollowing === 'left');
});
