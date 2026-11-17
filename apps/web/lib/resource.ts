'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { failureText } from './lecture-api';
import { forgetRememberedAnswers } from './remembered-answers';

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
  /**
   * When the server last answered (Date.now()), changed or not; undefined before any answer.
   * A live screen whose polls keep failing shows how old its picture is.
   */
  readonly checkedAt?: number | undefined;
};

type Entry = {
  snapshot: Resource<unknown>;
  /** When the server last answered. */
  at: number;
  /** When the answer last changed (a new object), for slowing a poll down once nothing moves. */
  changedAt: number;
  inflight: boolean;
};

const EMPTY: Resource<never> = { data: undefined, error: undefined, loading: true };
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();

function entryFor(key: string): Entry {
  let entry = entries.get(key);
  if (!entry) {
    entry = { snapshot: EMPTY, at: 0, changedAt: 0, inflight: false };
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
      const before = entry.snapshot;
      // The same object back (the server said nothing changed): nothing to redraw. The poll
      // only notes when it last heard from the server, without waking the screen.
      if (before.data === data && before.error === undefined && !before.loading) {
        entry.snapshot = { ...before, checkedAt: entry.at };
        return;
      }
      if (before.data !== data) entry.changedAt = entry.at;
      publish(key, { data, error: undefined, loading: false, checkedAt: entry.at });
    })
    .catch((caught: unknown) => {
      if (caught instanceof DOMException && caught.name === 'AbortError') return;
      publish(key, { data: entry.snapshot.data, error: failureText(caught), loading: false, checkedAt: entry.snapshot.checkedAt });
    })
    .finally(() => {
      entry.inflight = false;
    });
}

/** Forgets every cached answer (after signing out, or when the account changes). */
export function clearResources(): void {
  entries.clear();
  forgetRememberedAnswers();
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
    /**
     * A slower poll once nothing has changed for `quietAfter` ms (default 2 minutes): a
     * register fills in the first minutes of a class and then sits still. Any change goes
     * straight back to `poll`.
     */
    readonly pollQuiet?: number;
    readonly quietAfter?: number;
  } = {},
): Resource<T> & { readonly reload: () => void } {
  const { maxAge = 30_000, poll, pollWhile, pollQuiet, quietAfter = 120_000 } = options;
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
    // Back online after a drop: refresh at once instead of waiting for the next poll.
    const onOnline = () => revalidate(key, loader, 0);
    if (poll) window.addEventListener('online', onOnline);
    const timer = poll
      ? window.setInterval(() => {
        if (document.visibilityState !== 'visible' || navigator.onLine === false) return;
        const entry = entryFor(key);
        const data = entry.snapshot.data as T | undefined;
        if (pollWhile && (data === undefined || !pollWhile(data))) return;
        const now = Date.now();
        if (pollQuiet && entry.changedAt && now - entry.changedAt > quietAfter && now - entry.at < pollQuiet - poll / 2) return;
        revalidate(key, loader, 0);
      }, poll)
      : undefined;
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      if (timer) window.clearInterval(timer);
    };
  }, [key, loader, maxAge, poll, pollWhile, pollQuiet, quietAfter]);

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
  entry.changedAt = entry.at;
  publish(key, { data, error: undefined, loading: false, checkedAt: entry.at });
}

/** Marks every answer whose key starts with `prefix` as stale: the next reader fetches it again. */
export function staleResources(prefix: string): void {
  for (const [key, entry] of entries) if (key.startsWith(prefix)) entry.at = 0;
}
