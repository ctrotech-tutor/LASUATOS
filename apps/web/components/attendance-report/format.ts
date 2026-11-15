/** Numbers, dates and exports for the attendance report. Dates are the report's Lagos days. */

import type { LectureReport, LectureReportPeriod } from '@lasuatos/contracts';

export const numberFormat = new Intl.NumberFormat('en-NG');
const dayMonth = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekdayShort = new Intl.DateTimeFormat('en-NG', { weekday: 'short', timeZone: 'UTC' });
const weekdayDay = new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

const asDate = (day: string) => new Date(`${day}T00:00:00Z`);

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${numberFormat.format(count)} ${count === 1 ? one : many}`;
}

/** "78%" (whole numbers read faster; the exports keep the decimal). */
export function percent(rate: number | null): string {
  return rate === null ? '–' : `${Math.round(rate)}%`;
}

/** "6–12 Nov", "28 Oct – 3 Nov". */
export function rangeLabel(from: string, to: string): string {
  if (from === to) return dayMonth.format(asDate(from));
  const [fromDay, fromMonth] = dayMonth.formatToParts(asDate(from)).filter((part) => part.type !== 'literal').map((part) => part.value);
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  return sameMonth ? `${fromDay}–${dayMonth.format(asDate(to))}` : `${fromDay} ${fromMonth} – ${dayMonth.format(asDate(to))}`;
}

export const dayLabel = (day: string) => dayMonth.format(asDate(day));
export const weekdayLabel = (day: string) => weekdayShort.format(asDate(day));
export const longDayLabel = (day: string) => weekdayDay.format(asDate(day)).replace(',', '');

export const PERIOD_LABEL: Readonly<Record<LectureReportPeriod, string>> = { week: '7 days', month: '30 days', term: 'Semester' };

export type ChartBar = {
  readonly key: string;
  /** Short label under the bar, or '' to leave it bare. */
  readonly label: string;
  /** Read out and shown on hover. */
  readonly title: string;
  readonly rate: number | null;
  readonly sessions: number;
};

/**
 * Bars for the rate chart: days for 7 and 30 days, weeks (Monday to Sunday) for a semester,
 * each week's rate worked out from its classes, not by averaging days.
 */
export function chartBars(report: LectureReport): ChartBar[] {
  const days = report.daily;
  if (report.period !== 'term') {
    // Seven days name each bar; longer charts label only their two ends.
    return days.map((day) => ({
      key: day.date,
      label: days.length <= 7 ? weekdayLabel(day.date) : '',
      title: `${longDayLabel(day.date)}: ${day.sessions ? `${percent(day.rate)} across ${plural(day.sessions, 'class', 'classes')}` : 'no classes'}`,
      rate: day.rate,
      sessions: day.sessions,
    }));
  }
  const weeks: { start: string; end: string; sessions: number; checkIns: number; expected: number }[] = [];
  for (const day of days) {
    const monday = asDate(day.date).getUTCDay() === 1;
    const current = weeks[weeks.length - 1];
    if (!current || monday) weeks.push({ start: day.date, end: day.date, sessions: day.sessions, checkIns: day.checkIns, expected: day.expected });
    else Object.assign(current, { end: day.date, sessions: current.sessions + day.sessions, checkIns: current.checkIns + day.checkIns, expected: current.expected + day.expected });
  }
  return weeks.map((week) => {
    const rate = week.expected ? Math.round(Math.min(1, week.checkIns / week.expected) * 1000) / 10 : null;
    return {
      key: week.start,
      label: '',
      title: `Week of ${dayLabel(week.start)}: ${week.sessions ? `${percent(rate)} across ${plural(week.sessions, 'class', 'classes')}` : 'no classes'}`,
      rate,
      sessions: week.sessions,
    };
  });
}

/** The change in percentage points from the previous period, for the badge. */
export function pointsChange(report: LectureReport): { readonly direction: 'up' | 'down' | 'flat'; readonly label: string; readonly spoken: string } | null {
  const before = report.totals.previous?.rate ?? null;
  const now = report.totals.rate;
  if (before === null || now === null) return null;
  const change = Math.round(now - before);
  const span = report.period === 'week' ? '7 days' : '30 days';
  if (change === 0) return { direction: 'flat', label: 'Same', spoken: `the same as the ${span} before` };
  const size = `${Math.abs(change)} pt${Math.abs(change) === 1 ? '' : 's'}`;
  return change > 0
    ? { direction: 'up', label: size, spoken: `up ${Math.abs(change)} points on the ${span} before` }
    : { direction: 'down', label: size, spoken: `down ${Math.abs(change)} points on the ${span} before` };
}

/* ---------- Exports ---------- */

function csvField(value: string | number | null): string {
  const text = value === null ? '' : String(value);
  // Quote anything with a comma, quote or line break; neutralise spreadsheet formulas.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

function download(name: string, rows: readonly (readonly (string | number | null)[])[]) {
  const text = rows.map((row) => row.map(csvField).join(',')).join('\r\n');
  // A byte-order mark so Excel opens names with accents correctly.
  const url = URL.createObjectURL(new Blob(['\ufeff', text], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const scopeSlug = (report: LectureReport) => (report.department ? `-${report.department.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}` : '');

export function downloadCourses(report: LectureReport) {
  download(`attendance-courses${scopeSlug(report)}-${report.from}-to-${report.to}.csv`, [
    ['Course code', 'Course title', 'Sessions', 'Students', 'Check-ins', 'Attendance rate (%)', `Below ${report.below.threshold}% this semester`, 'Last held'],
    ...report.courses.map((course) => [course.courseCode, course.courseTitle, course.sessions, course.students, course.checkIns, course.rate, course.below, course.lastHeldAt.slice(0, 10)]),
  ]);
}

export function downloadBelow(report: LectureReport) {
  const term = report.term ? `${report.term.from}-to-${report.term.to}` : `to-${report.to}`;
  download(`attendance-below-${report.below.threshold}${scopeSlug(report)}-${term}.csv`, [
    ['Matric number', 'Full name', 'Course code', 'Course title', 'Attended', 'Held', 'Rate (%)'],
    ...report.below.rows.map((row) => [row.matricNumber, row.fullName, row.courseCode, row.courseTitle, row.attended, row.held, row.rate]),
  ]);
}
