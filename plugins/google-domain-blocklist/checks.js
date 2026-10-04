// No visible result links to a blocked site.
boost.check('blockedHidden', () => {
  let list = [];
  try { list = JSON.parse(localStorage.getItem('yab.google-domain-blocklist.domains') ?? '[]'); } catch {}
  const blocked = host => list.some(domain => host === domain || host.endsWith('.' + domain));
  return Array.from(document.querySelectorAll('#rso a[href] h3')).every(title => {
    const link = title.closest('a');
    let host = '';
    try { host = new URL(link.href).hostname.replace(/^www\./, ''); } catch {}
    return !blocked(host) || !link.getClientRects().length;
  });
});
