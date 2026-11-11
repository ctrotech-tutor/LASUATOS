import type {
  AttendanceRecordMethod,
  AttendanceRecordStatus,
  AttendanceVenueOutcomeValue,
  OfferingReportSource,
  StudentSummarySource,
} from './repository.js';

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

  const students = source.students.map((student) => {
    const cells = source.sessions.map((session) =>
      classifyCell(recordIndex.get(`${session.id}:${student.studentUserId}`), session.startsAt, student.enrolledAt));
    const eligibleSessions = cells.filter((cell) => cell !== 'not_enrolled').length;
    const attendedSessions = cells.filter(isAttendedCell).length;
    const rate = percent(attendedSessions, eligibleSessions);
    return {
      ...student,
      eligibleSessions,
      attendedSessions,
      rate,
      belowThreshold: student.enrollmentStatus === 'active' && rate != null && rate < options.threshold,
      cells,
    };
  });

  const active = students.filter((student) => student.enrollmentStatus === 'active');

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
      if (!status && session.startsAt.getTime() < enrollment.enrolledAt.getTime()) continue;
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

/* ------------------------------------------------------------------------ */
/* CSV export                                                                */
/* ------------------------------------------------------------------------ */

const CELL_LABELS: Record<AttendanceReportCell, string> = {
  within_boundary: 'present (within venue boundary)',
  inconclusive: 'present (location inconclusive)',
  unlocated: 'present (no venue check)',
  manual: 'present (recorded by lecturer)',
  revoked: 'revoked by lecturer',
  absent: 'absent',
  not_enrolled: 'not yet enrolled',
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

function isoMinute(date: Date): string {
  return `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function renderReportCsv(report: OfferingAttendanceReport): string {
  const header = [
    'Student name',
    'Student number',
    'Student number status',
    'Enrollment status',
    'Enrolled at (UTC)',
    'Eligible sessions',
    'Attended sessions',
    'Attendance rate (%)',
    `Below ${report.threshold}% threshold`,
    ...report.sessions.map((session) => `${isoMinute(session.startsAt)} - ${session.title}`),
  ];
  const rows = report.students.map((student) => [
    student.displayName,
    student.studentNumber,
    student.studentNumberVerified ? 'verified' : 'self-reported',
    student.enrollmentStatus,
    isoMinute(student.enrolledAt),
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
