/**
 * Calls `done` once the page has stopped scrolling (a smooth scroll to a
 * #section has landed). Uses the `scrollend` event where the browser has it,
 * otherwise waits for a short quiet spell after the last `scroll` event. A
 * safety timeout makes sure `done` always runs, even if nothing scrolled.
 * Returns a function that cancels the wait.
 */
export function whenScrollSettles(done: () => void, maxWait = 1600): () => void {
  let finished = false;
  let quiet = 0;
  const supportsScrollEnd = 'onscrollend' in window;
  const finish = () => {
    if (finished) return;
    finished = true;
    cleanup();
    done();
  };
  const onScroll = () => {
    window.clearTimeout(quiet);
    // With `scrollend` the browser says when it has landed; otherwise wait for a quiet spell.
    if (!supportsScrollEnd) quiet = window.setTimeout(finish, 140);
  };
  const safety = window.setTimeout(finish, maxWait);
  // Nothing may scroll at all (already there): settle after the quiet spell.
  quiet = window.setTimeout(finish, 220);
  if (supportsScrollEnd) window.addEventListener('scrollend', finish, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  function cleanup() {
    window.clearTimeout(quiet);
    window.clearTimeout(safety);
    window.removeEventListener('scrollend', finish);
    window.removeEventListener('scroll', onScroll);
  }
  return () => { finished = true; cleanup(); };
}
