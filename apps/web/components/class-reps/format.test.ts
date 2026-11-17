import type { ClassRep, ClassRepList } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import {
  activityLine,
  appointedLine,
  buildPosts,
  canAppointTo,
  classListHref,
  countPosts,
  filterPosts,
  groupPosts,
  isQuiet,
  listLine,
  postMatches,
  postOf,
  readView,
  setChoices,
  setsInUse,
  viewHref,
} from './format';

const NOW = Date.parse('2026-11-10T12:00:00Z');
const DAY = 86_400_000;
const ENG = '00000000-0000-4000-8000-000000000001';
const SCI = '00000000-0000-4000-8000-000000000002';
const ECE = '00000000-0000-4000-8000-000000000011';
const MCE = '00000000-0000-4000-8000-000000000012';
const CSC = '00000000-0000-4000-8000-000000000021';

const departments = [
  { id: ECE, code: 'ECE', name: 'Department of Electronic and Computer Engineering', facultyId: ENG, facultyName: 'Faculty of Engineering' },
  { id: MCE, code: 'MCE', name: 'Department of Mechanical Engineering', facultyId: ENG, facultyName: 'Faculty of Engineering' },
  { id: CSC, code: 'CSC', name: 'Department of Computer Science', facultyId: SCI, facultyName: 'Faculty of Science' },
];
const faculties = [{ id: ENG, name: 'Faculty of Engineering' }, { id: SCI, name: 'Faculty of Science' }];

let next = 100;
function rep(overrides: Partial<ClassRep> = {}): ClassRep {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-000000000${next}`,
    role: 'hoc',
    studentUserId: `00000000-0000-4000-9000-000000000${next}`,
    studentName: 'Uche Lawal',
    matricNumber: '220591105',
    email: 'u.lawal@st.lasu.edu.ng',
    facultyId: ENG,
    facultyName: 'Faculty of Engineering',
    departmentId: ECE,
    departmentName: 'Department of Electronic and Computer Engineering',
    entryYear: 2022,
    setLabel: '2022/2023 set',
    appointedAt: new Date(NOW - 40 * DAY).toISOString(),
    appointedByName: 'Admin',
    recentSessions: 3,
    lastSessionAt: new Date(NOW - 2 * DAY).toISOString(),
    assistantOf: null,
    permissions: [],
    ...overrides,
  };
}

function list(overrides: Partial<ClassRepList> = {}): ClassRepList {
  return { reps: [], departments, lists: [], faculties, fixedEntryYear: null, ...overrides };
}

describe('buildPosts', () => {
  it('opens a HOC post for every department of a faculty once a set is in use there, and a GHOC post', () => {
    const uche = rep();
    const posts = buildPosts(list({ reps: [uche], lists: [{ departmentId: ECE, entryYear: 2022, students: 48, withAccounts: 36 }] }));
    expect(posts.map((post) => [post.role, post.departmentCode, post.entryYear, post.holders.length])).toEqual([
      ['ghoc', '', 2022, 0],
      ['hoc', 'ECE', 2022, 1],
      ['hoc', 'MCE', 2022, 0],
    ]);
    expect(posts[1]!.list).toMatchObject({ students: 48 });
    expect(posts.every((post) => post.canAppoint)).toBe(true);
  });

  it('starts a set from a class list alone, newest set first, and keeps faculties apart', () => {
    const posts = buildPosts(list({ lists: [
      { departmentId: CSC, entryYear: 2023, students: 10, withAccounts: 2 },
      { departmentId: MCE, entryYear: 2024, students: 5, withAccounts: 0 },
    ] }));
    expect(posts.map((post) => `${post.entryYear}:${post.role}:${post.departmentCode}`)).toEqual([
      '2024:ghoc:', '2024:hoc:ECE', '2024:hoc:MCE', '2023:ghoc:', '2023:hoc:CSC',
    ]);
  });

  it('gives a GHOC their own set in every department, with no GHOC post', () => {
    const posts = buildPosts(list({ departments: departments.slice(0, 2), faculties: [], fixedEntryYear: 2022 }));
    expect(posts.map((post) => `${post.role}:${post.departmentCode}:${post.entryYear}`)).toEqual(['hoc:ECE:2022', 'hoc:MCE:2022']);
    expect(posts.every((post) => post.canAppoint)).toBe(true);
  });

  it('shows a GHOC post someone holds even when the viewer cannot appoint GHOCs', () => {
    const ghoc = rep({ role: 'ghoc', departmentId: null, departmentName: null, studentName: 'Favour Okafor' });
    const posts = buildPosts(list({ reps: [ghoc], faculties: [] }));
    expect(posts[0]).toMatchObject({ role: 'ghoc', canAppoint: false });
    expect(posts[0]!.holders).toHaveLength(1);
  });

  it('puts two reps of one post together', () => {
    const posts = buildPosts(list({ reps: [rep(), rep({ studentName: 'Ada Obi' })] }));
    expect(posts.find((post) => post.departmentCode === 'ECE')!.holders.map((holder) => holder.studentName)).toEqual(['Uche Lawal', 'Ada Obi']);
  });

  it('keeps a rep whose department is outside the viewer’s list', () => {
    const outside = rep({ departmentId: '00000000-0000-4000-8000-000000000099', departmentName: 'Department of Physics' });
    const posts = buildPosts(list({ reps: [outside], departments: departments.slice(0, 1) }));
    expect(posts.some((post) => post.departmentName === 'Department of Physics' && post.holders.length === 1 && !post.canAppoint)).toBe(true);
  });
});

describe('groupPosts', () => {
  it('names the faculty only when there are several', () => {
    const many = groupPosts(buildPosts(list({ reps: [rep()], lists: [{ departmentId: CSC, entryYear: 2022, students: 1, withAccounts: 0 }] })));
    expect(many.map((group) => group.title)).toEqual(['2022/2023 set · Engineering', '2022/2023 set · Science']);
    const one = groupPosts(buildPosts(list({ departments: departments.slice(0, 2), faculties: [], fixedEntryYear: 2022 })));
    expect(one.map((group) => group.title)).toEqual(['2022/2023 set']);
  });
});

describe('activity', () => {
  it('counts a rep as quiet after a settling week with no sessions', () => {
    expect(isQuiet(rep({ recentSessions: 0, appointedAt: new Date(NOW - 3 * DAY).toISOString() }), NOW)).toBe(false);
    expect(isQuiet(rep({ recentSessions: 0, appointedAt: new Date(NOW - 8 * DAY).toISOString() }), NOW)).toBe(true);
    expect(isQuiet(rep({ recentSessions: 1 }), NOW)).toBe(false);
  });

  it('says what a rep has done lately', () => {
    expect(activityLine(rep({ recentSessions: 1 }), NOW)).toEqual({ text: '1 session in 30 days', tone: 'good' });
    expect(activityLine(rep({ recentSessions: 0, lastSessionAt: '2026-10-02T10:00:00Z' }), NOW)).toEqual({ text: 'None since 2 Oct', tone: 'warning' });
    expect(activityLine(rep({ recentSessions: 0, lastSessionAt: null }), NOW)).toEqual({ text: 'No sessions yet', tone: 'warning' });
    expect(activityLine(rep({ recentSessions: 0, lastSessionAt: null, appointedAt: new Date(NOW - DAY).toISOString() }), NOW)).toEqual({ text: 'New, no sessions yet', tone: 'none' });
  });

  it('describes an open post’s list', () => {
    expect(listLine({ role: 'hoc', list: { departmentId: ECE, entryYear: 2022, students: 1200, withAccounts: 30 } })).toBe('1,200 on the list · 30 with accounts');
    expect(listLine({ role: 'hoc', list: null })).toBe('No class list yet');
    expect(listLine({ role: 'ghoc', list: null })).toBe('Covers every department in the set');
  });
});

describe('filters and counts', () => {
  const quiet = rep({ studentName: 'Bola Ade', matricNumber: '220592101', email: 'b.ade@st.lasu.edu.ng', departmentId: MCE, departmentName: 'Department of Mechanical Engineering', recentSessions: 0, lastSessionAt: null });
  const posts = buildPosts(list({ reps: [rep(), quiet] }));

  it('counts reps, open posts, activity and quiet reps', () => {
    expect(countPosts(posts, NOW)).toEqual({ reps: 2, hocs: 2, ghocs: 0, open: 1, active: 1, quiet: 1 });
  });

  it('filters by what to show, set and typed words', () => {
    expect(filterPosts(posts, { set: null, show: 'open' }, '', NOW).map((post) => post.role)).toEqual(['ghoc']);
    expect(filterPosts(posts, { set: null, show: 'quiet' }, '', NOW).map((post) => post.departmentCode)).toEqual(['MCE']);
    expect(filterPosts(posts, { set: 2023, show: 'all' }, '', NOW)).toEqual([]);
    expect(filterPosts(posts, { set: null, show: 'all' }, 'lawal', NOW).map((post) => post.departmentCode)).toEqual(['ECE']);
  });

  it('matches matric numbers, codes, sets and open posts', () => {
    const ece = posts.find((post) => post.departmentCode === 'ECE')!;
    expect(postMatches(ece, '220591105')).toBe(true);
    expect(postMatches(ece, 'ece 2022')).toBe(true);
    expect(postMatches(ece, 'hoc electronic')).toBe(true);
    expect(postMatches(ece, 'mechanical')).toBe(false);
    expect(postMatches(posts[0]!, 'vacant')).toBe(true);
  });

  it('lists sets in use and sets to appoint for', () => {
    expect(setsInUse(posts)).toEqual([2022]);
    expect(setChoices(posts, NOW)).toEqual([2026, 2025, 2024, 2023, 2022, 2021, 2020, 2019]);
    expect(setChoices(buildPosts(list({ reps: [rep({ entryYear: 2015, setLabel: '2015/2016 set' })] })), NOW).at(-1)).toBe(2015);
  });
});

describe('addresses and lines', () => {
  it('reads and writes the view', () => {
    const params = new URLSearchParams('set=2022&show=open');
    expect(readView(params)).toEqual({ set: 2022, show: 'open' });
    expect(readView(new URLSearchParams('set=22&show=everyone'))).toEqual({ set: null, show: 'all' });
    expect(viewHref('/class-reps', { set: 2022, show: 'quiet' })).toBe('/class-reps?set=2022&show=quiet');
    expect(viewHref('/class-reps', { set: null, show: 'all' })).toBe('/class-reps');
  });

  it('links a post to its class list', () => {
    const data = list({ reps: [rep()] });
    const post = postOf(data.reps[0]!, data);
    expect(classListHref(post)).toBe('/class-list?department=ece&set=2022');
    expect(classListHref({ role: 'ghoc', departmentCode: '', entryYear: 2023 })).toBe('/class-list?set=2023');
  });

  it('describes an appointment', () => {
    expect(appointedLine(rep())).toBe('Electronic and Computer Engineering, 2022/2023 set.');
    expect(appointedLine(rep({ role: 'ghoc', departmentName: null }))).toBe('Faculty of Engineering, 2022/2023 set.');
  });

  it('checks who may appoint where', () => {
    expect(canAppointTo(list(), 'hoc', ECE, 2020)).toBe(true);
    expect(canAppointTo(list({ fixedEntryYear: 2022 }), 'hoc', ECE, 2023)).toBe(false);
    expect(canAppointTo(list({ faculties: [] }), 'ghoc', ENG, 2022)).toBe(false);
    expect(canAppointTo(list(), 'hoc', null, 2022)).toBe(false);
  });
});

describe('assistants in the list', () => {
  it('keeps assistants out of the holders, with the post they help', () => {
    const hoc = rep({ studentName: 'ADEYEMI Tola' });
    const ahoc = rep({ studentName: 'BELLO Sade', assistantOf: { id: hoc.id, name: hoc.studentName }, permissions: ['registers'] });
    const data: ClassRepList = { reps: [hoc, ahoc], departments, lists: [], faculties, fixedEntryYear: null };
    const posts = buildPosts(data);
    const post = posts.find((item) => item.holders.some((holder) => holder.id === hoc.id))!;
    expect(post.holders.map((item) => item.id)).toEqual([hoc.id]);
    expect(post.assistants.map((item) => item.id)).toEqual([ahoc.id]);
    expect(countPosts(posts, NOW).reps).toBe(1);
    expect(postMatches(post, 'bello')).toBe(true);
    expect(postOf(ahoc, data).holders.map((item) => item.id)).toEqual([hoc.id]);
  });
});
