import { describe, expect, it } from 'vitest';
import type { InstitutionStructure } from '@lasuatos/contracts';
import {
  agoLabel, checkKey, checksFor, checkShort, checkText, countStructure, daysBetween, departmentRows, levelsLabel, matchesQuery,
  readView, semesterWeeks, sessionProblem, sessionSlug, suggestNextSession, targetName, todayIn, todayLine, viewHref,
  whenLabel, type AcademicSession, type Department, type Faculty,
} from './format';

const at = (iso: string) => Date.parse(iso);

const session = (overrides: Partial<AcademicSession> = {}): AcademicSession => ({
  id: '00000000-0000-4000-8000-000000000101',
  code: '2026/2027',
  startsAt: '2026-09-07T00:00:00+01:00',
  endsAt: '2027-07-30T23:59:00+01:00',
  isCurrent: true,
  semesters: [
    { id: '00000000-0000-4000-8000-000000000201', name: 'First Semester', startsAt: '2026-09-14T00:00:00+01:00', endsAt: '2027-01-22T23:59:00+01:00' },
    { id: '00000000-0000-4000-8000-000000000202', name: 'Second Semester', startsAt: '2027-02-15T00:00:00+01:00', endsAt: '2027-06-25T23:59:00+01:00' },
  ],
  ...overrides,
});

const department = (overrides: Partial<Department> = {}): Department => ({
  id: '00000000-0000-4000-8000-000000000301',
  code: 'ECE',
  name: 'Electronic and Computer Engineering',
  isActive: true,
  programmeYears: 5,
  studentCount: 6,
  courseOfferingCount: 0,
  lecturerCount: 2,
  classListCount: 62,
  recentSessions: 14,
  lastSessionAt: '2026-11-12T09:00:00.000Z',
  editable: true,
  canDeactivate: true,
  ...overrides,
});

const faculty = (overrides: Partial<Faculty> = {}): Faculty => ({
  id: '00000000-0000-4000-8000-000000000401',
  code: 'ENG',
  name: 'Faculty of Engineering',
  isActive: true,
  canAddDepartment: true,
  departments: [department()],
  ...overrides,
});

const structure = (overrides: Partial<InstitutionStructure> = {}): InstitutionStructure => ({
  permissions: { manageFaculties: true, manageSessions: true },
  faculties: [faculty()],
  academicSessions: [session()],
  recentChanges: [],
  ...overrides,
});

describe('dates', () => {
  it('counts Lagos calendar days, not 24-hour spans', () => {
    expect(daysBetween('2026-11-14T23:30:00+01:00', '2026-11-15T00:10:00+01:00')).toBe(1);
    expect(daysBetween('2026-11-15T08:00:00+01:00', '2026-11-15T22:00:00+01:00')).toBe(0);
  });

  it('says when something last happened in everyday words', () => {
    const now = at('2026-11-15T12:00:00+01:00');
    expect(whenLabel(null, now)).toBe('Never');
    expect(whenLabel('2026-11-15T08:00:00+01:00', now)).toBe('Today');
    expect(whenLabel('2026-11-14T08:00:00+01:00', now)).toBe('Yesterday');
    expect(whenLabel('2026-11-12T08:00:00+01:00', now)).toBe('Thursday');
    expect(whenLabel('2026-10-05T08:00:00+01:00', now)).toBe('5 Oct');
    expect(whenLabel('2025-10-05T08:00:00+01:00', now)).toBe('5 Oct 2025');
  });

  it('says how long ago a change was', () => {
    const now = at('2026-11-15T12:00:00+01:00');
    expect(agoLabel('2026-11-15T11:59:30+01:00', now)).toBe('Just now');
    expect(agoLabel('2026-11-15T11:20:00+01:00', now)).toBe('40 min ago');
    expect(agoLabel('2026-11-15T07:00:00+01:00', now)).toBe('5 h ago');
    expect(agoLabel('2026-11-14T07:00:00+01:00', now)).toBe('Yesterday');
    expect(agoLabel('2026-11-11T07:00:00+01:00', now)).toBe('4 days ago');
  });

  it('counts semester weeks including the part week', () => {
    expect(semesterWeeks(session().semesters[0]!)).toBe(19);
    expect(semesterWeeks({ startsAt: '2026-09-14T00:00:00+01:00', endsAt: '2026-09-14T23:59:00+01:00' })).toBe(1);
  });

  it('names the levels a programme has', () => {
    expect(levelsLabel(5)).toBe('100–500 level');
    expect(levelsLabel(1)).toBe('100 level');
  });
});

describe('todayIn', () => {
  const sessions = [session()];

  it('finds the semester and the week', () => {
    const today = todayIn(sessions, at('2026-11-15T12:00:00+01:00'));
    expect(today).toMatchObject({ kind: 'in_semester', week: 9, weeks: 19, daysLeft: 68 });
    expect(todayLine(today)).toBe('2026/2027 · First Semester, week 9 of 19');
  });

  it('counts the first day as week one', () => {
    expect(todayIn(sessions, at('2026-09-14T08:00:00+01:00'))).toMatchObject({ kind: 'in_semester', week: 1 });
  });

  it('knows the break between semesters', () => {
    const today = todayIn(sessions, at('2027-02-01T12:00:00+01:00'));
    expect(today).toMatchObject({ kind: 'between', startsIn: 14 });
    expect(todayLine(today)).toBe('2026/2027 · between semesters, Second Semester starts in 14 days');
  });

  it('knows a session that has not started or has ended', () => {
    expect(todayLine(todayIn(sessions, at('2026-09-01T12:00:00+01:00')))).toBe('2026/2027 starts in 6 days');
    expect(todayLine(todayIn(sessions, at('2027-08-02T12:00:00+01:00')))).toBe('2026/2027 ended 3 days ago');
  });

  it('says so when nothing is current', () => {
    expect(todayLine(todayIn([session({ isCurrent: false })], Date.now()))).toBe('No current academic session');
  });
});

describe('checksFor', () => {
  const now = at('2026-11-15T12:00:00+01:00');

  it('is quiet when everything is set up', () => {
    expect(checksFor(structure(), now)).toEqual([]);
  });

  it('asks for a current session first', () => {
    const checks = checksFor(structure({ academicSessions: [session({ isCurrent: false })] }), now);
    expect(checks.map((check) => check.kind)).toEqual(['no_session']);
    expect(checkText(checks[0]!).title).toBe('No current academic session');
  });

  it('asks for the next session as the current one nears its end', () => {
    const late = at('2027-06-01T12:00:00+01:00');
    const checks = checksFor(structure(), late);
    expect(checks.map((check) => check.kind)).toEqual(['next_session']);
    expect(checkText(checks[0]!).detail).toContain('ends in 59 days');
    const next = session({ id: '00000000-0000-4000-8000-000000000102', code: '2027/2028', isCurrent: false, startsAt: '2027-09-06T00:00:00+01:00', endsAt: '2028-07-28T23:59:00+01:00' });
    expect(checksFor(structure({ academicSessions: [session(), next] }), late)).toEqual([]);
  });

  it('points at the next session once the current one has ended', () => {
    const next = session({ id: '00000000-0000-4000-8000-000000000102', code: '2027/2028', isCurrent: false, startsAt: '2027-09-06T00:00:00+01:00', endsAt: '2028-07-28T23:59:00+01:00' });
    const checks = checksFor(structure({ academicSessions: [session(), next] }), at('2027-09-10T12:00:00+01:00'));
    expect(checks.map((check) => check.kind)).toEqual(['session_ended']);
    expect(checkText(checks[0]!).detail).toBe('Make 2027/2028 current so students’ levels move up.');
  });

  it('flags departments missing lecturers, a class list or recent classes', () => {
    const checks = checksFor(structure({
      faculties: [faculty({
        departments: [
          department({ id: '00000000-0000-4000-8000-000000000302', code: 'CVE', name: 'Civil Engineering', lecturerCount: 0, classListCount: 0, recentSessions: 0 }),
          department({ id: '00000000-0000-4000-8000-000000000303', code: 'CPE', name: 'Computer Engineering', recentSessions: 0, lastSessionAt: '2026-10-05T09:00:00Z' }),
          department({ id: '00000000-0000-4000-8000-000000000304', code: 'AGE', name: 'Agricultural Engineering', isActive: false, lecturerCount: 0, classListCount: 0 }),
        ],
      })],
    }), now);
    expect(checks.map(checkKey)).toEqual([
      'no_lecturers:00000000-0000-4000-8000-000000000302',
      'no_class_list:00000000-0000-4000-8000-000000000302',
      'quiet:00000000-0000-4000-8000-000000000303',
    ]);
    expect(checkText(checks[2]!).title).toBe('No classes in Computer Engineering lately');
    expect(checks.map(checkShort)).toEqual(['No lecturers', 'No class list', 'No classes in 30 days']);
  });

  it('does not call a department quiet outside teaching weeks', () => {
    const quiet = structure({ faculties: [faculty({ departments: [department({ recentSessions: 0 })] })] });
    expect(checksFor(quiet, at('2026-09-16T12:00:00+01:00'))).toEqual([]);
    expect(checksFor(quiet, at('2027-02-01T12:00:00+01:00'))).toEqual([]);
  });

  it('flags an active faculty without active departments for those who manage faculties', () => {
    const empty = faculty({ id: '00000000-0000-4000-8000-000000000402', code: 'MGT', name: 'Faculty of Management Sciences', departments: [] });
    expect(checksFor(structure({ faculties: [faculty(), empty] }), now).map((check) => check.kind)).toEqual(['empty_faculty']);
    expect(checksFor(structure({ permissions: { manageFaculties: false, manageSessions: false }, faculties: [faculty(), empty] }), now)).toEqual([]);
  });

  it('leaves session problems to those who can fix them', () => {
    expect(checksFor(structure({ permissions: { manageFaculties: false, manageSessions: false }, academicSessions: [] }), now)).toEqual([]);
  });
});

describe('counting and finding', () => {
  it('counts only what is active', () => {
    const counts = countStructure([
      faculty({ departments: [department(), department({ id: 'x', isActive: false, lecturerCount: 9 })] }),
      faculty({ id: 'y', isActive: false, departments: [department({ id: 'z' })] }),
    ]);
    expect(counts).toEqual({ faculties: 1, departments: 1, inactive: 2, lecturers: 2, classList: 62, sessions: 14 });
  });

  it('matches every word against codes and names', () => {
    const [row] = departmentRows([faculty()]);
    expect(matchesQuery(row!, 'ece')).toBe(true);
    expect(matchesQuery(row!, 'engineering computer')).toBe(true);
    expect(matchesQuery(row!, 'eng')).toBe(true);
    expect(matchesQuery(row!, 'science')).toBe(false);
  });

  it('names the target of a change, even when it is gone', () => {
    const shape = structure();
    expect(targetName({ id: 'a', targetType: 'department', targetId: department().id, action: 'x', actorName: null, at: '', summary: '' }, shape)).toBe('ECE · Electronic and Computer Engineering');
    expect(targetName({ id: 'b', targetType: 'academic_session', targetId: session().id, action: 'x', actorName: null, at: '', summary: '' }, shape)).toBe('2026/2027');
    expect(targetName({ id: 'c', targetType: 'faculty', targetId: 'gone', action: 'x', actorName: null, at: '', summary: '' }, shape)).toBe('A faculty');
  });
});

describe('the address bar', () => {
  it('reads and writes a clean view', () => {
    const view = readView(new URLSearchParams('tab=sessions&session=2026-2027'));
    expect(view).toEqual({ tab: 'sessions', show: 'all', department: null, faculty: null, session: '2026-2027' });
    expect(viewHref('/admin/structure', view)).toBe('/admin/structure?tab=sessions&session=2026-2027');
    expect(viewHref('/admin/structure', readView(null))).toBe('/admin/structure');
  });

  it('ignores anything it does not understand', () => {
    expect(readView(new URLSearchParams('tab=bogus&show=x&department=%3Cscript%3E&faculty=ENG'))).toEqual({
      tab: 'departments', show: 'all', department: null, faculty: 'eng', session: null,
    });
  });

  it('turns session codes into address-safe slugs', () => {
    expect(sessionSlug('2026/2027')).toBe('2026-2027');
  });
});

describe('new sessions', () => {
  it('suggests the year after the latest session, with the same semesters', () => {
    const draft = suggestNextSession([session({ isCurrent: false, code: '2025/2026', startsAt: '2025-09-08T00:00:00+01:00', endsAt: '2026-07-31T23:59:00+01:00', semesters: [] }), session()]);
    expect(draft).toEqual({
      code: '2027/2028',
      startsOn: '2027-09-07',
      endsOn: '2028-07-30',
      semesters: [
        { name: 'First Semester', startsOn: '2027-09-14', endsOn: '2028-01-22' },
        { name: 'Second Semester', startsOn: '2028-02-15', endsOn: '2028-06-25' },
      ],
    });
    expect(sessionProblem(draft)).toBeNull();
  });

  it('starts blank when there is nothing to follow', () => {
    expect(suggestNextSession([])).toMatchObject({ code: '', startsOn: '', semesters: [{ name: 'First Semester' }, { name: 'Second Semester' }] });
  });

  it('moves 29 February to the 28th', () => {
    const leap = session({ code: '2027/2028', startsAt: '2027-09-06T00:00:00+01:00', endsAt: '2028-02-29T12:00:00+01:00', semesters: [] });
    expect(suggestNextSession([leap]).endsOn).toBe('2029-02-28');
  });

  it('explains what is wrong with a draft, one thing at a time', () => {
    const good = { code: '2027/2028', startsOn: '2027-09-06', endsOn: '2028-07-28', semesters: [{ name: 'First Semester', startsOn: '2027-09-13', endsOn: '2028-01-21' }] };
    expect(sessionProblem(good)).toBeNull();
    expect(sessionProblem({ ...good, code: '2027' })).toBe('Write the session as two years, like 2027/2028.');
    expect(sessionProblem({ ...good, code: '2027/2029' })).toBe('The second year should follow the first, like 2027/2028.');
    expect(sessionProblem({ ...good, endsOn: '2027-09-01' })).toBe('The session must end after it starts.');
    expect(sessionProblem({ ...good, semesters: [{ ...good.semesters[0]!, startsOn: '2027-09-01' }] })).toBe('First Semester must fall within the session’s dates.');
    expect(sessionProblem({ ...good, semesters: [good.semesters[0]!, { name: 'first semester', startsOn: '2028-02-01', endsOn: '2028-06-01' }] })).toBe('Two semesters are called first semester.');
    expect(sessionProblem({ ...good, semesters: [good.semesters[0]!, { name: 'Second', startsOn: '2028-01-10', endsOn: '2028-06-01' }] })).toBe('Second must start after the semester before it ends.');
  });
});
