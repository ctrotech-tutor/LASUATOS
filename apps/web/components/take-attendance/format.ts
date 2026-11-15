/** Dates, times and counts for taking attendance. Times are Lagos time, on the 24-hour clock. */

import { formatClock } from '../../lib/lecture-api';

const LAGOS = 'Africa/Lagos';
export const numberFormat = new Intl.NumberFormat('en-NG');
const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone: LAGOS, year: 'numeric', month: '2-digit', day: '2-digit' });
const weekdayDay = new Intl.DateTimeFormat('en-NG', { timeZone: LAGOS, weekday: 'long', day: 'numeric', month: 'long' });
const shortDay = new Intl.DateTimeFormat('en-NG', { timeZone: LAGOS, weekday: 'short', day: 'numeric', month: 'short' });
const withYear = new Intl.DateTimeFormat('en-NG', { timeZone: LAGOS, day: 'numeric', month: 'short', year: 'numeric' });

/** YYYY-MM-DD in Lagos. */
export function lagosDay(value: string | Date): string {
  return isoDay.format(new Date(value));
}

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A day heading in the history: "Today", "Yesterday", "Friday 13 November", or "3 Mar 2025". */
export function dayHeading(day: string, today: string): string {
  const gap = today ? daysBetween(day, today) : 99;
  if (gap === 0) return 'Today';
  if (gap === 1) return 'Yesterday';
  const date = new Date(`${day}T12:00:00Z`);
  if (day.slice(0, 4) !== today.slice(0, 4)) return withYear.format(date);
  return weekdayDay.format(date).replace(',', '');
}

/** "12:19–13:19". */
export function timeRange(startsAt: string, endsAt: string): string {
  return `${formatClock(startsAt)}–${formatClock(endsAt)}`;
}

/** "Today, 12:19–13:19" or "Fri 13 Nov, 11:15–12:15" for a session's header. */
export function whenLine(startsAt: string, endsAt: string, today: string): string {
  const day = lagosDay(startsAt);
  const label = day === today ? 'Today' : shortDay.format(new Date(startsAt)).replace(',', '');
  return `${label}, ${timeRange(startsAt, endsAt)}`;
}

/** "15 min", "1 hr", "1 hr 30 min". */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} hr ${rest} min` : `${hours} hr`;
}

/** "34 min left", "1 hr 5 min left", or null once the time is up. */
export function remainingLabel(endsAt: string, now: Date): string | null {
  const ms = new Date(endsAt).getTime() - now.getTime();
  if (ms <= 0) return null;
  const minutes = Math.ceil(ms / 60_000);
  if (minutes < 60) return `${minutes} min left`;
  const rest = minutes % 60;
  return `${Math.floor(minutes / 60)} hr${rest ? ` ${rest} min` : ''} left`;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${numberFormat.format(count)} ${count === 1 ? one : many}`;
}

/** "AO" for "Aisha Ogunbiyi"; "OA" for "OKAFOR Adaeze". */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? '' : '';
  return `${first}${last}`.toUpperCase();
}
