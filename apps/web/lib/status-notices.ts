import { StatusNoticesSchema, type StatusNotice, type StatusNotices } from '@lasuatos/contracts';

/**
 * Incident and maintenance notices from the status page (ADR 034), read through
 * LASUATOS's own API so the browser only ever talks to LASUATOS (the Content Security
 * Policy stays 'self'). Any failure means no notice: the banner must never get in the way.
 */
export async function loadStatusNotices(signal?: AbortSignal): Promise<StatusNotices> {
  const response = await fetch('/api/v1/status/notices', { cache: 'no-store', ...(signal ? { signal } : {}) });
  if (!response.ok) return { statusPageUrl: null, notices: [] };
  const parsed = StatusNoticesSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? parsed.data : { statusPageUrl: null, notices: [] };
}

const DISMISSED = 'lasuatos:status-notice-dismissed';

/** A notice dismissed at one update comes back when the next update is posted. */
export function noticeKey(notice: StatusNotice): string {
  return `${notice.id}@${notice.updatedAt}`;
}

export function dismissedNotices(): Set<string> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(DISMISSED) ?? '[]');
    return new Set(Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []);
  } catch {
    return new Set();
  }
}

export function dismissNotice(notice: StatusNotice): void {
  try {
    const keys = [...dismissedNotices(), noticeKey(notice)].slice(-20);
    window.localStorage.setItem(DISMISSED, JSON.stringify(keys));
  } catch {
    // Private mode: it is dismissed until the page reloads.
  }
}

/** The one notice worth showing: what is happening now before what is planned, major first. */
export function pickNotice(notices: readonly StatusNotice[], dismissed: ReadonlySet<string>, now: number): StatusNotice | null {
  const live = notices.filter((notice) => !dismissed.has(noticeKey(notice)));
  const rank = (notice: StatusNotice) => {
    const upcoming = notice.kind === 'maintenance' && notice.startsAt !== null && Date.parse(notice.startsAt) > now;
    if (upcoming) return 3;
    return notice.impact === 'major' ? 0 : notice.impact === 'minor' ? 1 : 2;
  };
  return [...live].sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

const WAT = 'Africa/Lagos';

/** "Sat 14 Nov, 22:00–23:30" in Lagos time, for planned maintenance. */
export function maintenanceWindow(notice: StatusNotice): string | null {
  if (!notice.startsAt) return null;
  const start = new Date(notice.startsAt);
  const day = new Intl.DateTimeFormat('en-GB', { timeZone: WAT, weekday: 'short', day: 'numeric', month: 'short' }).format(start);
  const time = (date: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: WAT, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${day}, ${time(start)}${notice.endsAt ? `–${time(new Date(notice.endsAt))}` : ''}`;
}
