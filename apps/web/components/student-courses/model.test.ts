import type { StudentAttendanceCourseSummary, StudentEnrollment } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import { backspacedDash, caretAfter, codeCharsBefore, courseLine, groupCourses, joinFailure, misreadHint, readJoinCode } from './model';

describe('readJoinCode', () => {
  it('groups a typed or pasted code and drops spaces, dashes and case', () => {
    expect(readJoinCode('7k9m pq2r 4xbd')).toMatchObject({ code: '7K9MPQ2R4XBD', display: '7K9M-PQ2R-4XBD', complete: true, misread: [] });
    expect(readJoinCode(' 7K9M-PQ2R-4XBD ')).toMatchObject({ display: '7K9M-PQ2R-4XBD', complete: true });
    expect(readJoinCode('7K9MP')).toMatchObject({ display: '7K9M-P', complete: false });
    expect(readJoinCode('')).toMatchObject({ code: '', display: '', complete: false });
  });

  it('keeps only twelve characters', () => {
    expect(readJoinCode('7K9MPQ2R4XBDEXTRA').code).toBe('7K9MPQ2R4XBD');
  });

  it('flags characters a code never has, once each, without dropping them', () => {
    const input = readJoinCode('7K9O-PQ2R-0XB0');
    expect(input.display).toBe('7K9O-PQ2R-0XB0');
    expect(input.misread).toEqual(['O', '0']);
    expect(input.complete).toBe(false);
    expect(misreadHint(input.misread)).toMatch(/never use “O” and “0”/);
  });
});

describe('caret handling', () => {
  it('puts the caret after the same number of code characters once regrouped', () => {
    expect(caretAfter('7K9M-PQ2R-4XBD', 4)).toBe(4);
    expect(caretAfter('7K9M-PQ2R-4XBD', 5)).toBe(6);
    expect(caretAfter('7K9M-PQ2R-4XBD', 12)).toBe(14);
    expect(caretAfter('7K9M', 0)).toBe(0);
  });

  it('counts code characters before a position, ignoring dashes and spaces', () => {
    expect(codeCharsBefore('7K9M-PQ', 6)).toBe(5);
    expect(codeCharsBefore('7k 9m', 5)).toBe(4);
  });

  it('turns a backspace over a dash into deleting the character before it', () => {
    // "7K9M-PQ" with the caret after the dash; backspace removes the dash only.
    expect(backspacedDash('7K9M-PQ', '7K9MPQ', 4)).toEqual({ code: '7K9PQ', before: 3 });
    // Ordinary deletes are left alone.
    expect(backspacedDash('7K9M-PQ', '7K9M-P', 6)).toBeNull();
    expect(backspacedDash('7K9M', '7K9M5', 5)).toBeNull();
  });
});

describe('joinFailure', () => {
  it('explains each refusal in words a student can act on', () => {
    expect(joinFailure({ status: 400, message: 'x' }).title).toBe('That code didn’t work');
    expect(joinFailure({ status: 409, message: 'x' }).title).toMatch(/isn’t taking new students/);
    expect(joinFailure({ status: 403, message: 'x' }).title).toMatch(/Only students/);
    expect(joinFailure({ status: 429, message: 'x' }).title).toBe('Too many tries');
    expect(joinFailure({ status: 500, message: 'x' }).title).toBe('Something went wrong');
    expect(joinFailure(new TypeError('Failed to fetch')).title).toBe('No connection');
  });
});

const enrollment = (id: string, code: string, endsAt: string, extra: Partial<StudentEnrollment> = {}): StudentEnrollment => ({
  courseOfferingId: `00000000-0000-4000-8000-0000000000${id}`,
  courseCode: code,
  courseTitle: `${code} title`,
  departmentName: 'Electronic and Computer Engineering',
  semesterName: 'First',
  level: '400',
  semesterEndsAt: endsAt,
  enrolledAt: '2026-10-01T09:00:00.000Z',
  ...extra,
});

describe('groupCourses', () => {
  const now = Date.parse('2026-11-10T12:00:00.000Z');
  const summary: StudentAttendanceCourseSummary[] = [{
    courseOfferingId: '00000000-0000-4000-8000-000000000041',
    courseCode: 'ECE 409',
    courseTitle: 'ECE 409 title',
    sessionsHeld: 8,
    attended: 6,
    revoked: 0,
    rate: 75,
    lastSessionAt: '2026-11-09T09:00:00.000Z',
  }];

  it('puts running semesters first in code order, ended ones under earlier, newest first', () => {
    const groups = groupCourses([
      enrollment('41', 'ECE 409', '2027-02-28T22:59:59.000Z'),
      enrollment('40', 'ECE 405', '2027-02-28T22:59:59.000Z'),
      enrollment('39', 'ECE 305', '2026-02-28T22:59:59.000Z'),
      enrollment('38', 'ECE 307', '2026-07-31T22:59:59.000Z'),
    ], summary, now);
    expect(groups.current.map((course) => course.courseCode)).toEqual(['ECE 405', 'ECE 409']);
    expect(groups.earlier.map((course) => course.courseCode)).toEqual(['ECE 307', 'ECE 305']);
  });

  it('carries attendance so far and the My attendance address', () => {
    const groups = groupCourses([enrollment('41', 'ECE 409', '2027-02-28T22:59:59.000Z'), enrollment('40', 'ECE 405', '2027-02-28T22:59:59.000Z')], summary, now);
    expect(groups.current[1]).toMatchObject({ slug: 'ece-409', held: 8, attended: 6, rate: 75 });
    expect(groups.current[0]).toMatchObject({ slug: 'ece-405', held: 0, rate: null });
  });
});

describe('courseLine', () => {
  it('reads naturally whether or not the stored level and semester already say so', () => {
    expect(courseLine({ level: '400', semesterName: 'First' })).toBe('400 level · First semester');
    expect(courseLine({ level: '400 Level', semesterName: 'Second semester' })).toBe('400 Level · Second semester');
  });
});
