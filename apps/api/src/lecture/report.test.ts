import { describe, expect, it } from 'vitest';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type { CourseStudentRecord, LectureRepository, ReportFilter, SummarySessionRecord } from './repository.js';
import { LectureService } from './service.js';

const NOW = new Date('2026-11-12T10:00:00.000Z');
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const admin = {
  id: 'admin', accountType: 'administrator', institutionId: 'inst', role: 'institution_administrator',
  scope: { type: 'institution', id: 'inst', label: 'LASU' },
} as unknown as AuthenticatedAccount;
const actor = { userId: 'admin', institutionId: 'inst', displayName: 'Admin', lecturerDepartmentId: null, lecturerFacultyId: null, student: null, classRep: null };

type FakeSession = SummarySessionRecord & { readonly attendees: readonly string[] };
function session(id: string, courseCode: string, startsAt: Date, attendees: readonly string[], extra: Partial<SummarySessionRecord> = {}): FakeSession {
  return {
    id, courseCode, courseTitle: `${courseCode} title`, startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000), closedAt: null,
    creatorRole: 'lecturer', departmentId: 'dep', departmentName: 'ECE', facultyName: 'Engineering', presentCount: attendees.length,
    attendees, ...extra,
  };
}

// GET 201 meets four times this semester: A at all four, B three, C two (50%), D one (25%).
// CSC 301 has met twice, too few to judge anyone.
const SESSIONS: FakeSession[] = [
  session('s1', 'GET 201', daysAgo(20), ['A', 'B', 'C', 'D']),
  session('s2', 'GET 201', daysAgo(10), ['A', 'B', 'C']),
  session('s3', 'GET 201', daysAgo(3), ['A', 'B'], { creatorRole: 'hoc' }),
  session('s4', 'get201', daysAgo(0.1), ['A']),
  session('c1', 'CSC 301', daysAgo(9), ['E']),
  session('c2', 'CSC 301', daysAgo(2), [], { departmentId: 'cs', departmentName: 'Computer Science' }),
];

function harness() {
  const filters: ReportFilter[] = [];
  const within = (filter: ReportFilter) => SESSIONS.filter((item) => item.startsAt >= filter.since && item.startsAt <= filter.until
    && (!filter.departmentId || item.departmentId === filter.departmentId));
  const repository = {
    findActor: async () => actor,
    findDepartmentName: async (_institution: string, id: string) => (id === 'dep' ? 'ECE' : null),
    listSemesters: async () => [{ id: 'sem', label: '2026/2027 · First Semester', startsAt: new Date('2026-10-01T00:00:00+01:00'), endsAt: new Date('2027-02-01T00:00:00+01:00') }],
    listReportSessions: async (_user: string, _visibility: unknown, filter: ReportFilter) => {
      filters.push(filter);
      return within(filter);
    },
    listCourseStudents: async (_user: string, _visibility: unknown, filter: ReportFilter) => {
      const rows = new Map<string, CourseStudentRecord>();
      for (const item of within(filter)) {
        const courseKey = item.courseCode.replace(/\s+/g, '').toUpperCase();
        for (const matricKey of item.attendees) {
          const key = `${courseKey}|${matricKey}`;
          const row = rows.get(key);
          rows.set(key, { courseKey, matricKey, fullName: `Student ${matricKey}`, attended: (row?.attended ?? 0) + 1 });
        }
      }
      return [...rows.values()];
    },
    summariseReportEntries: async (_user: string, _visibility: unknown, filter: ReportFilter) => {
      const list = within(filter);
      return {
        checkIns: list.reduce((sum, item) => sum + item.presentCount, 0),
        uniqueStudents: new Set(list.flatMap((item) => item.attendees)).size,
        guestCheckIns: 0, manualCheckIns: 1, removedEntries: 0, sharedDeviceEntries: 2, outsideEntries: 3,
      };
    },
  } as unknown as LectureRepository;
  return { service: new LectureService({ repository, now: () => NOW }), filters };
}

describe('attendance report', () => {
  it('rates each session against its course roster and compares with the week before', async () => {
    const { service } = harness();
    const report = await service.report(admin, 'week');
    // This week: s3 (2 of 4) + s4 (1 of 4) + c2 (0 of 1) = 3 of 9.
    expect(report.totals).toMatchObject({ sessions: 3, checkIns: 3, courses: 2, rate: 33.3 });
    // The week before: s2 (3 of 4) and c1 (1 of 1) = 4 of 5.
    expect(report.totals.previous).toEqual({ sessions: 2, rate: 80 });
    expect(report.from).toBe('2026-11-06');
    expect(report.daily).toHaveLength(7);
    expect(report.daily.at(-1)).toMatchObject({ date: '2026-11-12', sessions: 1, checkIns: 1, rate: 25 });
    expect(report.daily.find((day) => day.sessions === 0)?.rate).toBeNull();
    // Lowest rate first; codes typed with and without a space are one course.
    expect(report.courses.map((course) => [course.courseCode, course.sessions, course.rate, course.students])).toEqual([
      ['CSC 301', 1, 0, 1],
      ['get201', 2, 37.5, 4],
    ]);
    expect(report.takers).toEqual({ lecturer: 2, classRep: 1, administrator: 0 });
    expect(report.checks).toEqual({ manual: 1, outside: 3, sharedPhone: 2, guest: 0, removed: 0 });
  });

  it('lists students below 75% this semester, worst first, once a course has met three times', async () => {
    const { service } = harness();
    const report = await service.report(admin, 'week');
    expect(report.term).toMatchObject({ label: '2026/2027 · First Semester', from: '2026-10-01', to: '2027-01-31' });
    expect(report.below.students).toBe(2);
    expect(report.below.rows.map((row) => [row.matricNumber, row.attended, row.held, row.rate])).toEqual([
      ['D', 1, 4, 25],
      ['C', 2, 4, 50],
    ]);
    expect(report.courses.find((course) => course.courseCode === 'get201')?.below).toBe(2);
  });

  it('covers the semester from its first day, without a previous period', async () => {
    const { service, filters } = harness();
    const report = await service.report(admin, 'term');
    expect(report.from).toBe('2026-10-01');
    expect(report.totals.previous).toBeNull();
    expect(report.totals.sessions).toBe(6);
    expect(filters[0]?.since.toISOString()).toBe('2026-09-30T23:00:00.000Z');
  });

  it('narrows everything to one department and refuses an unknown one', async () => {
    const { service, filters } = harness();
    const report = await service.report(admin, 'month', 'dep');
    expect(report.department).toEqual({ id: 'dep', name: 'ECE' });
    expect(filters.every((filter) => filter.departmentId === 'dep')).toBe(true);
    expect(report.departments.map((group) => group.name)).toEqual(['ECE']);
    await expect(service.report(admin, 'week', '0f6d3a52-6c1b-4f0e-9a51-2a9a3f1c7d10')).rejects.toMatchObject({ statusCode: 404 });
  });
});
