// A channel's trailer is not playing unless someone pressed play.
boost.check('trailerStill', () => {
  const trailer = document.querySelector('ytd-channel-video-player-renderer video');
  return !trailer || trailer.paused || trailer.dataset.yabStarted === 'person';
});

