import { describe, expect, it } from 'vitest';
import type { ClassList, ClassListEntry, ClassListSummary } from '@lasuatos/contracts';
import {
  displayName,
  filterEntries,
  initials,
  matches,
  nextStep,
  overviewGroups,
  overviewTotals,
  percent,
  placeHref,
  placeKey,
  plainName,
  readPlace,
  reminderText,
  setOptions,
  stageCounts,
  stageFromParam,
  updatedLabel,
  whenLabel,
} from './format';

const NOW = Date.parse('2026-11-10T10:00:00Z');
const DAY = 86_400_000;
const ECE = '11111111-1111-4111-8111-111111111111';
const MCE = '22222222-2222-4222-8222-222222222222';
const CSC = '33333333-3333-4333-8333-333333333333';

const entry = (overrides: Partial<ClassListEntry>): ClassListEntry => ({
  id: crypto.randomUUID(),
  matricNumber: '220591100',
  surname: 'Adebayo',
  firstName: 'Tolulope',
  middleName: null,
  lasuEmail: null,
  entryYear: 2022,
  entryLevel: 100,
  levelLabel: '400 Level · extra year',
  departmentId: ECE,
  departmentName: 'Department of Electronic and Computer Engineering',
  stage: 'not_joined',
  userId: null,
  isRep: false,
  setupCodeUsed: false,
  addedByName: null,
  updatedAt: new Date(NOW).toISOString(),
  ...overrides,
});

const summary = (overrides: Partial<ClassListSummary>): ClassListSummary => ({
  departmentId: ECE,
  entryYear: 2022,
  setLabel: '2022/2023 set',
  total: 48,
  joined: 36,
  emailConfirmed: 30,
  ready: 22,
  updatedAt: new Date(NOW).toISOString(),
  ...overrides,
});

const params = (search: string) => new URLSearchParams(search);

describe('stages', () => {
  it('splits the cumulative counts into one number per stage', () => {
    // What the API returned for the HOC in the QA data: "Opened an account" was never 0.
    expect(stageCounts({ total: 48, joined: 36, emailConfirmed: 30, ready: 22 })).toEqual({
      not_joined: 12,
      joined: 6,
      email_confirmed: 8,
      ready: 22,
    });
  });

  it('reads the stage from the address, and anything else as everyone', () => {
    expect(stageFromParam('not-opened')).toBe('not_joined');
    expect(stageFromParam('confirmed')).toBe('email_confirmed');
    expect(stageFromParam('ready')).toBe('ready');
    expect(stageFromParam('joined')).toBe('all');
    expect(stageFromParam(null)).toBe('all');
  });

  it('rounds percentages and never divides by zero', () => {
    expect(percent(22, 48)).toBe(46);
    expect(percent(0, 0)).toBe(0);
  });

  it('says the next step in words', () => {
    expect(nextStep({ stage: 'not_joined', setupCodeUsed: false }, true)).toMatch(/open their account/);
    expect(nextStep({ stage: 'joined', setupCodeUsed: true }, true)).toMatch(/setup code/);
    expect(nextStep({ stage: 'email_confirmed', setupCodeUsed: false }, true)).toMatch(/register their face/);
    expect(nextStep({ stage: 'email_confirmed', setupCodeUsed: false }, false)).toBe('Nothing left to do.');
  });
});

describe('names and search', () => {
  it('writes the surname first in capitals, as LASU lists do', () => {
    expect(displayName(entry({ surname: 'Adebayo', firstName: 'Tolulope', middleName: 'Abraham' }))).toBe('ADEBAYO Tolulope Abraham');
    expect(plainName(entry({ surname: 'ADEBAYO', firstName: 'Tolulope' }))).toBe('Tolulope Adebayo');
    expect(initials(entry({ surname: 'okafor', firstName: 'favour' }))).toBe('OF');
  });

  it('matches name parts in any order, accents, matric numbers with spaces, and email', () => {
    const student = entry({ surname: 'Ògúnlèye', firstName: 'Kẹ́hìndé', matricNumber: '220591105', lasuEmail: 'kehinde.ogunleye@st.lasu.edu.ng' });
    expect(matches(student, 'kehinde ogunleye')).toBe(true);
    expect(matches(student, 'ogunleye kehinde')).toBe(true);
    expect(matches(student, '2205 911')).toBe(true);
    expect(matches(student, 'kehinde.ogun')).toBe(true);
    expect(matches(student, 'bello')).toBe(false);
    expect(matches(student, '  ')).toBe(true);
  });

  it('filters by stage and search together', () => {
    const list = [
      entry({ surname: 'Bello', stage: 'ready' }),
      entry({ surname: 'Bello', firstName: 'Aisha', stage: 'joined' }),
      entry({ surname: 'Okon', stage: 'ready' }),
    ];
    expect(filterEntries(list, 'ready', '')).toHaveLength(2);
    expect(filterEntries(list, 'ready', 'bello')).toHaveLength(1);
    expect(filterEntries(list, 'all', 'bello')).toHaveLength(2);
  });
});

describe('addresses', () => {
  it('reads a department code and set, ignoring anything malformed', () => {
    expect(readPlace(params('department=ECE&set=2022'))).toEqual({ department: 'ece', set: 2022 });
    expect(readPlace(params('set=all'))).toEqual({ department: null, set: 'all' });
    expect(readPlace(params('department=../x&set=22'))).toEqual({ department: null, set: null });
    expect(readPlace(null)).toEqual({ department: null, set: null });
  });

  it('writes clean addresses and one cache key per place', () => {
    expect(placeHref('/class-list', { department: 'ece', set: 2022 })).toBe('/class-list?department=ece&set=2022');
    expect(placeHref('/class-list', { department: null, set: null })).toBe('/class-list');
    expect(placeHref('/class-list', { department: 'ece', set: 2022 }, { stage: 'ready', student: null })).toBe('/class-list?department=ece&set=2022&stage=ready');
    expect(placeKey({ department: 'ece', set: 2022 })).toBe('class-list:ece:2022');
    expect(placeKey({ department: null, set: null })).toBe('class-list:-:-');
  });

  it('offers the last eight sets, newest first', () => {
    const options = setOptions(NOW);
    expect(options).toHaveLength(8);
    expect(options[0]).toEqual({ value: '2026', label: '2026/2027 set' });
    expect(options[7]!.value).toBe('2019');
  });
});

describe('overview', () => {
  const departments: ClassList['departments'] = [
    { id: ECE, code: 'ECE', name: 'Department of Electronic and Computer Engineering', facultyName: 'Faculty of Engineering' },
    { id: MCE, code: 'MCE', name: 'Department of Mechanical Engineering', facultyName: 'Faculty of Engineering' },
    { id: CSC, code: 'CSC', name: 'Department of Computer Science', facultyName: 'Faculty of Science' },
  ];

  it('groups lists by faculty, newest set first, with departments without a list last', () => {
    const groups = overviewGroups({
      departments,
      fixedDepartmentId: null,
      lists: [summary({ entryYear: 2022 }), summary({ entryYear: 2023, setLabel: '2023/2024 set', total: 20 })],
    });
    expect(groups.map((group) => group.title)).toEqual(['Faculty of Engineering', 'Faculty of Science']);
    const engineering = groups[0]!.rows;
    expect(engineering.map((row) => [row.code, row.summary?.entryYear ?? null])).toEqual([['ECE', 2023], ['ECE', 2022], ['MCE', null]]);
    expect(engineering[0]!.subtitle).toBe('2023/2024 set · 20 students');
    expect(groups[1]!.rows[0]).toMatchObject({ code: 'CSC', subtitle: 'No list yet', summary: null });
  });

  it('inside one department, lists its sets by name', () => {
    const groups = overviewGroups({ departments: [departments[0]!], fixedDepartmentId: ECE, lists: [summary({ total: 1 })] });
    expect(groups).toHaveLength(1);
    expect(groups[0]!.title).toBe('Electronic and Computer Engineering');
    expect(groups[0]!.rows[0]).toMatchObject({ title: '2022/2023 set', subtitle: '1 student' });
  });

  it('adds up every list', () => {
    expect(overviewTotals([summary({}), summary({ total: 18, joined: 10, emailConfirmed: 5, ready: 2 })])).toEqual({ students: 66, ready: 24, notOpened: 20, lists: 2 });
  });
});

describe('the reminder', () => {
  const list = [
    entry({ surname: 'Bello', firstName: 'Aisha', matricNumber: '220591101', stage: 'not_joined' }),
    entry({ surname: 'Okon', firstName: 'Emeka', matricNumber: '220591102', stage: 'joined' }),
    entry({ surname: 'Ade', firstName: 'Bisi', matricNumber: '220591103', stage: 'email_confirmed' }),
    entry({ surname: 'Lawal', firstName: 'Uche', matricNumber: '220591104', stage: 'ready' }),
  ];

  it('says what to do, then who still has each step', () => {
    const text = reminderText(list, true, 'https://lasuatos.vercel.app');
    expect(text).toContain('https://lasuatos.vercel.app/sign-up');
    expect(text).toContain('Still to open their account (1):\nBELLO Aisha (220591101)');
    expect(text).toContain('Still to confirm their LASU email (1):\nOKON Emeka (220591102)');
    expect(text).toContain('Still to register their face (1):\nADE Bisi (220591103)');
    expect(text).not.toContain('LAWAL');
  });

  it('leaves out the face step when faces are not required', () => {
    const text = reminderText(list, false, 'https://x.test');
    expect(text).not.toContain('register their face');
    expect(text).not.toContain('ADE Bisi');
  });

  it('caps the names and counts the rest', () => {
    const many = Array.from({ length: 45 }, (_unused, index) => entry({ surname: `S${index}`, matricNumber: String(220591100 + index) }));
    const text = reminderText(many, true, 'https://x.test', 40);
    expect(text).toContain('Still to open their account (45):');
    expect(text).toContain('and 5 more');
    expect(text.split('\n').filter((line) => /^S\d+ /.test(line))).toHaveLength(40);
  });
});

describe('times', () => {
  it('labels events in Lagos time', () => {
    expect(whenLabel('2026-11-10T08:12:00Z', NOW)).toBe('Today, 09:12');
    expect(whenLabel('2026-11-09T17:20:00Z', NOW)).toBe('Yesterday, 18:20');
    expect(whenLabel('2026-10-12T10:00:00Z', NOW)).toBe('12 Oct');
  });

  it('says how fresh a list is', () => {
    expect(updatedLabel(new Date(NOW).toISOString(), NOW)).toBe('today');
    expect(updatedLabel(new Date(NOW - DAY).toISOString(), NOW)).toBe('yesterday');
    expect(updatedLabel(new Date(NOW - 3 * DAY).toISOString(), NOW)).toBe('3 days ago');
    expect(updatedLabel('2026-10-05T10:00:00Z', NOW)).toBe('5 Oct');
  });
});
