import { useSyncExternalStore } from 'react';

/**
 * Wide enough (with the sidebar) for the list and a venue side by side. Narrower screens open
 * a venue in a sheet instead.
 */
const WIDE = '(min-width: 1100px)';

function subscribe(onChange: () => void) {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const wideNow = () => window.matchMedia(WIDE).matches;
const wideOnServer = () => false;

export function useWide(): boolean {
  return useSyncExternalStore(subscribe, wideNow, wideOnServer);
}
