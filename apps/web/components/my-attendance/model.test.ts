import type { StudentAttendanceHistoryEntry, StudentLectureHistory } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import { buildCourses, buildLectures, canMiss, catchUp, counts, courseSlug, dayLabel, groupByDay, lectureLine, overall, recentForm, standing, toReach, verdict } from './model';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const history: StudentLectureHistory = {
  entries: [
    { id: ID(1), courseCode: 'ECE 401', courseTitle: 'Digital Signal Processing', checkedInAt: '2026-11-11T07:21:00.000Z', method: 'qr', venueName: 'LT 1', removed: false, removedReason: null },
    { id: ID(2), courseCode: 'ECE 405', courseTitle: 'Control Systems', checkedInAt: '2026-11-10T09:12:00.000Z', method: 'code', venueName: null, removed: true, removedReason: 'Left early' },
    { id: ID(3), courseCode: 'ECE 405', courseTitle: 'Control Systems', checkedInAt: '2026-11-05T09:02:00.000Z', method: 'manual', venueName: null, removed: false, removedReason: null },
  ],
  missed: [
    { id: ID(4), courseCode: 'ECE 405', courseTitle: 'Control Systems', startsAt: '2026-11-12T09:00:00.000Z', venueName: 'LT 1' },
  ],
  courses: [
    { courseCode: 'ECE 401', courseTitle: 'Digital Signal Processing', held: 1, attended: 1, rate: 100 },
    { courseCode: 'ECE 405', courseTitle: 'Control Systems', held: 3, attended: 1, rate: 33.3 },
  ],
};

const record: StudentAttendanceHistoryEntry = {
  attendanceSessionId: ID(9),
  courseOfferingId: ID(10),
  courseCode: 'ECE401',
  courseTitle: 'Digital Signal Processing',
  sessionTitle: 'Week 3',
  venueName: null,
  venueOutcome: 'inconclusive',
  method: 'qr_code',
  status: 'revoked',
  startsAt: '2026-10-01T07:00:00.000Z',
  checkedInAt: '2026-10-01T07:05:00.000Z',
  removedReason: 'Seen leaving after roll call',
};

describe('my attendance model', () => {
  it('puts attended, removed, missed and course check-ins on one timeline, newest first', () => {
    const lectures = buildLectures(history, [record]);
    expect(lectures.map((lecture) => [lecture.id, lecture.status])).toEqual([
      [ID(4), 'missed'], [ID(1), 'present'], [ID(2), 'removed'], [ID(3), 'present'], [ID(9), 'removed'],
    ]);
    expect(lectures[2]).toMatchObject({ reason: 'Left early', method: 'Typed code', sessionId: null });
    expect(lectures[4]).toMatchObject({ sessionId: ID(9), reason: 'Seen leaving after roll call', imprecise: true, method: 'QR scan' });
    expect(counts(lectures)).toEqual({ present: 2, missed: 1, removed: 2 });
  });

  it('lists missed classes of joined courses, which can be disputed', () => {
    const lectures = buildLectures(null, [], [
      { attendanceSessionId: ID(20), courseOfferingId: ID(10), courseCode: 'ECE401', courseTitle: 'Digital Signal Processing', sessionTitle: 'Week 4', venueName: 'LT 1', startsAt: '2026-10-08T07:00:00.000Z' },
    ]);
    expect(lectures).toEqual([{
      id: ID(20), courseCode: 'ECE401', courseTitle: 'Digital Signal Processing', at: '2026-10-08T07:00:00.000Z', status: 'missed',
      method: null, venueName: 'LT 1', reason: null, sessionId: ID(20), imprecise: false,
    }]);
    expect(lectureLine(lectures[0]!)).toBe('Class at 08:00 · LT 1');
  });

  it('merges a course across both kinds of attendance by its code', () => {
    const lectures = buildLectures(history, [record]);
    const courses = buildCourses(history, [{ courseOfferingId: ID(10), courseCode: 'ECE401', courseTitle: 'Digital Signal Processing', sessionsHeld: 2, attended: 1, revoked: 1, rate: 50, lastSessionAt: null }], lectures);
    expect(courses.map((course) => [course.slug, course.held, course.attended, course.rate, course.missed, course.removed])).toEqual([
      ['ece-401', 3, 2, 66.7, 0, 1],
      ['ece-405', 3, 1, 33.3, 1, 1],
    ]);
    expect(courses[1]!.lectures.map((lecture) => lecture.id)).toEqual([ID(4), ID(2), ID(3)]);
    expect(overall(courses)).toEqual({ held: 6, attended: 3, rate: 50 });
  });

  it('works out the spare lectures and the lectures needed against the line', () => {
    expect(canMiss(19, 20, 75)).toBe(5);
    expect(canMiss(3, 4, 75)).toBe(0);
    expect(canMiss(0, 0, 75)).toBe(0);
    expect(toReach(12, 20, 75)).toBe(12);
    expect(toReach(2, 3, 75)).toBe(1);
    expect(toReach(15, 20, 75)).toBe(0);
    expect(standing({ held: 20, attended: 19, rate: 95 }, 75)).toEqual({ tone: 'good', line: 'Can miss 5 more and stay at 75%' });
    expect(standing({ held: 4, attended: 3, rate: 75 }, 75).tone).toBe('edge');
    expect(standing({ held: 20, attended: 12, rate: 60 }, 75)).toEqual({ tone: 'warning', line: 'Attend the next 12 in a row to reach 75%' });
    expect(standing({ held: 3, attended: 1, rate: 33.3 }, 75).tone).toBe('danger');
    expect(standing({ held: 0, attended: 0, rate: null }, 75).tone).toBe('none');
    expect(catchUp({ code: 'ECE 405', held: 20, attended: 12 }, 75)).toBe('Attend the next 12 ECE 405 lectures to reach 75%');
    expect(catchUp({ code: 'ECE 405', held: 3, attended: 2 }, 75)).toBe('Attend the next ECE 405 lecture to reach 75%');
  });

  it('names the courses under the line', () => {
    const courses = buildCourses(history, [], buildLectures(history, []));
    expect(verdict(courses, 75)).toMatchObject({ tone: 'danger', title: 'ECE 405 is under 75%' });
    expect(verdict(courses.slice(0, 1), 75)).toMatchObject({ tone: 'good', title: 'On track for exams' });
    expect(verdict([], 75).tone).toBe('none');
  });

  it('labels days in Lagos time and groups lectures by day', () => {
    const now = Date.parse('2026-11-12T12:00:00.000Z');
    expect(dayLabel('2026-11-12T00:30:00.000Z', now)).toBe('Today');
    expect(dayLabel('2026-11-11T23:30:00.000Z', now)).toBe('Today');
    expect(dayLabel('2026-11-11T07:00:00.000Z', now)).toBe('Yesterday');
    expect(dayLabel('2026-11-05T09:00:00.000Z', now)).toBe('Thu 5 Nov');
    expect(dayLabel('2025-11-05T09:00:00.000Z', now)).toBe('Wed 5 Nov 2025');
    const groups = groupByDay(buildLectures(history, []), now);
    expect(groups.map((group) => [group.label, group.items.length])).toEqual([['Today', 1], ['Yesterday', 1], ['Tue 10 Nov', 1], ['Thu 5 Nov', 1]]);
  });

  it('writes the line under a lecture and keeps the dots oldest first', () => {
    const lectures = buildLectures(history, []);
    expect(lectureLine(lectures[0]!)).toBe('Class at 10:00 · LT 1');
    expect(lectureLine(lectures[1]!)).toBe('08:21 · QR scan · LT 1');
    expect(recentForm(lectures, 2).map((lecture) => lecture.id)).toEqual([ID(1), ID(4)]);
    expect(courseSlug(' GNS  401 ')).toBe('gns-401');
  });
});
