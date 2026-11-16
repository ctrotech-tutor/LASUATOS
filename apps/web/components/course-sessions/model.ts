import type { AttendanceSessionDetail, AttendanceSessionSummary, LecturerCourseOffering } from '@lasuatos/contracts';

/*
 * Course sessions: classes a lecturer opens for an enrolled course, who checked in, and who
 * has not. Plain functions, so the screens and their tests share them.
 */

export type CourseSession = AttendanceSessionSummary;
export type SessionDetail = AttendanceSessionDetail;
export type Attendee = AttendanceSessionDetail['attendees'][number];
export type Absentee = AttendanceSessionDetail['notCheckedIn'][number];
export type Offering = LecturerCourseOffering;

/** The QR code changes every 20 seconds (packages/verification, DEFAULT_CHALLENGE_WINDOW_SECONDS). */
export const QR_WINDOW_MS = 20_000;

/** How long a class can stay open when it starts, and the minutes "More time" adds. */
export const DURATIONS = [30, 60, 90, 120, 180] as const;
export type Duration = (typeof DURATIONS)[number];
export const EXTEND_MINUTES = 15;

/** What a session is called if the lecturer does not change it. */
export const KINDS = ['lecture', 'tutorial', 'practical', 'test'] as const;
export type Kind = (typeof KINDS)[number];

const DAY_MS = 86_400_000;

export function plural(count: number, word: string, many = `${word}s`): string {
  return `${count.toLocaleString('en-NG')} ${count === 1 ? word : many}`;
}

export const isLive = (session: Pick<CourseSession, 'status'>) => session.status === 'open';

/** The week of the semester `now` falls in (1 on its first day), or null outside it. */
export function semesterWeek(offering: Pick<Offering, 'semesterStartsAt' | 'semesterEndsAt'>, now: number): number | null {
  const start = Date.parse(offering.semesterStartsAt);
  if (!now || now < start || now >= Date.parse(offering.semesterEndsAt)) return null;
  return Math.floor((now - start) / (7 * DAY_MS)) + 1;
}

/** "Week 6 lecture", or "Lecture" outside the semester's dates. */
export function sessionTitle(offering: Pick<Offering, 'semesterStartsAt' | 'semesterEndsAt'> | null, kind: Kind, now: number): string {
  const week = offering ? semesterWeek(offering, now) : null;
  return week ? `Week ${week} ${kind}` : `${kind.charAt(0).toUpperCase()}${kind.slice(1)}`;
}

/** The kind a title was made from, so its chip shows selected. */
export function kindOf(title: string): Kind | null {
  const word = title.trim().toLowerCase().split(/\s+/).at(-1) ?? '';
  return (KINDS as readonly string[]).includes(word) ? (word as Kind) : null;
}

/** Courses a class can be opened for now: their semester is running. */
export function openableOfferings(offerings: readonly Offering[], now: number): Offering[] {
  return offerings
    .filter((offering) => now && Date.parse(offering.semesterStartsAt) <= now && Date.parse(offering.semesterEndsAt) > now)
    .sort((a, b) => a.courseCode.localeCompare(b.courseCode, 'en', { numeric: true }));
}

/** The course to open a class for: the one asked for, else the only one, else none. */
export function defaultOffering(openable: readonly Offering[], preferred: string | null): string {
  if (preferred && openable.some((offering) => offering.courseOfferingId === preferred)) return preferred;
  return openable.length === 1 ? openable[0]!.courseOfferingId : '';
}

/** Present, removed, and the rest of the course's students. */
export function roster(detail: Pick<SessionDetail, 'attendees' | 'notCheckedIn'>) {
  const present = detail.attendees.filter((attendee) => attendee.status === 'present');
  const revoked = detail.attendees.filter((attendee) => attendee.status === 'revoked');
  const absent = detail.notCheckedIn;
  return {
    present,
    revoked,
    absent,
    /** Everyone the session is for: checked in (even if removed since) or not yet. */
    classSize: detail.attendees.length + absent.length,
    flagged: present.filter(isFlagged).length,
    byHand: present.filter((attendee) => attendee.method === 'manual').length,
  };
}

/** Worth a second look: one phone for several students, or a location that could not be confirmed. */
export function isFlagged(attendee: Pick<Attendee, 'status' | 'sharedDevice' | 'venueOutcome'>): boolean {
  return attendee.status === 'present' && (attendee.sharedDevice || attendee.venueOutcome === 'inconclusive');
}

export function methodLabel(method: Attendee['method']): string {
  if (method === 'qr_code') return 'Scanned the QR code';
  if (method === 'code') return 'Typed the code';
  return 'Marked present by you';
}

/** "12 of 40" when the class size is known, else "12". */
export function presentOf(present: number, classSize: number | null): string {
  const shown = present.toLocaleString('en-NG');
  return classSize ? `${shown} of ${classSize.toLocaleString('en-NG')}` : shown;
}

/** Whole percentage present, or null for an empty class. */
export function presentRate(present: number, classSize: number | null): number | null {
  return classSize ? Math.round((present / classSize) * 100) : null;
}

/** Milliseconds until the challenge's window ends and the code on screen changes. */
export function msUntilRotation(challenge: string, now: number): number {
  const windowIndex = Number(challenge.split('.')[2]);
  if (!Number.isFinite(windowIndex)) return 0;
  return Math.max(0, (windowIndex + 1) * QR_WINDOW_MS - now);
}

/** "7K9M-PQ2R-4XBD": the typed code in groups of four, as students type it. */
export function formatCode(code: string): string {
  return code.match(/.{1,4}/g)?.join('-') ?? code;
}

/** A session with the change the server sent back, keeping what the list does not carry. */
export function withSession(sessions: readonly CourseSession[], updated: CourseSession): CourseSession[] {
  const known = sessions.some((session) => session.id === updated.id);
  const next = known
    ? sessions.map((session) => (session.id === updated.id ? { ...session, ...updated } : session))
    : [updated, ...sessions];
  return next.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
}

/** The minutes still allowed before the four-hour cap, so "More time" is offered only while it fits. */
export function canExtend(session: Pick<CourseSession, 'startsAt' | 'endsAt'>, maxMinutes: number, minutes = EXTEND_MINUTES): boolean {
  return Date.parse(session.endsAt) + minutes * 60_000 - Date.parse(session.startsAt) <= maxMinutes * 60_000;
}

/** The message in a failed request (course-api throws `{ status, message }`), or the fallback. */
export function problemText(caught: unknown, fallback: string): string {
  if (caught && typeof caught === 'object' && 'message' in caught && typeof caught.message === 'string' && caught.message) return caught.message;
  return fallback;
}

/** A correction's reason, as the server will take it (10 to 500 characters). */
export function reasonProblem(reason: string): string | null {
  const length = reason.trim().length;
  if (length < 10) return `Write at least 10 characters (${10 - length} more).`;
  if (length > 500) return 'Keep it under 500 characters.';
  return null;
}
