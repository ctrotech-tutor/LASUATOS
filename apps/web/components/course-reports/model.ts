import type { AttendanceReport, AttendanceReportCell, AttendanceReportOverview, LecturerCourseOffering } from '@lasuatos/contracts';

/*
 * Attendance reports for enrolled courses: where each course stands, and one course's
 * students against its classes. Plain functions, so the screens and their tests share them.
 */

export type Report = AttendanceReport;
export type Student = AttendanceReport['students'][number];
export type ReportClass = AttendanceReport['sessions'][number];
export type Cell = AttendanceReportCell;
export type Offering = LecturerCourseOffering;
export type Standing = AttendanceReportOverview['courses'][number];
export type Correction = 'mark_present' | 'revoke';

export const numberFormat = new Intl.NumberFormat('en-NG');

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${numberFormat.format(count)} ${count === 1 ? one : many}`;
}

/**
 * What each mark means, in the words the screens use. `tone` picks the mark's look: present (a
 * filled dot), unsure (amber), marked (a square: a lecturer put them there), removed (a cross),
 * absent (a ring) and none (a dash: not on the course yet, so it does not count).
 */
export const CELL: Readonly<Record<Cell, { readonly label: string; readonly short: string; readonly tone: 'present' | 'unsure' | 'marked' | 'removed' | 'absent' | 'none' }>> = {
  within_boundary: { label: 'Present, in the room', short: 'Present', tone: 'present' },
  unlocated: { label: 'Present', short: 'Present', tone: 'present' },
  inconclusive: { label: 'Present, location unsure', short: 'Unsure', tone: 'unsure' },
  manual: { label: 'Marked present by a lecturer', short: 'Marked', tone: 'marked' },
  revoked: { label: 'Check-in removed', short: 'Removed', tone: 'removed' },
  absent: { label: 'Absent', short: 'Absent', tone: 'absent' },
  not_enrolled: { label: 'Not on the course yet', short: 'Not joined', tone: 'none' },
};

/** The marks in the legend, one per look. */
export const LEGEND: readonly { readonly tone: (typeof CELL)[Cell]['tone']; readonly label: string }[] = [
  { tone: 'present', label: 'Present' },
  { tone: 'unsure', label: 'Location unsure' },
  { tone: 'marked', label: 'Marked by a lecturer' },
  { tone: 'removed', label: 'Removed' },
  { tone: 'absent', label: 'Absent' },
  { tone: 'none', label: 'Not on the course yet' },
];

export const isAttended = (cell: Cell) => cell === 'within_boundary' || cell === 'unlocated' || cell === 'inconclusive' || cell === 'manual';

/** Below the required line: students on the course (or who completed it), once a class has counted for them. */
export function isBelow(student: Pick<Student, 'enrollmentStatus' | 'rate'>, threshold: number): boolean {
  return student.enrollmentStatus !== 'withdrawn' && student.rate !== null && student.rate < threshold;
}

/** The change a lecturer can make to one mark: remove a check-in, or mark present (students still on the course). */
export function correctionFor(cell: Cell, enrollmentStatus: Student['enrollmentStatus']): Correction | null {
  if (isAttended(cell)) return 'revoke';
  if ((cell === 'absent' || cell === 'revoked') && enrollmentStatus === 'active') return 'mark_present';
  return null;
}

/**
 * How many classes in a row a student must attend, from the next one, to reach `threshold`:
 * the smallest k with (attended + k) / (eligible + k) ≥ threshold. Null when already there.
 */
export function classesToReach(attended: number, eligible: number, threshold: number): number | null {
  if (attended * 100 >= eligible * threshold) return null;
  if (threshold >= 100) return Infinity;
  return Math.ceil((threshold * eligible - 100 * attended) / (100 - threshold));
}

/** Classes missed in a row up to the latest (classes before they joined are skipped). */
export function missedInARow(cells: readonly Cell[]): number {
  let count = 0;
  for (let index = cells.length - 1; index >= 0; index -= 1) {
    const cell = cells[index]!;
    if (cell === 'not_enrolled') break;
    if (isAttended(cell)) break;
    count += 1;
  }
  return count;
}

export type ReportSort = 'name' | 'matric' | 'rate';
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
const byName = (a: Student, b: Student) => collator.compare(a.displayName, b.displayName) || collator.compare(a.studentNumber, b.studentNumber);
/** Students still on the course first; then by the chosen order (no rate yet sorts last). */
export const sorters: Readonly<Record<ReportSort, (a: Student, b: Student) => number>> = {
  name: byName,
  matric: (a, b) => collator.compare(a.studentNumber, b.studentNumber),
  rate: (a, b) => (a.rate ?? 101) - (b.rate ?? 101) || byName(a, b),
};

export function sortStudents(students: readonly Student[], sort: ReportSort): Student[] {
  const active = (student: Student) => (student.enrollmentStatus === 'withdrawn' ? 1 : 0);
  return [...students].sort((a, b) => active(a) - active(b) || sorters[sort](a, b));
}

/** Name or matric number, ignoring spaces and case. */
export function matches(student: Pick<Student, 'displayName' | 'studentNumber'>, query: string): boolean {
  const needle = query.trim().toLowerCase().replace(/\s+/g, '');
  if (!needle) return true;
  return student.displayName.toLowerCase().replace(/\s+/g, '').includes(needle) || student.studentNumber.toLowerCase().includes(needle);
}

/** The course's figures against the chosen line (the server's `belowThreshold` used its own). */
export function summarize(report: Report, threshold: number) {
  const active = report.students.filter((student) => student.enrollmentStatus !== 'withdrawn');
  return {
    classes: report.sessions.length,
    students: active.length,
    average: report.totals.averageRate,
    below: active.filter((student) => isBelow(student, threshold)).length,
    left: report.students.length - active.length,
  };
}

export type CourseRow = { readonly offering: Offering; readonly standing: Standing | null };

/**
 * The reports list: this semester's courses, the next semester's, then earlier ones (latest
 * class first). A course with classes carries its standing.
 */
export function groupCourses(offerings: readonly Offering[], standings: readonly Standing[], now: number) {
  const byId = new Map(standings.map((standing) => [standing.courseOfferingId, standing]));
  const rows: CourseRow[] = offerings.map((offering) => ({ offering, standing: byId.get(offering.courseOfferingId) ?? null }));
  const byCode = (a: CourseRow, b: CourseRow) => collator.compare(a.offering.courseCode, b.offering.courseCode);
  const lastClass = (row: CourseRow) => (row.standing?.lastSessionAt ? Date.parse(row.standing.lastSessionAt) : 0);
  const started = (row: CourseRow) => Date.parse(row.offering.semesterStartsAt) <= now;
  const ended = (row: CourseRow) => Date.parse(row.offering.semesterEndsAt) <= now;
  return {
    current: rows.filter((row) => started(row) && !ended(row)).sort(byCode),
    upcoming: rows.filter((row) => !started(row)).sort(byCode),
    earlier: rows.filter(ended).sort((a, b) => lastClass(b) - lastClass(a) || byCode(a, b)),
  };
}

/** The address of one course's report; old links carried ?courseOfferingId=. */
export const reportHref = (courseOfferingId: string) => `/lecturer/reports/${courseOfferingId}`;

/** The message in a failed request (course-api throws `{ status, message }`), or the fallback. */
export function problemText(caught: unknown, fallback: string): string {
  if (caught && typeof caught === 'object' && 'message' in caught && typeof caught.message === 'string' && caught.message) return caught.message;
  return fallback;
}
