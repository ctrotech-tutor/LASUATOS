'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * A label a page can give the workspace frame when the address alone cannot name it: a missing
 * page says "Page not found" and a crashed one "Something went wrong", so the breadcrumb and the
 * phone bar's title match what is on screen instead of guessing from the URL.
 */
let current: string | null = null;
const listeners = new Set<() => void>();

function set(label: string | null) {
  current = label;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** The label given by the page on screen, or null. */
export function usePageLabelOverride(): string | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

/** Name this page in the frame while it is on screen. */
export function useNameThisPage(label: string) {
  useEffect(() => {
    set(label);
    return () => set(null);
  }, [label]);
}
