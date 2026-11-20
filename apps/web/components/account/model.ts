import type { AccountSession } from '@lasuatos/contracts';
import type { CurrentAccount } from '../../lib/current-account';

/* Pure helpers for the account page (/account/security). Kept apart from the UI so they are tested. */

export type DeviceKind = 'phone' | 'tablet' | 'computer';
export type Device = { readonly kind: DeviceKind; readonly name: string; readonly browser: string | null };

/**
 * This browser in words, from its user agent, e.g. "Android phone" in Chrome. Read in the browser
 * only: LASUATOS does not store device names, so other sign-ins cannot be named this way.
 */
export function deviceFromAgent(agent: string, { touch = false, installed = false }: { touch?: boolean; installed?: boolean } = {}): Device {
  const ua = agent || '';
  let kind: DeviceKind = 'computer';
  let name = 'Computer';
  if (/iPhone|iPod/.test(ua)) {
    kind = 'phone';
    name = 'iPhone';
  } else if (/iPad/.test(ua) || (/Macintosh/.test(ua) && touch)) {
    // iPadOS asks for desktop sites, so it reads as a Mac with a touch screen.
    kind = 'tablet';
    name = 'iPad';
  } else if (/Android/.test(ua)) {
    kind = /Mobile/.test(ua) ? 'phone' : 'tablet';
    name = kind === 'phone' ? 'Android phone' : 'Android tablet';
  } else if (/CrOS/.test(ua)) {
    name = 'Chromebook';
  } else if (/Windows/.test(ua)) {
    name = 'Windows computer';
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    name = 'Mac';
  } else if (/Linux/.test(ua)) {
    name = 'Linux computer';
  }
  let browser: string | null = null;
  if (installed) browser = 'LASUATOS app';
  else if (/Edg(e|A|iOS)?\//.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser\//.test(ua)) browser = 'Samsung Internet';
  else if (/FxiOS\/|Firefox\//.test(ua)) browser = 'Firefox';
  else if (/CriOS\/|Chrome\//.test(ua)) browser = 'Chrome';
  else if (/Safari\//.test(ua)) browser = 'Safari';
  return { kind, name, browser };
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit' });
const shortDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short' });
const fullDate = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' });
const yearOf = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Lagos', year: 'numeric' });

/** "16 Nov", or "16 Nov 2025" outside this year (Lagos time). */
export function dateLabel(iso: string, now: number): string {
  const date = new Date(iso);
  return yearOf.format(date) === yearOf.format(new Date(now)) ? shortDate.format(date) : fullDate.format(date);
}

/** "just now", "5 min ago", "3 hours ago", "yesterday", "4 days ago", then a date. */
export function ago(iso: string, now: number): string {
  const then = new Date(iso).getTime();
  const gap = Math.max(0, now - then);
  if (gap < 2 * MINUTE) return 'just now';
  if (gap < HOUR) return `${Math.floor(gap / MINUTE)} min ago`;
  const yesterday = dayKey.format(new Date(now - DAY));
  if (gap < 12 * HOUR || (gap < DAY && dayKey.format(new Date(then)) !== yesterday)) {
    const hours = Math.floor(gap / HOUR);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  if (dayKey.format(new Date(then)) === yesterday) return 'yesterday';
  if (gap < 7 * DAY) return `${Math.max(2, Math.round(gap / DAY))} days ago`;
  return `on ${dateLabel(iso, now)}`;
}

/** The current sign-in first, then the most recently used. */
export function orderSessions(sessions: readonly AccountSession[]): AccountSession[] {
  const last = (session: AccountSession) => new Date(session.lastSeenAt ?? session.createdAt).getTime();
  return [...sessions].sort((a, b) => Number(b.current) - Number(a.current) || last(b) - last(a));
}

/** Not used for two weeks: probably a phone that was replaced or a shared computer. */
export function isIdle(session: AccountSession, now: number): boolean {
  return now - new Date(session.lastSeenAt ?? session.createdAt).getTime() > 14 * DAY;
}

/** The line under another sign-in, e.g. "Active 3 hours ago · signed in 11 Nov". */
export function sessionLine(session: AccountSession, now: number): string {
  const signedIn = `signed in ${dateLabel(session.createdAt, now)}`;
  const seen = session.lastSeenAt ?? session.createdAt;
  if (isIdle(session, now)) return `Not used since ${dateLabel(seen, now)} · ${signedIn}`;
  return `Active ${ago(seen, now)} · ${signedIn}`;
}

/** What this person is here, under their name: "Student", "Lecturer · Staff no. SP/1234", "Institution administrator". */
export function roleLine(account: CurrentAccount): string {
  if (account.accountType === 'student') return 'Student';
  if (account.accountType === 'lecturer') return 'Lecturer';
  if (account.role === 'institution_administrator') return `Administrator · ${account.institutionName}`;
  return `${account.role === 'faculty_administrator' ? 'Faculty' : 'Department'} administrator · ${account.scope.label}`;
}

/** The footnote under "Your details": who can change what. */
export function detailsNote(account: CurrentAccount): string {
  if (account.accountType === 'student') {
    return account.matricNumberVerified
      ? 'Your name and matric number come from your class list. If either is wrong, ask your HOC to correct it there; it updates everywhere at once.'
      : 'Use your full name as on university records. Your level comes from the first two digits of your matric number, so fix any typo.';
  }
  if (account.accountType === 'lecturer') return 'Students see your name on sessions and registers. Your email is how you sign in; an administrator can change it.';
  return 'Your email is how you sign in. Another administrator can change it.';
}

/** Matric numbers are compared without spaces, in capitals. */
export function normalizeMatric(value: string): string {
  return value.replace(/\s+/g, '').toUpperCase();
}

/** Staff numbers keep single spaces, in capitals. */
export function normalizeStaffNumber(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toUpperCase();
}

/** Names are saved trimmed with single spaces. */
export function tidyName(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export type AccountSheet = 'name' | 'matric' | 'staff' | 'password' | 'face' | 'personal-email';

/** `/account/security#change-password` opens the password sheet; `#face` the new-photos sheet; `#personal-email` the personal-email sheet. */
export function sheetFromHash(hash: string): AccountSheet | null {
  const value = hash.replace(/^#/, '');
  if (value === 'change-password' || value === 'password') return 'password';
  if (value === 'face' || value === 'new-photos') return 'face';
  if (value === 'personal-email') return 'personal-email';
  return null;
}

/** "Signed out 2 other devices." after a password change or "Sign out everywhere else". */
export function signedOutText(count: number): string {
  if (count === 0) return 'No other devices were signed in.';
  return `Signed out ${count} other device${count === 1 ? '' : 's'}.`;
}
