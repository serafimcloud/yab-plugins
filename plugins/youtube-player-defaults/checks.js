// The video plays at the remembered speed (1 until one is chosen).
boost.check('speedKept', () => {
  const video = document.querySelector('#movie_player video');
  let speed = 1;
  try { speed = JSON.parse(localStorage.getItem('yab.youtube-player-defaults.speed') ?? '1'); } catch {}
  return !!video && Math.abs(video.playbackRate - speed) < 0.01;
});
