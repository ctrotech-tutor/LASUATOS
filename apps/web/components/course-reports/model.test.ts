import { describe, expect, it } from 'vitest';
import {
  classesToReach,
  correctionFor,
  groupCourses,
  isBelow,
  matches,
  missedInARow,
  sortStudents,
  summarize,
  type Offering,
  type Report,
  type Standing,
  type Student,
} from './model';

function student(overrides: Partial<Student>): Student {
  return {
    studentId: '00000000-0000-4000-8000-000000000020',
    displayName: 'Tolulope Adebayo',
    studentNumber: '230591005',
    studentNumberVerified: true,
    levelLabel: '300 Level',
    levelDiffers: false,
    enrollmentStatus: 'active',
    enrolledAt: '2026-10-05T08:00:00.000Z',
    eligibleSessions: 4,
    attendedSessions: 3,
    rate: 75,
    belowThreshold: false,
    cells: ['within_boundary', 'absent', 'manual', 'inconclusive'],
    ...overrides,
  };
}

describe('marks and corrections', () => {
  it('offers removing an attended mark and marking present only for students still on the course', () => {
    expect(correctionFor('within_boundary', 'active')).toBe('revoke');
    expect(correctionFor('manual', 'withdrawn')).toBe('revoke');
    expect(correctionFor('absent', 'active')).toBe('mark_present');
    expect(correctionFor('revoked', 'active')).toBe('mark_present');
    expect(correctionFor('absent', 'withdrawn')).toBeNull();
    expect(correctionFor('not_enrolled', 'active')).toBeNull();
  });

  it('counts the classes in a row needed to reach the line', () => {
    expect(classesToReach(3, 4, 75)).toBeNull();
    // (2 + k) / (4 + k) >= 0.75 → k = 4
    expect(classesToReach(2, 4, 75)).toBe(4);
    expect(classesToReach(0, 10, 80)).toBe(40);
    expect(classesToReach(0, 1, 100)).toBe(Infinity);
  });

  it('counts misses back from the latest class, stopping before the student joined', () => {
    expect(missedInARow(['within_boundary', 'absent', 'revoked'])).toBe(2);
    expect(missedInARow(['not_enrolled', 'absent'])).toBe(1);
    expect(missedInARow(['absent', 'manual'])).toBe(0);
  });

  it('flags below the line only for students still on the course with a rate', () => {
    expect(isBelow({ enrollmentStatus: 'active', rate: 74.9 }, 75)).toBe(true);
    expect(isBelow({ enrollmentStatus: 'active', rate: 75 }, 75)).toBe(false);
    expect(isBelow({ enrollmentStatus: 'withdrawn', rate: 10 }, 75)).toBe(false);
    expect(isBelow({ enrollmentStatus: 'completed', rate: 10 }, 75)).toBe(true);
    expect(isBelow({ enrollmentStatus: 'active', rate: null }, 75)).toBe(false);
  });
});

describe('students list', () => {
  const ada = student({ studentId: 'a', displayName: 'Ada Bello', studentNumber: '230591002', rate: 40 });
  const bayo = student({ studentId: 'b', displayName: 'bayo Ade', studentNumber: '230591001', rate: 90 });
  const chi = student({ studentId: 'c', displayName: 'Chi Obi', studentNumber: '230591003', rate: 10, enrollmentStatus: 'withdrawn' });
  const dayo = student({ studentId: 'd', displayName: 'Dayo Ojo', studentNumber: '230591004', rate: null });

  it('puts students still on the course first, then sorts', () => {
    expect(sortStudents([chi, bayo, ada, dayo], 'name').map((row) => row.studentId)).toEqual(['a', 'b', 'd', 'c']);
    expect(sortStudents([chi, bayo, ada, dayo], 'matric').map((row) => row.studentId)).toEqual(['b', 'a', 'd', 'c']);
    // Lowest first; no rate yet sorts last.
    expect(sortStudents([chi, bayo, ada, dayo], 'rate').map((row) => row.studentId)).toEqual(['a', 'b', 'd', 'c']);
  });

  it('finds by name or matric, ignoring spaces and case', () => {
    expect(matches(ada, 'adabel')).toBe(true);
    expect(matches(ada, ' 2305 91002 ')).toBe(true);
    expect(matches(ada, 'chi')).toBe(false);
    expect(matches(ada, '')).toBe(true);
  });

  it('summarizes against the chosen line, over students still on the course', () => {
    const report = {
      sessions: [{}, {}, {}],
      students: [ada, bayo, chi, dayo],
      totals: { averageRate: 65 },
    } as unknown as Report;
    expect(summarize(report, 75)).toEqual({ classes: 3, students: 3, average: 65, below: 1, left: 1 });
    expect(summarize(report, 95)).toMatchObject({ below: 2 });
  });
});

describe('course list', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  function offering(id: string, code: string, starts: string, ends: string): Offering {
    return {
      courseOfferingId: id,
      courseCode: code,
      courseTitle: code,
      semesterStartsAt: starts,
      semesterEndsAt: ends,
    } as unknown as Offering;
  }
  const current = offering('1', 'ECE 305', '2026-10-05T00:00:00Z', '2027-02-27T00:00:00Z');
  const another = offering('2', 'ECE 201', '2026-10-05T00:00:00Z', '2027-02-27T00:00:00Z');
  const next = offering('3', 'GET 201', '2027-03-01T00:00:00Z', '2027-07-01T00:00:00Z');
  const old = offering('4', 'ECE 101', '2026-03-01T00:00:00Z', '2026-07-01T00:00:00Z');
  const older = offering('5', 'ECE 102', '2026-03-01T00:00:00Z', '2026-07-01T00:00:00Z');
  const standing = (id: string, last: string | null): Standing => ({
    courseOfferingId: id,
    sessionsHeld: 2,
    activeStudents: 10,
    averageRate: 80,
    studentsBelowThreshold: 1,
    lastSessionAt: last,
  });

  it('groups this semester, next semester and earlier, with standings joined in', () => {
    const groups = groupCourses([old, next, current, older, another], [standing('1', '2026-11-09T09:00:00Z'), standing('4', '2026-05-01T09:00:00Z'), standing('5', '2026-06-01T09:00:00Z')], now);
    expect(groups.current.map((row) => row.offering.courseCode)).toEqual(['ECE 201', 'ECE 305']);
    expect(groups.current[1]?.standing?.averageRate).toBe(80);
    expect(groups.current[0]?.standing).toBeNull();
    expect(groups.upcoming.map((row) => row.offering.courseCode)).toEqual(['GET 201']);
    // Earlier: latest class first.
    expect(groups.earlier.map((row) => row.offering.courseCode)).toEqual(['ECE 102', 'ECE 101']);
  });
});
