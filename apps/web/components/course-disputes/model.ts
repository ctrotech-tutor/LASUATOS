import type { LecturerAttendanceDispute, LecturerAttendanceDisputes } from '@lasuatos/contracts';
import type { Cell } from '../course-reports/model';
import { lagosDay } from '../take-attendance/format';

export type Dispute = LecturerAttendanceDispute;
export type DisputeList = LecturerAttendanceDisputes;
export type Tab = 'open' | 'resolved';
export type Decision = 'uphold' | 'reject';

export const NOTE_MIN = 10;
export const NOTE_MAX = 500;

export { numberFormat, plural, problemText } from '../course-reports/model';

export const KIND_LABEL: Readonly<Record<Dispute['kind'], string>> = {
  missing_check_in: 'No check-in',
  revoked_check_in: 'Check-in removed',
};

export const OUTCOME: Readonly<Record<Exclude<Dispute['status'], 'open'>, { readonly label: string; readonly tone: 'success' | 'danger' | 'neutral' }>> = {
  upheld: { label: 'Upheld', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  withdrawn: { label: 'Withdrawn', tone: 'neutral' },
};

/** Ready-made notes for a decision. Each is at least NOTE_MIN characters and reads to the student. */
export function noteSuggestions(decision: Decision, kind: Dispute['kind']): readonly string[] {
  if (decision === 'uphold') {
    return kind === 'revoked_check_in'
      ? ['I saw you in class.', 'The check-in was removed by mistake.']
      : ['I saw you in class.', 'Others in the class confirm you were there.'];
  }
  return kind === 'revoked_check_in'
    ? ['I did not see you in class.', 'The check-in was not made from the room.']
    : ['I did not see you in class.', 'Attendance was open for the whole class.'];
}

export function noteProblem(note: string): string | null {
  const length = note.trim().length;
  if (length < NOTE_MIN) return `Write at least ${NOTE_MIN} characters, so the student knows why.`;
  if (length > NOTE_MAX) return `Keep it to ${NOTE_MAX} characters.`;
  return null;
}

/** The student's mark for the disputed class today, as the course report draws it. */
export function currentMark(dispute: Pick<Dispute, 'record'>): Cell {
  const record = dispute.record;
  if (!record) return 'absent';
  if (record.status === 'revoked') return 'revoked';
  if (record.method === 'manual') return 'manual';
  return record.venueOutcome ?? 'unlocated';
}

/** Whether "uphold" can record them present: only while they are on the course. */
export const canUphold = (dispute: Pick<Dispute, 'student'>) => dispute.student.enrollmentStatus === 'active';

export type Figure = { readonly attended: number; readonly eligible: number; readonly rate: number | null };

const figure = (attended: number, eligible: number): Figure => ({ attended, eligible, rate: eligible ? (attended / eligible) * 100 : null });

/**
 * Where the student stands in the course now and, for an open dispute that upholding would
 * change, where they would stand after it. Upholding adds the class as attended; a class from
 * before they joined starts counting too.
 */
export function standingOf(dispute: Pick<Dispute, 'standing' | 'status' | 'record' | 'student'>): { readonly now: Figure; readonly ifUpheld: Figure | null } | null {
  const standing = dispute.standing;
  if (!standing) return null;
  const now = figure(standing.attended, standing.eligible);
  const changes = dispute.status === 'open' && canUphold(dispute) && dispute.record?.status !== 'present';
  return {
    now,
    ifUpheld: changes ? figure(standing.attended + 1, standing.eligible + (standing.countsThisClass ? 0 : 1)) : null,
  };
}

const shortDay = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', weekday: 'short', day: 'numeric', month: 'short' });
const withYear = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric', month: 'short', year: 'numeric' });
const clock = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** "Fri 6 Nov, 09:00"; another year reads "6 Nov 2025, 09:00". */
export function when(iso: string, today: string): string {
  const day = lagosDay(iso);
  const date = (today && day.slice(0, 4) !== today.slice(0, 4) ? withYear : shortDay).format(new Date(iso)).replace(',', '');
  return `${date}, ${clock.format(new Date(iso))}`;
}

const dayMs = (day: string) => Date.parse(`${day}T00:00:00Z`);

/** Whole Lagos days from `iso` to `today` (YYYY-MM-DD). */
export function daysSince(iso: string, today: string): number {
  return Math.max(0, Math.round((dayMs(today) - dayMs(lagosDay(iso))) / 86_400_000));
}

/** How long a dispute has waited: "Today", "1 day", "5 days". */
export function waitedLabel(iso: string, today: string): string {
  const days = daysSince(iso, today);
  return days === 0 ? 'Today' : days === 1 ? '1 day' : `${days} days`;
}

/** Disputes for the course filter, or all; open ones are already oldest first from the server. */
export function inCourse(disputes: readonly Dispute[], courseOfferingId: string): readonly Dispute[] {
  return courseOfferingId ? disputes.filter((dispute) => dispute.courseOfferingId === courseOfferingId) : disputes;
}

/** The open dispute to show after deciding one: the next in the list, else the one before, else none. */
export function nextOpen(disputes: readonly Dispute[], decidedId: string): Dispute | null {
  const index = disputes.findIndex((dispute) => dispute.id === decidedId);
  const rest = disputes.filter((dispute) => dispute.id !== decidedId && dispute.status === 'open');
  if (!rest.length) return null;
  if (index < 0) return rest[0]!;
  return disputes.slice(index + 1).find((dispute) => dispute.status === 'open') ?? rest[rest.length - 1]!;
}

/** The course report at this student and class. */
export const reportHref = (dispute: Pick<Dispute, 'courseOfferingId' | 'student' | 'attendanceSessionId'>) =>
  `/lecturer/reports/${dispute.courseOfferingId}?student=${dispute.student.id}&class=${dispute.attendanceSessionId}`;
