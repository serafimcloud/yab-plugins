// This discussion is remembered for the next visit.
boost.check('visitRemembered', () => {
  const id = new URLSearchParams(location.search).get('id');
  try { return !!JSON.parse(localStorage.getItem('yab.hn-side-by-side.seen') ?? '{}')[id]; } catch { return false; }
});
