/**
 * Enrolled courses (the older course-offering attendance) for administrators: which courses to show,
 * in what order, and the words for their numbers. Pure, so it is tested without a browser.
 */

import type { AdministratorAttendanceOffering } from '@lasuatos/contracts';

export type Offering = AdministratorAttendanceOffering;
export type Sort = 'rate' | 'disputes' | 'recent' | 'code';

/** The colour line, the same as the attendance report above. A guide, not institutional policy. */
export const THRESHOLD = 75;
/** Rows shown before "See all". */
export const PREVIEW = 5;

const numberFormat = new Intl.NumberFormat('en-NG');
const dayMonth = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const year = new Intl.DateTimeFormat('en-GB', { year: 'numeric', timeZone: 'Africa/Lagos' });
const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Lagos' });

export const count = (value: number) => numberFormat.format(value);

export function plural(value: number, one: string, many = `${one}s`): string {
  return `${count(value)} ${value === 1 ? one : many}`;
}

/** "79%": whole numbers read faster. */
export function percent(rate: number | null): string {
  return rate === null ? '–' : `${Math.round(rate)}%`;
}

const byCode = (a: Offering, b: Offering) =>
  a.courseCode.localeCompare(b.courseCode, 'en', { numeric: true, sensitivity: 'base' }) || a.semesterLabel.localeCompare(b.semesterLabel);

const sorters: Readonly<Record<Sort, (a: Offering, b: Offering) => number>> = {
  // Lowest first, so the courses that need attention lead; courses without a rate go last.
  rate: (a, b) => (a.rate ?? 101) - (b.rate ?? 101) || b.sessionsHeld - a.sessionsHeld || byCode(a, b),
  // Most waiting, then the longest wait.
  disputes: (a, b) => b.openDisputes - a.openDisputes
    || (a.oldestOpenDisputeAt ?? '9999').localeCompare(b.oldestOpenDisputeAt ?? '9999')
    || byCode(a, b),
  recent: (a, b) => (b.lastSessionAt ?? '').localeCompare(a.lastSessionAt ?? '') || byCode(a, b),
  code: byCode,
};

const squash = (value: string) => value.toLowerCase().replace(/\s+/g, '');

/** Courses matching the search (code, title or department, spaces ignored), sorted. */
export function visibleOfferings(
  offerings: readonly Offering[],
  { query = '', sort = 'rate', includeEmpty = false }: Readonly<{ query?: string; sort?: Sort; includeEmpty?: boolean }> = {},
): Offering[] {
  const needle = squash(query.trim());
  return offerings
    .filter((offering) => (includeEmpty || offering.sessionsHeld > 0)
      && (!needle || squash(`${offering.courseCode}${offering.courseTitle}${offering.departmentName}`).includes(needle)))
    .sort(sorters[sort]);
}

/** Whole days from one instant to another, never negative. */
export function daysBetween(fromIso: string, toIso: string): number {
  return Math.max(0, Math.floor((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000));
}

/** "Oldest waiting 7 days", "Oldest raised today", or "None waiting". */
export function waitLabel(oldestIso: string | null, nowIso: string): string {
  if (!oldestIso) return 'None waiting';
  const days = daysBetween(oldestIso, nowIso);
  return days === 0 ? 'Oldest raised today' : `Oldest waiting ${plural(days, 'day')}`;
}

/** "4 open disputes, oldest 7 days" for a course row. */
export function disputeChip(offering: Offering, nowIso: string): string {
  const base = plural(offering.openDisputes, 'open dispute');
  if (!offering.oldestOpenDisputeAt) return base;
  const days = daysBetween(offering.oldestOpenDisputeAt, nowIso);
  return days === 0 ? `${base}, raised today` : `${base}, oldest ${plural(days, 'day')}`;
}

/** Who the rate is worked out over: "39 enrolled · 3 completed", "39 completed", "No students". */
export function studentsLabel(offering: Offering): string {
  const parts = [
    offering.activeEnrollments ? `${count(offering.activeEnrollments)} enrolled` : '',
    offering.completedEnrollments ? `${count(offering.completedEnrollments)} completed` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No students';
}

/** "16 Nov", with the year when it is not the year of `nowIso`. */
export function dayLabel(iso: string, nowIso: string): string {
  const date = new Date(iso);
  const label = dayMonth.format(date);
  return year.format(date) === year.format(new Date(nowIso)) ? label : `${label} ${year.format(date)}`;
}

/** "13 classes · last 16 Nov", or "No classes yet". */
export function classesLabel(offering: Offering, nowIso: string): string {
  if (offering.sessionsHeld === 0) return 'No classes yet';
  const held = plural(offering.sessionsHeld, 'class', 'classes');
  return offering.lastSessionAt ? `${held} · last ${dayLabel(offering.lastSessionAt, nowIso)}` : held;
}

/** "16 Nov at 21:51" (built from parts, so no locale comma creeps in). */
export function updatedLabel(iso: string): string {
  const date = new Date(iso);
  return `${dayMonth.format(date)} at ${clock.format(date)}`;
}

export type Chip = { readonly key: string; readonly tone: 'neutral' | 'tint' | 'danger' | 'warning'; readonly text: string };

/** The evidence worth a second look, as short chips (disputes first); empty when there is none. */
export function evidenceChips(offering: Offering, nowIso: string): Chip[] {
  const chips: Chip[] = [];
  if (offering.openDisputes) chips.push({ key: 'disputes', tone: 'warning', text: disputeChip(offering, nowIso) });
  if (offering.inconclusiveCheckIns) chips.push({ key: 'unclear', tone: 'neutral', text: `${count(offering.inconclusiveCheckIns)} location unclear` });
  if (offering.manualCheckIns) chips.push({ key: 'manual', tone: 'tint', text: `${count(offering.manualCheckIns)} added by hand` });
  if (offering.revokedCheckIns) chips.push({ key: 'removed', tone: 'danger', text: `${count(offering.revokedCheckIns)} removed` });
  return chips;
}
