import type { RetentionRunSummary, RetentionSet, RetentionStudent } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import {
  classListHref, countByStatus, filterStudents, findSet, foldRuns, groupSets, keptUntil, nextRun, readView, relativeDay, runResult, setSlug, setStatus,
  setTimeline, setTitle, studentLine, viewHref,
} from './format';

const DEPT = '5f1d1c1e-0000-4000-8000-000000000001';

function set(overrides: Partial<RetentionSet> = {}): RetentionSet {
  return {
    departmentId: DEPT,
    departmentCode: 'ECE',
    departmentName: 'Electronic and Computer Engineering',
    entryYear: 2019,
    setLabel: '2019/2020 set',
    programmeYears: 5,
    finishedOn: '2024-09-01',
    dueOn: '2025-09-01',
    students: 8,
    faces: 6,
    dueFaces: 4,
    keptActive: 2,
    ...overrides,
  };
}

const policy = { graceMonths: 12, activeWithinDays: 180, checkPhotoDays: 90 };
const TODAY = '2026-11-16';

describe('the address', () => {
  it('reads and writes the view, ignoring nonsense', () => {
    const params = new URLSearchParams('show=due&set=ECE-2019&q=mech');
    expect(readView(params)).toEqual({ show: 'due', set: 'ECE-2019', q: 'mech' });
    expect(readView(new URLSearchParams('show=bogus&set=<script>'))).toEqual({ show: 'all', set: null, q: '' });
    expect(viewHref('/admin/retention', { show: 'coming', set: 'CSC-2022', q: ' x ' })).toBe('/admin/retention?show=coming&q=x&set=CSC-2022');
    expect(viewHref('/admin/retention', { show: 'all', set: null, q: '' })).toBe('/admin/retention');
  });

  it('finds a set by its code and year, in any case', () => {
    const sets = [set(), set({ departmentCode: 'CSC', entryYear: 2021 })];
    expect(setSlug(sets[1]!)).toBe('CSC-2021');
    expect(findSet(sets, 'csc-2021')).toBe(sets[1]);
    expect(findSet(sets, 'MEE-2019')).toBeNull();
  });
});

describe('where a set stands', () => {
  it('sorts sets into due, kept, coming and cleared', () => {
    expect(setStatus(set(), TODAY)).toBe('due');
    expect(setStatus(set({ dueFaces: 0, faces: 2, keptActive: 2 }), TODAY)).toBe('kept');
    expect(setStatus(set({ faces: 0, dueFaces: 0, keptActive: 0 }), TODAY)).toBe('cleared');
    expect(setStatus(set({ dueOn: '2027-09-01' }), TODAY)).toBe('coming');
    // Due on the day itself.
    expect(setStatus(set({ dueOn: TODAY }), TODAY)).toBe('due');
  });

  it('groups in a fixed order, soonest first, cleared newest first, and filters', () => {
    const sets = [
      set({ departmentCode: 'MEE', entryYear: 2018, dueOn: '2024-09-01', faces: 0, dueFaces: 0, keptActive: 0 }),
      set({ departmentCode: 'MEE', entryYear: 2019, faces: 0, dueFaces: 0, keptActive: 0 }),
      set({ departmentCode: 'CSC', entryYear: 2022, dueOn: '2027-09-01' }),
      set({ departmentCode: 'ECE', entryYear: 2022, dueOn: '2028-09-01' }),
      set(),
    ];
    const groups = groupSets(sets, TODAY, { show: 'all', q: '' });
    expect(groups.map((group) => group.status)).toEqual(['due', 'coming', 'cleared']);
    expect(groups[1]!.sets.map(setSlug)).toEqual(['CSC-2022', 'ECE-2022']);
    expect(groups[2]!.sets.map(setSlug)).toEqual(['MEE-2019', 'MEE-2018']);
    expect(groupSets(sets, TODAY, { show: 'coming', q: '' }).map((group) => group.status)).toEqual(['coming']);
    expect(groupSets(sets, TODAY, { show: 'all', q: 'computer 2022' })[0]!.sets.map(setSlug)).toEqual(['CSC-2022', 'ECE-2022']);
    expect(countByStatus(sets, TODAY)).toEqual({ all: 5, due: 1, kept: 0, coming: 2, cleared: 2 });
  });

  it('names sets and links to their class list', () => {
    expect(setTitle(set())).toBe('ECE 2019/2020');
    expect(classListHref(set())).toBe('/class-list?department=ece&set=2019');
    expect(classListHref(set(), '190211001')).toBe('/class-list?department=ece&set=2019&student=190211001');
  });

  it('places today on the timeline: programme first half, grace second', () => {
    expect(setTimeline(set(), TODAY).today).toBe(1);
    expect(setTimeline(set({ finishedOn: '2026-09-01', dueOn: '2027-09-01' }), '2026-09-01').today).toBe(0.5);
    const during = setTimeline(set({ entryYear: 2022, finishedOn: '2027-09-01', dueOn: '2028-09-01' }), TODAY).today;
    expect(during).toBeGreaterThan(0.4);
    expect(during).toBeLessThan(0.5);
  });
});

describe('dates and runs', () => {
  it('says how far away a date is', () => {
    expect(relativeDay('2026-11-16', TODAY)).toBe('today');
    expect(relativeDay('2026-11-17', TODAY)).toBe('tomorrow');
    expect(relativeDay('2027-09-01', TODAY)).toBe('in 9 months');
    expect(relativeDay('2026-11-30', TODAY)).toBe('in 2 weeks');
    expect(relativeDay('2025-09-01', TODAY)).toBe('14 months ago');
    expect(relativeDay('2029-09-01', TODAY)).toBe('in 3 years');
  });

  it('finds the next nightly run (02:30 UTC, 3:30 am in Lagos)', () => {
    const evening = Date.parse('2026-11-16T19:00:00Z');
    expect(nextRun(evening)).toEqual({ at: '2026-11-17T02:30:00.000Z', phrase: 'tonight at 3:30 am' });
    const smallHours = Date.parse('2026-11-17T00:30:00Z');
    expect(nextRun(smallHours)).toEqual({ at: '2026-11-17T02:30:00.000Z', phrase: 'today at 3:30 am' });
  });

  it('works out when a kept face goes', () => {
    expect(keptUntil('2026-11-04T10:00:00.000Z', policy)).toBe('2027-05-03');
  });

  it('describes a run and folds quiet nightly runs together', () => {
    const run = (at: string, faces = 0, photos = 0, scheduled = true): RetentionRunSummary => ({ at, actorName: scheduled ? null : 'Adebayo', scheduled, facesDeleted: faces, checkPhotosDeleted: photos });
    expect(runResult(run('x', 3, 1))).toBe('3 faces and 1 check-in photo deleted');
    expect(runResult(run('x'))).toBe('Nothing was due');
    const rows = foldRuns([
      run('2026-11-13T02:30:00Z'), run('2026-11-12T02:30:00Z'), run('2026-11-11T02:30:00Z', 0, 1),
      run('2026-11-10T02:30:00Z'), run('2026-10-16T05:22:00Z', 0, 0, false),
    ]);
    expect(rows.map((row) => row.kind)).toEqual(['quiet', 'run', 'run', 'run']);
    expect(rows[0]).toMatchObject({ count: 2, from: '2026-11-12T02:30:00Z', to: '2026-11-13T02:30:00Z' });
  });
});

describe('students', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const student = (overrides: Partial<RetentionStudent>): RetentionStudent => ({
    matricNumber: '190211001', name: 'Chioma Okafor', hasAccount: true, state: 'due', faceRegisteredAt: '2020-02-11T10:00:00.000Z', lastCheckInAt: null, checkPhotos: 0, ...overrides,
  });

  it('explains each state in a line', () => {
    expect(studentLine(student({}), policy, now)).toBe('Never checked in');
    expect(studentLine(student({ state: 'keeping', lastCheckInAt: '2026-11-04T10:00:00.000Z' }), policy, now)).toBe('Checked in 12 days ago · kept until 3 May 2027 without another');
    expect(studentLine(student({ state: 'waiting' }), policy, now)).toBe('Face registered Feb 2020 · never checked in');
    expect(studentLine(student({ state: 'no_face', hasAccount: false, faceRegisteredAt: null }), policy, now)).toBe('Has not opened an account');
  });

  it('filters by state and search, due first', () => {
    const list = [
      student({ name: 'Bola Eze', matricNumber: '1', state: 'no_face' }),
      student({ name: 'Ada Obi', matricNumber: '2', state: 'keeping' }),
      student({ name: 'Zara Musa', matricNumber: '3', state: 'due' }),
    ];
    expect(filterStudents(list, 'all', '').map((item) => item.matricNumber)).toEqual(['3', '2', '1']);
    expect(filterStudents(list, 'keeping', '').map((item) => item.matricNumber)).toEqual(['2']);
    expect(filterStudents(list, 'all', 'eze').map((item) => item.matricNumber)).toEqual(['1']);
  });
});
