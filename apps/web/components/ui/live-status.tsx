'use client';

import { RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useClock } from '../take-attendance/hooks';

function agoLabel(checkedAt: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - checkedAt) / 1000));
  if (seconds < 60) return 'under a minute ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

/**
 * The one thing a live screen must never do is look live while it is not. When updates stop
 * arriving (no signal in the lecture hall, the server waking up) this says so, how old the
 * picture is, and offers to try at once. It stays out of sight while updates flow; the list
 * keeps showing the last answer either way.
 */
export function LiveLag({ error, checkedAt, onRetry, what = 'list' }: Readonly<{
  error: string | undefined;
  checkedAt: number | undefined;
  onRetry: () => void;
  /** "list", "register"... */
  what?: string;
}>) {
  // The shared fifteen-second clock (0 before the page is live in the browser).
  const clock = useClock('fifteen');
  const now = clock || (checkedAt ?? 0);
  const [trying, setTrying] = useState(false);
  useEffect(() => {
    if (!trying) return undefined;
    const timer = window.setTimeout(() => setTrying(false), 1_500);
    return () => window.clearTimeout(timer);
  }, [trying]);

  // One status region that is always there, so the warning is announced when it appears.
  if (!error) return <div className="sr-only" role="status" />;
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  return (
    <div className="ui-live-lag" role="status">
      <WifiOff size={16} strokeWidth={2.2} aria-hidden="true" />
      <span className="ui-live-lag-text">
        <strong>{offline ? 'You’re offline.' : 'Not updating.'}</strong>{' '}
        {checkedAt ? `This ${what} is from ${agoLabel(checkedAt, now)}.` : error}
      </span>
      <button
        className="ui-live-lag-retry"
        type="button"
        disabled={trying}
        onClick={() => {
          setTrying(true);
          onRetry();
        }}
      >
        <RefreshCw size={14} strokeWidth={2.3} aria-hidden="true" className={trying ? 'is-spinning' : undefined} />
        Try now
      </button>
    </div>
  );
}

/** Read aloud politely to screen readers: who just arrived on a live list. */
export function LiveAnnouncer({ message, round }: Readonly<{ message: string; round: number }>) {
  // The round in the key makes a repeated sentence ("Ada Bello checked in") count as news again.
  return (
    <span className="sr-only" role="status" aria-live="polite">
      <span key={round}>{message}</span>
    </span>
  );
}

/** A number on a live screen that pops briefly when it goes up (not on first draw, not down). */
export function LiveCount({ value, format = (count) => count.toLocaleString('en-NG') }: Readonly<{
  value: number;
  format?: (value: number) => string;
}>) {
  const [last, setLast] = useState(value);
  const [bumps, setBumps] = useState(0);
  // Adjusting state while rendering (React's documented pattern for "on prop change").
  if (value !== last) {
    setLast(value);
    if (value > last) setBumps(bumps + 1);
  }
  return <strong key={bumps} className={bumps ? 'live-bump' : undefined}>{format(value)}</strong>;
}
