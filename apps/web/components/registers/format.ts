/** Numbers and exports for course registers. */

import type { LectureRegister } from '@lasuatos/contracts';
import { formatClock, formatSheetDate } from '../../lib/lecture-api';
import { csvText } from '../../lib/csv';

export const numberFormat = new Intl.NumberFormat('en-NG');

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${numberFormat.format(count)} ${count === 1 ? one : many}`;
}

/** The choices for the required attendance. */
export const THRESHOLDS = [50, 60, 70, 75, 80] as const;

/**
 * How many classes in a row a student must attend, from the next one, to reach `threshold`:
 * the smallest k with (attended + k) / (held + k) ≥ threshold. Null when already there.
 */
export function sessionsToReach(attended: number, held: number, threshold: number): number | null {
  if (attended * 100 >= held * threshold) return null;
  if (threshold >= 100) return Infinity;
  return Math.ceil((threshold * held - 100 * attended) / (100 - threshold));
}

export type RegisterSort = 'name' | 'matric' | 'rate';
type Student = LectureRegister['students'][number];
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
export const sorters: Readonly<Record<RegisterSort, (a: Student, b: Student) => number>> = {
  name: (a, b) => collator.compare(a.fullName, b.fullName) || collator.compare(a.matricNumber, b.matricNumber),
  matric: (a, b) => collator.compare(a.matricNumber, b.matricNumber),
  rate: (a, b) => a.rate - b.rate || collator.compare(a.fullName, b.fullName),
};

/** The register as a spreadsheet: P or A per session, then the totals and eligibility. */
export function downloadRegister(register: LectureRegister, threshold: number) {
  const header = [
    'S/N', 'Full name', 'Matric number',
    ...register.sessions.map((session) => `${formatSheetDate(session.startsAt)} ${formatClock(session.startsAt)}`),
    'Attended', 'Held', 'Percentage', `Eligible (${threshold}%)`,
  ];
  const body = [...register.students].sort(sorters.name).map((row, index) => [
    String(index + 1), row.fullName, row.matricNumber,
    ...row.present.map((present) => (present ? 'P' : 'A')),
    String(row.attended), String(register.sessions.length), `${row.rate}%`, row.rate >= threshold ? 'Yes' : 'No',
  ]);
  const csv = `${csvText([header, ...body])}\r\n`;
  // A byte-order mark so Excel reads names with accents correctly.
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  const termPart = register.term && register.term.id !== 'all' ? `-${register.term.label}` : '';
  link.download = `${`${register.courseCode}${termPart}`.replace(/[^A-Za-z0-9]+/g, '-')}-register.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
