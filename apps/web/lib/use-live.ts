'use client';

import { useEffect, useRef, useState } from 'react';

/** True while the page is visible and the device is online. */
export function usePageActive(): boolean {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const update = () => setActive(document.visibilityState === 'visible' && navigator.onLine !== false);
    update();
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return active;
}

/**
 * Runs `task` now and then repeatedly, but only while the page is visible:
 * background tabs and locked phones stop polling (saving data and battery),
 * and the task runs again the moment the page comes back.
 *
 * `task` returns the delay before the next run in ms (or null to stop);
 * failures back off to `errorDelayMs`.
 */
export function useVisiblePolling(
  task: (signal: AbortSignal) => Promise<number | null>,
  dependencies: readonly unknown[],
  errorDelayMs = 10_000,
): void {
  const taskRef = useRef(task);
  useEffect(() => {
    taskRef.current = task;
  });

  useEffect(() => {
    const controller = new AbortController();
    let timer: number | undefined;
    let running = false;

    const schedule = (delay: number | null) => {
      window.clearTimeout(timer);
      if (delay === null || controller.signal.aborted) return;
      timer = window.setTimeout(() => void run(), delay);
    };

    async function run() {
      if (running || controller.signal.aborted) return;
      if (document.visibilityState !== 'visible') return; // resumes on visibilitychange
      running = true;
      try {
        schedule(await taskRef.current(controller.signal));
      } catch {
        if (!controller.signal.aborted) schedule(errorDelayMs);
      } finally {
        running = false;
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        window.clearTimeout(timer);
        void run();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    void run();
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}

/**
 * Keeps the screen awake while `enabled` (e.g. a QR code on a projector).
 * Silently does nothing where the Wake Lock API is unavailable.
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || !('wakeLock' in navigator)) return undefined;
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      if (document.visibilityState !== 'visible') return;
      try {
        sentinel = await navigator.wakeLock.request('screen');
        if (cancelled) void sentinel.release();
      } catch {
        sentinel = null;
      }
    };
    // The lock is dropped when the tab is hidden; take it again on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (!sentinel || sentinel.released)) void acquire();
    };
    void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (sentinel && !sentinel.released) void sentinel.release();
    };
  }, [enabled]);
}

/** A short vibration on phones that support it, e.g. after a successful check-in. */
export function haptic(pattern: number | number[] = 18): void {
  try {
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) navigator.vibrate(pattern);
  } catch {
    // Some browsers throw when vibration is blocked; it is only a nicety.
  }
}
