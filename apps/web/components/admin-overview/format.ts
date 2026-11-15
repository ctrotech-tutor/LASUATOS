/** Dates, times and trends for the administration overview. Times are shown in Lagos time. */

const LAGOS = 'Africa/Lagos';
export const numberFormat = new Intl.NumberFormat('en-NG');
const isoDay = new Intl.DateTimeFormat('en-CA', { timeZone: LAGOS, year: 'numeric', month: '2-digit', day: '2-digit' });
const clock = new Intl.DateTimeFormat('en-NG', { timeZone: LAGOS, hour: 'numeric', minute: '2-digit' });
const shortDay = new Intl.DateTimeFormat('en-NG', { timeZone: LAGOS, weekday: 'short', day: 'numeric', month: 'short' });
const longDay = new Intl.DateTimeFormat('en-NG', { timeZone: LAGOS, weekday: 'long', day: 'numeric', month: 'long' });
const plainDay = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const plainWeekday = new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** YYYY-MM-DD in Lagos. */
export function lagosDay(date: Date): string {
  return isoDay.format(date);
}

/** "Tuesday 10 November" for today in Lagos. */
export function longToday(date: Date): string {
  return longDay.format(date).replace(',', '');
}

/** Whole days from one YYYY-MM-DD to another. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** "10:02", "Yesterday, 14:30" or "Mon 8 Nov" for a session start, relative to `today` (YYYY-MM-DD). */
export function whenLabel(iso: string, today: string): string {
  const date = new Date(iso);
  const day = lagosDay(date);
  if (!today || day === today) return clock.format(date);
  if (daysBetween(day, today) === 1) return `Yesterday, ${clock.format(date)}`;
  return shortDay.format(date).replace(',', '');
}

export function clockLabel(iso: string): string {
  return clock.format(new Date(iso));
}

/** A summary's plain YYYY-MM-DD date: "8 Nov", or "Mon 8 Nov". */
export function dayLabel(date: string, withWeekday = false): string {
  return (withWeekday ? plainWeekday : plainDay).format(new Date(`${date}T00:00:00Z`)).replace(',', '');
}

export type Trend = { readonly direction: 'up' | 'down' | 'flat' | 'new'; readonly label: string; readonly spoken: string };

/** The change from `previous` to `current`, for a small badge and its spoken version. */
export function trendOf(current: number, previous: number, period: string): Trend | null {
  if (current === 0 && previous === 0) return null;
  if (previous === 0) return { direction: 'new', label: 'New', spoken: `none in the previous ${period}` };
  const change = Math.round(((current - previous) / previous) * 100);
  if (change === 0) return { direction: 'flat', label: 'Same', spoken: `the same as the previous ${period}` };
  const size = `${Math.abs(change)}%`;
  return change > 0
    ? { direction: 'up', label: size, spoken: `up ${size} on the previous ${period}` }
    : { direction: 'down', label: size, spoken: `down ${size} on the previous ${period}` };
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${numberFormat.format(count)} ${count === 1 ? one : many}`;
}
