// The segment list for the open video has been asked for and read
// (a video without segments counts: SponsorBlock answered).
boost.check('segmentsLoaded', () => {
  const player = document.querySelector('#movie_player');
  const id = new URLSearchParams(location.search).get('v');
  return !!player && player.dataset.yabSponsorVideo === id;
});
