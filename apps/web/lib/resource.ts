'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { failureText } from './lecture-api';

/**
 * Small cached reads for dashboards. A result is kept in memory for the life of the tab, so
 * coming back to a screen shows the last answer at once while a fresh one loads in the
 * background (stale-while-revalidate). Screens refresh when they come back into view, and can
 * poll while visible. Requests are not aborted on unmount: their answer is still worth caching.
 */

export type Resource<T> = {
  readonly data: T | undefined;
  /** Set when the last attempt failed; `data` keeps the previous answer, if any. */
  readonly error: string | undefined;
  /** True until the first answer (or failure) arrives. */
  readonly loading: boolean;
};

type Entry = {
  snapshot: Resource<unknown>;
  at: number;
  inflight: boolean;
};

const EMPTY: Resource<never> = { data: undefined, error: undefined, loading: true };
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function entryFor(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { snapshot: EMPTY, at: 0, inflight: false };
    entries.set(key, entry);
  }
  return entry;
}

function publish(key: string, snapshot: Resource<unknown>) {
  entryFor(key).snapshot = snapshot;
  listeners.get(key)?.forEach((listener) => listener());
}

/** Fetches `key` unless a fresh enough answer (younger than `maxAge` ms) or a request is already there. */
export function revalidate<T>(key: string, loader: (signal: AbortSignal) => Promise<T>, maxAge = 0): void {
  const entry = entryFor(key);
  if (entry.inflight) return;
  if (entry.snapshot.data !== undefined && Date.now() - entry.at < maxAge) return;
  entry.inflight = true;
  const controller = new AbortController();
  loader(controller.signal)
    .then((data) => {
      entry.at = Date.now();
      publish(key, { data, error: undefined, loading: false });
    })
    .catch((caught: unknown) => {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      publish(key, { data: entry.snapshot.data, error: failureText(caught), loading: false });
    })
    .finally(() => {
      entry.inflight = false;
    });
}

/** Forgets every cached answer (after signing out, or when the account changes). */
export function clearResources(): void {
  entries.clear();
}

/**
 * Reads `key` through the cache. `loader` must be stable (defined at module level or memoised).
 * Pass `null` as the key to skip loading (for example, when the account may not see it).
 */
export function useResource<T>(
  key: string | null,
  loader: (signal: AbortSignal) => Promise<T>,
  options: {
    readonly maxAge?: number;
    readonly poll?: number;
    /** Polls only while this holds for the last answer (module-level, so it stays stable). */
    readonly pollWhile?: (data: T) => boolean;
  } = {},
): Resource<T> & { readonly reload: () => void } {
  const { maxAge = 30_000, poll, pollWhile } = options;
  const subscribe = useCallback((listener: () => void) => {
    if (!key) return () => undefined;
    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  }, [key]);
  const snapshot = useSyncExternalStore(
    subscribe,
    () => (key ? entryFor(key).snapshot : EMPTY),
    () => EMPTY,
  ) as Resource<T>;

  useEffect(() => {
    if (!key) return undefined;
    revalidate(key, loader, maxAge);
    const onVisible = () => {
      if (document.visibilityState === 'visible') revalidate(key, loader, maxAge);
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = poll
      ? window.setInterval(() => {
        if (document.visibilityState !== 'visible') return;
        const data = entryFor(key).snapshot.data as T | undefined;
        if (pollWhile && (data === undefined || !pollWhile(data))) return;
        revalidate(key, loader, 0);
      }, poll)
      : undefined;
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      if (timer) window.clearInterval(timer);
    };
  }, [key, loader, maxAge, poll, pollWhile]);

  const reload = useCallback(() => {
    if (key) revalidate(key, loader, 0);
  }, [key, loader]);

  return key ? { ...snapshot, reload } : { data: undefined, error: undefined, loading: false, reload };
}

/** The cached answer for `key`, if any, without subscribing (e.g. a list row to draw a detail page at once). */
export function peekResource<T>(key: string): T | undefined {
  return entries.get(key)?.snapshot.data as T | undefined;
}

/** Stores an answer the screen already has (after a change), so every reader updates at once. */
export function primeResource<T>(key: string, data: T): void {
  const entry = entryFor(key);
  entry.at = Date.now();
  publish(key, { data, error: undefined, loading: false });
}

/** Marks every answer whose key starts with `prefix` as stale: the next reader fetches it again. */
export function staleResources(prefix: string): void {
  for (const [key, entry] of entries) if (key.startsWith(prefix)) entry.at = 0;
}
