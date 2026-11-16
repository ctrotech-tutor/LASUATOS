import type {
  AttendanceRecordMethod,
  AttendanceRecordStatus,
  AttendanceVenueOutcomeValue,
  OfferingReportSource,
  StudentMissedClass,
  StudentSummarySource,
} from './repository.js';
import { academicSessionStartYear, deriveStudentLevel, parseCourseLevel } from '@lasuatos/contracts';

/**
 * Pure attendance-report composition. Everything here is deterministic over
 * the repository's raw rows, so the attendance rules (eligibility, what
 * counts as attended, rates) live in one tested place and the SQL stays a
 * plain data fetch.
 */

export const DEFAULT_ATTENDANCE_THRESHOLD = 75;

export type AttendanceReportCell =
  | 'within_boundary'
  | 'inconclusive'
  | 'unlocated'
  | 'manual'
  | 'revoked'
  | 'absent'
  | 'not_enrolled';

const ATTENDED_CELLS: ReadonlySet<AttendanceReportCell> = new Set([
  'within_boundary',
  'inconclusive',
  'unlocated',
  'manual',
]);

export function isAttendedCell(cell: AttendanceReportCell): boolean {
  return ATTENDED_CELLS.has(cell);
}

interface CellRecord {
  readonly status: AttendanceRecordStatus;
  readonly method: AttendanceRecordMethod;
  readonly venueOutcome: AttendanceVenueOutcomeValue | null;
}

/**
 * Classifies one student x session cell.
 *
 * A session that started before the student enrolled is `not_enrolled` (it
 * does not count against them) unless they nevertheless have a record for
 * it. Revoked records count as not attended but stay visible as `revoked`
 * rather than collapsing into `absent`, so the correction is traceable.
 */
export function classifyCell(
  record: CellRecord | undefined,
  sessionStartsAt: Date,
  enrolledAt: Date,
): AttendanceReportCell {
  if (record) {
    if (record.status === 'revoked') return 'revoked';
    if (record.method === 'manual') return 'manual';
    if (record.venueOutcome === 'within_boundary') return 'within_boundary';
    if (record.venueOutcome === 'inconclusive') return 'inconclusive';
    return 'unlocated';
  }
  return sessionStartsAt.getTime() < enrolledAt.getTime() ? 'not_enrolled' : 'absent';
}

/** Percentage to one decimal place; null when there is nothing to divide by. */
export function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.min(100, Math.round((numerator / denominator) * 1000) / 10);
}

export function publicSessionState(
  session: { readonly status: 'open' | 'closed'; readonly endsAt: Date },
  now: Date,
): 'open' | 'closed' | 'expired' {
  if (session.status === 'closed') return 'closed';
  return session.endsAt.getTime() <= now.getTime() ? 'expired' : 'open';
}

export interface OfferingAttendanceReport {
  readonly offering: OfferingReportSource['offering'];
  readonly generatedAt: Date;
  readonly threshold: number;
  readonly totals: {
    readonly sessionsHeld: number;
    readonly activeStudents: number;
    readonly averageRate: number | null;
    readonly studentsBelowThreshold: number;
    readonly presentRecords: number;
    readonly inconclusiveRecords: number;
    readonly manualRecords: number;
    readonly revokedRecords: number;
    readonly openDisputes: number;
  };
  readonly sessions: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly startsAt: Date;
    readonly status: 'open' | 'closed' | 'expired';
    readonly venueName: string | null;
    readonly expectedCount: number;
    readonly presentCount: number;
    readonly withinBoundaryCount: number;
    readonly inconclusiveCount: number;
    readonly unlocatedCount: number;
    readonly manualCount: number;
    readonly revokedCount: number;
    readonly rate: number | null;
  }>;
  readonly students: ReadonlyArray<{
    readonly studentUserId: string;
    readonly displayName: string;
    readonly studentNumber: string;
    readonly studentNumberVerified: boolean;
    /** Level derived from the matric number as of the offering's session, e.g. "300 Level". */
    readonly levelLabel: string;
    /** Both levels are known and differ (carry-over, elective or a mistyped matric number). */
    readonly levelDiffers: boolean;
    readonly enrollmentStatus: 'active' | 'withdrawn' | 'completed';
    readonly enrolledAt: Date;
    readonly eligibleSessions: number;
    readonly attendedSessions: number;
    readonly rate: number | null;
    readonly belowThreshold: boolean;
    readonly cells: readonly AttendanceReportCell[];
  }>;
}

export function buildOfferingReport(
  source: OfferingReportSource,
  options: { readonly now: Date; readonly threshold: number },
): OfferingAttendanceReport {
  const recordIndex = new Map<string, CellRecord>();
  for (const record of source.records) {
    recordIndex.set(`${record.attendanceSessionId}:${record.studentUserId}`, record);
  }

  const sessionStartYear = source.offering.sessionStartYear ?? academicSessionStartYear({ now: options.now });
  const courseLevel = source.offering.level ? parseCourseLevel(source.offering.level) : null;
  const live = source.sessions.map((session) => publicSessionState(session, options.now) === 'open');
  const students = source.students.map((student) => {
    const level = deriveStudentLevel({
      matricNumber: student.studentNumber,
      entryYear: student.entryYear ?? null,
      entryLevel: student.entryLevel ?? null,
      programmeYears: student.programmeYears ?? null,
      sessionStartYear,
    });
    const cells = source.sessions.map((session) =>
      classifyCell(recordIndex.get(`${session.id}:${student.studentUserId}`), session.startsAt, student.enrolledAt));
    // A class still taking attendance counts once the student has checked in (or been removed);
    // not having checked in yet is not a miss until it ends.
    const eligibleSessions = cells.filter((cell, index) => cell !== 'not_enrolled' && !(cell === 'absent' && live[index])).length;
    const attendedSessions = cells.filter(isAttendedCell).length;
    const rate = percent(attendedSessions, eligibleSessions);
    return {
      ...student,
      levelLabel: level.label,
      levelDiffers: courseLevel != null && level.level != null && level.level !== courseLevel,
      eligibleSessions,
      attendedSessions,
      rate,
      belowThreshold: student.enrollmentStatus !== 'withdrawn' && rate != null && rate < options.threshold,
      cells,
    };
  });

  // Students who completed the course (its semester ended) still count; only those who left do not.
  const active = students.filter((student) => student.enrollmentStatus !== 'withdrawn');

  const sessions = source.sessions.map((session, index) => {
    const counts = {
      within_boundary: 0,
      inconclusive: 0,
      unlocated: 0,
      manual: 0,
      revoked: 0,
    };
    for (const student of students) {
      const cell = student.cells[index];
      if (cell && cell in counts) counts[cell as keyof typeof counts] += 1;
    }
    let expectedCount = 0;
    let activePresent = 0;
    for (const student of active) {
      const cell = student.cells[index];
      if (!cell || cell === 'not_enrolled') continue;
      expectedCount += 1;
      if (isAttendedCell(cell)) activePresent += 1;
    }
    return {
      id: session.id,
      title: session.title,
      startsAt: session.startsAt,
      status: publicSessionState(session, options.now),
      venueName: session.venueName,
      expectedCount,
      presentCount: counts.within_boundary + counts.inconclusive + counts.unlocated + counts.manual,
      withinBoundaryCount: counts.within_boundary,
      inconclusiveCount: counts.inconclusive,
      unlocatedCount: counts.unlocated,
      manualCount: counts.manual,
      revokedCount: counts.revoked,
      rate: percent(activePresent, expectedCount),
    };
  });

  const attendedActive = active.reduce((total, student) => total + student.attendedSessions, 0);
  const eligibleActive = active.reduce((total, student) => total + student.eligibleSessions, 0);

  return {
    offering: source.offering,
    generatedAt: options.now,
    threshold: options.threshold,
    totals: {
      sessionsHeld: sessions.length,
      activeStudents: active.length,
      averageRate: percent(attendedActive, eligibleActive),
      studentsBelowThreshold: active.filter((student) => student.belowThreshold).length,
      presentRecords: sessions.reduce((total, session) => total + session.presentCount, 0),
      inconclusiveRecords: sessions.reduce((total, session) => total + session.inconclusiveCount, 0),
      manualRecords: sessions.reduce((total, session) => total + session.manualCount, 0),
      revokedRecords: sessions.reduce((total, session) => total + session.revokedCount, 0),
      openDisputes: source.openDisputes ?? 0,
    },
    sessions,
    students,
  };
}

/** The most courses the reports overview lists. */
export const REPORT_OVERVIEW_LIMIT = 60;

export interface ReportOverviewCourse {
  readonly courseOfferingId: string;
  readonly sessionsHeld: number;
  readonly activeStudents: number;
  readonly averageRate: number | null;
  readonly studentsBelowThreshold: number;
  readonly lastSessionAt: Date | null;
}

/** One course's standing for the overview, taken from its full report. */
export function summarizeReport(report: OfferingAttendanceReport): ReportOverviewCourse {
  return {
    courseOfferingId: report.offering.id,
    sessionsHeld: report.totals.sessionsHeld,
    activeStudents: report.totals.activeStudents,
    averageRate: report.totals.averageRate,
    studentsBelowThreshold: report.totals.studentsBelowThreshold,
    lastSessionAt: report.sessions.at(-1)?.startsAt ?? null,
  };
}

export interface StudentCourseSummary {
  readonly courseOfferingId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly sessionsHeld: number;
  readonly attended: number;
  readonly revoked: number;
  readonly rate: number | null;
  readonly lastSessionAt: Date | null;
}

/** Per-course attendance for one student, using the same eligibility rule as the lecturer report. */
/**
 * Whether a class counts for a student, by the lecturer report's rule: a class from before they
 * joined counts only if they have a record for it, and a class still taking attendance is not
 * missed until it ends.
 */
function countsForStudent(session: StudentSummarySource['sessions'][number], status: unknown, enrolledAt: Date): boolean {
  if (!status && session.startsAt.getTime() < enrolledAt.getTime()) return false;
  return !(!status && session.live);
}

export function buildStudentSummary(source: StudentSummarySource): StudentCourseSummary[] {
  const recordBySession = new Map(source.records.map((record) => [record.attendanceSessionId, record.status]));
  return source.enrollments.map((enrollment) => {
    const sessions = source.sessions.filter((session) => session.courseOfferingId === enrollment.courseOfferingId);
    let sessionsHeld = 0;
    let attended = 0;
    let revoked = 0;
    let lastSessionAt: Date | null = null;
    for (const session of sessions) {
      if (!lastSessionAt || session.startsAt > lastSessionAt) lastSessionAt = session.startsAt;
      const status = recordBySession.get(session.id);
      if (!countsForStudent(session, status, enrollment.enrolledAt)) continue;
      sessionsHeld += 1;
      if (status === 'present') attended += 1;
      if (status === 'revoked') revoked += 1;
    }
    return {
      courseOfferingId: enrollment.courseOfferingId,
      courseCode: enrollment.courseCode,
      courseTitle: enrollment.courseTitle,
      sessionsHeld,
      attended,
      revoked,
      rate: percent(attended, sessionsHeld),
      lastSessionAt,
    };
  });
}

/**
 * The classes behind a summary's "missed": held while the student was on the course, over, and
 * with no record. Built from the same source and rule as buildStudentSummary, so the list and the
 * percentages always agree. Newest first.
 */
export function buildStudentMissed(source: StudentSummarySource, limit = 500): StudentMissedClass[] {
  const recorded = new Set(source.records.map((record) => record.attendanceSessionId));
  const enrollments = new Map(source.enrollments.map((enrollment) => [enrollment.courseOfferingId, enrollment]));
  const missed: StudentMissedClass[] = [];
  for (const session of source.sessions) {
    const enrollment = enrollments.get(session.courseOfferingId);
    if (!enrollment || recorded.has(session.id) || !countsForStudent(session, undefined, enrollment.enrolledAt)) continue;
    missed.push({
      attendanceSessionId: session.id,
      courseOfferingId: session.courseOfferingId,
      courseCode: enrollment.courseCode,
      courseTitle: enrollment.courseTitle,
      sessionTitle: session.title ?? 'Class',
      venueName: session.venueName ?? null,
      startsAt: session.startsAt,
    });
  }
  return missed.sort((a, b) => b.startsAt.getTime() - a.startsAt.getTime()).slice(0, limit);
}

/* ------------------------------------------------------------------------ */
/* CSV export                                                                */
/* ------------------------------------------------------------------------ */

/** Each cell starts with P or A, so a register can be read (and counted) at a glance. */
const CELL_LABELS: Record<AttendanceReportCell, string> = {
  within_boundary: 'P',
  inconclusive: 'P (location unsure)',
  unlocated: 'P',
  manual: 'P (marked by lecturer)',
  revoked: 'A (check-in removed)',
  absent: 'A',
  not_enrolled: 'n/a (not on the course yet)',
};

/**
 * Escapes one CSV field per RFC 4180 and neutralizes spreadsheet formula
 * injection: values beginning with `=`, `+`, `-`, `@`, tab or carriage return
 * are prefixed with an apostrophe so a spreadsheet treats them as text. This
 * matters because names, titles and self-reported student numbers are
 * user-controlled.
 */
export function csvField(value: string | number | boolean | null): string {
  if (value == null) return '';
  let text = typeof value === 'string' ? value : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  if (/[",\r\n]/.test(text) || text !== text.trim()) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Lagos time (WAT, UTC+1 all year), as lecturers read a timetable: "2026-10-27 13:00". */
const lagosMinute = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Lagos',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
function localMinute(date: Date): string {
  const part = Object.fromEntries(lagosMinute.formatToParts(date).map((item) => [item.type, item.value]));
  return `${part.year}-${part.month}-${part.day} ${part.hour}:${part.minute}`;
}

export function renderReportCsv(report: OfferingAttendanceReport): string {
  const header = [
    'Student name',
    'Student number',
    'Student number status',
    'Level (from matric number)',
    'Enrollment status',
    'Enrolled (Lagos time)',
    'Eligible sessions',
    'Attended sessions',
    'Attendance rate (%)',
    `Below ${report.threshold}% threshold`,
    ...report.sessions.map((session) => `${localMinute(session.startsAt)} - ${session.title}`),
  ];
  const rows = report.students.map((student) => [
    student.displayName,
    student.studentNumber,
    student.studentNumberVerified ? 'verified' : 'self-reported',
    student.levelLabel,
    student.enrollmentStatus,
    localMinute(student.enrolledAt),
    student.eligibleSessions,
    student.attendedSessions,
    student.rate == null ? '' : student.rate.toFixed(1),
    student.belowThreshold ? 'yes' : 'no',
    ...student.cells.map((cell) => CELL_LABELS[cell]),
  ]);
  // UTF-8 byte-order mark so spreadsheet software detects the encoding of
  // names with diacritics; CRLF line endings per RFC 4180.
  return `\uFEFF${[header, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;
}

export function reportCsvFilename(courseCode: string, generatedAt: Date): string {
  const safeCode = courseCode.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 32) || 'course';
  return `${safeCode}-attendance-${generatedAt.toISOString().slice(0, 10)}.csv`;
}
