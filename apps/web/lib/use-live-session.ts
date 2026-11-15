'use client';

import type { LectureSessionSummary } from '@lasuatos/contracts';
import { useEffect, useState } from 'react';
import { LIVE_SESSIONS_CHANGED_EVENT, loadMyLiveSessions } from './lecture-api';
import { useVisiblePolling } from './use-live';

export type LiveSessionState = {
  /** The most recent session this person opened that is still taking attendance. */
  readonly session: LectureSessionSummary | null;
  /** How many of their sessions are open (usually one). */
  readonly count: number;
  /** When the remaining time was last worked out (ms); ticks every 15 seconds. */
  readonly now: number;
};

const EMPTY: LiveSessionState = { session: null, count: 0, now: 0 };

/**
 * The live indicator in the app frame: whether the person has a session open, so they can get
 * back to the QR code from any page. Asks every 30 seconds while the app is on screen (a small
 * answer: open sessions only), again on navigation, and at once when this browser opens or
 * closes a session. Failures keep the last answer.
 */
export function useLiveSession(enabled: boolean, pathname: string): LiveSessionState {
  const [state, setState] = useState<LiveSessionState>(EMPTY);
  const [changes, setChanges] = useState(0);

  useEffect(() => {
    if (!enabled) return undefined;
    const bump = () => setChanges((value) => value + 1);
    window.addEventListener(LIVE_SESSIONS_CHANGED_EVENT, bump);
    return () => window.removeEventListener(LIVE_SESSIONS_CHANGED_EVENT, bump);
  }, [enabled]);

  useVisiblePolling(async (signal) => {
    if (!enabled) return null;
    const list = await loadMyLiveSessions(signal);
    if (signal.aborted) return null;
    const now = Date.now();
    const open = list.sessions.filter((session) => session.status === 'open' && Date.parse(session.endsAt) > now);
    setState({ session: open[0] ?? null, count: open.length, now });
    return 30_000;
  }, [enabled, pathname, changes], 60_000);

  // The minutes left move on between answers.
  const live = enabled && state.session !== null;
  useEffect(() => {
    if (!live) return undefined;
    const timer = window.setInterval(() => {
      setState((current) => {
        if (!current.session) return current;
        const now = Date.now();
        return Date.parse(current.session.endsAt) > now ? { ...current, now } : EMPTY;
      });
    }, 15_000);
    return () => window.clearInterval(timer);
  }, [live]);

  return enabled ? state : EMPTY;
}
