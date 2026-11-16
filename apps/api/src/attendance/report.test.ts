import { describe, expect, it } from 'vitest';
import {
  buildOfferingReport,
  buildStudentMissed,
  buildStudentSummary,
  classifyCell,
  csvField,
  percent,
  renderReportCsv,
  reportCsvFilename,
} from './report.js';
import type { OfferingReportSource } from './repository.js';

const now = new Date('2026-11-10T12:00:00.000Z');
const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000);

describe('classifyCell', () => {
  const enrolledAt = day(-10);
  it('maps records by status, method and venue outcome', () => {
    expect(classifyCell({ status: 'present', method: 'qr_code', venueOutcome: 'within_boundary' }, day(-1), enrolledAt)).toBe('within_boundary');
    expect(classifyCell({ status: 'present', method: 'code', venueOutcome: 'inconclusive' }, day(-1), enrolledAt)).toBe('inconclusive');
    expect(classifyCell({ status: 'present', method: 'code', venueOutcome: null }, day(-1), enrolledAt)).toBe('unlocated');
    expect(classifyCell({ status: 'present', method: 'manual', venueOutcome: null }, day(-1), enrolledAt)).toBe('manual');
  });

  it('keeps revoked records visible instead of collapsing them into absent', () => {
    expect(classifyCell({ status: 'revoked', method: 'qr_code', venueOutcome: 'within_boundary' }, day(-1), enrolledAt)).toBe('revoked');
  });

  it('does not count sessions before enrollment against the student', () => {
    expect(classifyCell(undefined, day(-11), enrolledAt)).toBe('not_enrolled');
    expect(classifyCell(undefined, day(-10), enrolledAt)).toBe('absent');
    // A record for a pre-enrollment session still counts.
    expect(classifyCell({ status: 'present', method: 'code', venueOutcome: null }, day(-11), enrolledAt)).toBe('unlocated');
  });
});

describe('percent', () => {
  it('rounds to one decimal and returns null without a denominator', () => {
    expect(percent(1, 3)).toBe(33.3);
    expect(percent(2, 3)).toBe(66.7);
    expect(percent(0, 0)).toBeNull();
    expect(percent(5, 4)).toBe(100);
  });
});

function source(): OfferingReportSource {
  return {
    offering: {
      id: '77777777-7777-4777-8777-777777777777',
      courseCode: 'CSC 101',
      courseTitle: 'Intro',
      departmentName: 'Computer Science',
      semesterLabel: '2026/27 First',
    },
    sessions: [
      { id: 's1', title: 'Week 1', startsAt: day(-14), endsAt: day(-14), status: 'closed', venueName: 'LT1' },
      { id: 's2', title: 'Week 2', startsAt: day(-7), endsAt: day(-7), status: 'open', venueName: null },
      { id: 's3', title: 'Week 3', startsAt: now, endsAt: day(1), status: 'open', venueName: 'LT1' },
    ],
    students: [
      { studentUserId: 'a', displayName: 'Ada', studentNumber: '190001', studentNumberVerified: true, enrollmentStatus: 'active', enrolledAt: day(-30) },
      { studentUserId: 'b', displayName: 'Bayo', studentNumber: '190002', studentNumberVerified: false, enrollmentStatus: 'active', enrolledAt: day(-10) },
      { studentUserId: 'c', displayName: 'Chi', studentNumber: '190003', studentNumberVerified: false, enrollmentStatus: 'withdrawn', enrolledAt: day(-30) },
    ],
    records: [
      { attendanceSessionId: 's1', studentUserId: 'a', status: 'present', method: 'qr_code', venueOutcome: 'within_boundary' },
      { attendanceSessionId: 's2', studentUserId: 'a', status: 'present', method: 'code', venueOutcome: null },
      { attendanceSessionId: 's3', studentUserId: 'a', status: 'present', method: 'code', venueOutcome: 'inconclusive' },
      { attendanceSessionId: 's2', studentUserId: 'b', status: 'revoked', method: 'code', venueOutcome: null },
      { attendanceSessionId: 's3', studentUserId: 'b', status: 'present', method: 'manual', venueOutcome: null },
      { attendanceSessionId: 's1', studentUserId: 'c', status: 'present', method: 'code', venueOutcome: null },
    ],
  };
}

describe('buildOfferingReport', () => {
  const report = buildOfferingReport(source(), { now, threshold: 75 });

  it('computes per-student eligibility, attendance and threshold flags', () => {
    expect(report.students.map((student) => ({
      name: student.displayName,
      cells: student.cells,
      eligible: student.eligibleSessions,
      attended: student.attendedSessions,
      rate: student.rate,
      below: student.belowThreshold,
    }))).toEqual([
      { name: 'Ada', cells: ['within_boundary', 'unlocated', 'inconclusive'], eligible: 3, attended: 3, rate: 100, below: false },
      { name: 'Bayo', cells: ['not_enrolled', 'revoked', 'manual'], eligible: 2, attended: 1, rate: 50, below: true },
      // Withdrawn students are listed but never flagged. Week 3 is still taking attendance, so
      // not having checked in to it is not counted yet.
      { name: 'Chi', cells: ['unlocated', 'absent', 'absent'], eligible: 2, attended: 1, rate: 50, below: false },
    ]);
  });

  it('keeps counting students who completed the course once its semester ended', () => {
    const input = source();
    const ended = buildOfferingReport({
      ...input,
      students: input.students.map((student) => (student.enrollmentStatus === 'active' ? { ...student, enrollmentStatus: 'completed' as const } : student)),
    }, { now, threshold: 75 });
    expect(ended.totals).toMatchObject({ activeStudents: 2, averageRate: 80, studentsBelowThreshold: 1 });
    expect(ended.students.find((student) => student.displayName === 'Bayo')?.belowThreshold).toBe(true);
    expect(ended.sessions[2]?.expectedCount).toBe(2);
  });

  it('does not count a live class against a student who has not checked in yet', () => {
    const input = source();
    const live = buildOfferingReport({ ...input, records: input.records.filter((record) => !(record.attendanceSessionId === 's3' && record.studentUserId === 'b')) }, { now, threshold: 75 });
    const bayo = live.students.find((student) => student.displayName === 'Bayo')!;
    expect(bayo).toMatchObject({ cells: ['not_enrolled', 'revoked', 'absent'], eligibleSessions: 1, attendedSessions: 0, rate: 0 });
    // Once the class has ended, the same absence counts.
    const later = buildOfferingReport({ ...input, records: input.records.filter((record) => !(record.attendanceSessionId === 's3' && record.studentUserId === 'b')) }, { now: day(2), threshold: 75 });
    expect(later.students.find((student) => student.displayName === 'Bayo')).toMatchObject({ eligibleSessions: 2, attendedSessions: 0 });
  });

  it('computes per-session breakdowns with expected counts from active students only', () => {
    expect(report.sessions.map((session) => ({
      id: session.id,
      status: session.status,
      expected: session.expectedCount,
      present: session.presentCount,
      within: session.withinBoundaryCount,
      inconclusive: session.inconclusiveCount,
      unlocated: session.unlocatedCount,
      manual: session.manualCount,
      revoked: session.revokedCount,
      rate: session.rate,
    }))).toEqual([
      { id: 's1', status: 'closed', expected: 1, present: 2, within: 1, inconclusive: 0, unlocated: 1, manual: 0, revoked: 0, rate: 100 },
      { id: 's2', status: 'expired', expected: 2, present: 1, within: 0, inconclusive: 0, unlocated: 1, manual: 0, revoked: 1, rate: 50 },
      { id: 's3', status: 'open', expected: 2, present: 2, within: 0, inconclusive: 1, unlocated: 0, manual: 1, revoked: 0, rate: 100 },
    ]);
  });

  it('rolls up totals over active students', () => {
    expect(report.totals).toEqual({
      sessionsHeld: 3,
      activeStudents: 2,
      averageRate: 80,
      studentsBelowThreshold: 1,
      presentRecords: 5,
      inconclusiveRecords: 1,
      manualRecords: 1,
      revokedRecords: 1,
      openDisputes: 0,
    });
  });

  it('handles an offering with no sessions', () => {
    const empty = buildOfferingReport({ ...source(), sessions: [], records: [] }, { now, threshold: 75 });
    expect(empty.totals.averageRate).toBeNull();
    expect(empty.students.every((student) => student.rate === null && !student.belowThreshold)).toBe(true);
  });
});

describe('buildStudentSummary', () => {
  it('applies the same eligibility rule as the lecturer report', () => {
    const summary = buildStudentSummary({
      enrollments: [
        { courseOfferingId: 'o1', courseCode: 'CSC 101', courseTitle: 'Intro', enrolledAt: day(-10) },
        { courseOfferingId: 'o2', courseCode: 'MTH 101', courseTitle: 'Maths', enrolledAt: day(-30) },
      ],
      sessions: [
        { id: 's1', courseOfferingId: 'o1', startsAt: day(-14), live: false },
        { id: 's2', courseOfferingId: 'o1', startsAt: day(-7), live: false },
        { id: 's3', courseOfferingId: 'o1', startsAt: day(-1), live: false },
        // Taking attendance now, and not checked in to yet: not counted.
        { id: 's4', courseOfferingId: 'o1', startsAt: now, live: true },
      ],
      records: [
        { attendanceSessionId: 's2', status: 'present' },
        { attendanceSessionId: 's3', status: 'revoked' },
      ],
    });
    expect(summary).toEqual([
      { courseOfferingId: 'o1', courseCode: 'CSC 101', courseTitle: 'Intro', sessionsHeld: 2, attended: 1, revoked: 1, rate: 50, lastSessionAt: now },
      { courseOfferingId: 'o2', courseCode: 'MTH 101', courseTitle: 'Maths', sessionsHeld: 0, attended: 0, revoked: 0, rate: null, lastSessionAt: null },
    ]);
  });
});

describe('buildStudentMissed', () => {
  it('lists the classes behind the summary\'s misses, newest first, by the same rule', () => {
    const source = {
      enrollments: [{ courseOfferingId: 'o1', courseCode: 'CSC 101', courseTitle: 'Intro', enrolledAt: day(-10) }],
      sessions: [
        // Before they joined, no record: never theirs.
        { id: 's1', courseOfferingId: 'o1', startsAt: day(-14), live: false, title: 'Week 1', venueName: 'Hall A' },
        { id: 's2', courseOfferingId: 'o1', startsAt: day(-7), live: false, title: 'Week 2', venueName: null },
        // Removed check-in: a record, so not "missed" (it shows as removed).
        { id: 's3', courseOfferingId: 'o1', startsAt: day(-3), live: false, title: 'Week 3', venueName: 'Hall A' },
        { id: 's4', courseOfferingId: 'o1', startsAt: day(-1), live: false, title: 'Week 4', venueName: 'Hall A' },
        // Still taking attendance: not missed yet.
        { id: 's5', courseOfferingId: 'o1', startsAt: now, live: true, title: 'Week 5', venueName: 'Hall A' },
      ],
      records: [{ attendanceSessionId: 's3', status: 'revoked' as const }],
    };
    expect(buildStudentMissed(source)).toEqual([
      { attendanceSessionId: 's4', courseOfferingId: 'o1', courseCode: 'CSC 101', courseTitle: 'Intro', sessionTitle: 'Week 4', venueName: 'Hall A', startsAt: day(-1) },
      { attendanceSessionId: 's2', courseOfferingId: 'o1', courseCode: 'CSC 101', courseTitle: 'Intro', sessionTitle: 'Week 2', venueName: null, startsAt: day(-7) },
    ]);
    // Agrees with the summary: held - attended - removed.
    const [summary] = buildStudentSummary(source);
    expect(summary!.sessionsHeld - summary!.attended - summary!.revoked).toBe(2);
    expect(buildStudentMissed(source, 1)).toHaveLength(1);
  });
});

describe('CSV export', () => {
  it('neutralizes spreadsheet formulas and escapes RFC 4180 specials', () => {
    expect(csvField('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvField('+2348000000')).toBe("'+2348000000");
    expect(csvField('-1')).toBe("'-1");
    expect(csvField('@cmd')).toBe("'@cmd");
    expect(csvField('\tTabbed')).toBe("'\tTabbed");
    expect(csvField('Okafor, "Chi"')).toBe('"Okafor, ""Chi"""');
    expect(csvField('line\nbreak')).toBe('"line\nbreak"');
    expect(csvField(42)).toBe('42');
    expect(csvField(null)).toBe('');
    expect(csvField('Adébáyọ̀')).toBe('Adébáyọ̀');
  });

  it('renders one row per student with labelled cells, BOM and CRLF', () => {
    const csv = renderReportCsv(buildOfferingReport(source(), { now, threshold: 75 }));
    expect(csv.startsWith('\uFEFF')).toBe(true);
    const lines = csv.slice(1).trimEnd().split('\r\n');
    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('Below 75% threshold');
    expect(lines[0]).toContain('2026-10-27 13:00 - Week 1');
    expect(lines[1]).toBe('Ada,190001,verified,Level unknown,active,2026-10-11 13:00,3,3,100.0,no,P,P,P (location unsure)');
    expect(lines[2]).toContain('n/a (not on the course yet),A (check-in removed),P (marked by lecturer)');
    // No label may trip the formula-injection guard, or every such cell would gain a stray quote.
    expect(csv).not.toContain("'");
  });

  it('builds a safe download filename', () => {
    expect(reportCsvFilename('CSC 101', now)).toBe('CSC_101-attendance-2026-11-10.csv');
    expect(reportCsvFilename('../"evil"', now)).toBe('__evil_-attendance-2026-11-10.csv');
  });
});

describe('derived student levels in reports', () => {
  it('labels each student as of the offering session and flags level differences', () => {
    const base = source();
    const template = base.students[0]!;
    const report = buildOfferingReport({
      ...base,
      offering: { ...base.offering, level: '300 Level', sessionStartYear: 2026 },
      students: [
        { ...template, studentUserId: 'x1', studentNumber: '240591001' },
        { ...template, studentUserId: 'x2', studentNumber: '250591001' },
        { ...template, studentUserId: 'x3', studentNumber: '250591002', entryLevel: 200 },
        { ...template, studentUserId: 'x4', studentNumber: 'ENG/21/1' },
      ],
      records: [],
    }, { now, threshold: 75 });
    expect(report.students.map((student) => [student.levelLabel, student.levelDiffers])).toEqual([
      ['300 Level', false],
      ['200 Level', true],
      ['300 Level', false],
      ['Level unknown', false],
    ]);
    expect(renderReportCsv(report).split('\r\n')[0]).toContain('Level (from matric number)');
  });
});
