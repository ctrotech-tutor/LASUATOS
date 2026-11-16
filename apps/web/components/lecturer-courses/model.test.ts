import { describe, expect, it } from 'vitest';
import {
  codeState,
  defaultSemester,
  formatJoinCode,
  groupOfferings,
  inviteText,
  joinLink,
  phaseOf,
  rowFacts,
  suggestedLevel,
  summaryLine,
  withUpdated,
  type Offering,
} from './model';

const NOW = Date.parse('2026-11-10T09:00:00Z');

function offering(overrides: Partial<Offering> = {}): Offering {
  return {
    courseOfferingId: '00000000-0000-4000-8000-000000000001',
    courseCode: 'ECE 305',
    courseTitle: 'Digital Electronics',
    creditUnits: 3,
    level: '300',
    semesterName: '2026/2027 First Semester',
    semesterStartsAt: '2026-10-01T00:00:00Z',
    semesterEndsAt: '2027-02-28T00:00:00Z',
    departmentName: 'Electronic and Computer Engineering',
    joinCodeActive: false,
    joinCodeIssuedAt: null,
    students: 0,
    sessions: 0,
    openDisputes: 0,
    canEditCourse: false,
    ...overrides,
  } as Offering;
}

describe('phaseOf and codeState', () => {
  it('tells running, upcoming and ended semesters apart', () => {
    expect(phaseOf(offering(), NOW)).toBe('current');
    expect(phaseOf(offering({ semesterStartsAt: '2027-03-01T00:00:00Z', semesterEndsAt: '2027-07-01T00:00:00Z' }), NOW)).toBe('upcoming');
    expect(phaseOf(offering({ semesterStartsAt: '2026-03-01T00:00:00Z', semesterEndsAt: '2026-07-01T00:00:00Z' }), NOW)).toBe('ended');
  });

  it('closes joining once the semester ends, whatever the code says', () => {
    expect(codeState(offering({ joinCodeActive: true }), NOW)).toBe('on');
    expect(codeState(offering(), NOW)).toBe('off');
    expect(codeState(offering({ joinCodeActive: true, semesterEndsAt: '2026-11-01T00:00:00Z' }), NOW)).toBe('closed');
  });
});

describe('groupOfferings', () => {
  it('puts this semester first, then upcoming, then earlier semesters, each sorted by code', () => {
    const groups = groupOfferings([
      offering({ courseOfferingId: 'a', courseCode: 'ECE 311' }),
      offering({ courseOfferingId: 'b', courseCode: 'ECE 305' }),
      offering({ courseOfferingId: 'c', courseCode: 'GET 201', semesterName: 'Second', semesterStartsAt: '2027-03-01T00:00:00Z', semesterEndsAt: '2027-07-01T00:00:00Z' }),
      offering({ courseOfferingId: 'd', courseCode: 'ECE 201', semesterName: 'Old', semesterStartsAt: '2026-03-01T00:00:00Z', semesterEndsAt: '2026-07-01T00:00:00Z' }),
    ], NOW);
    expect(groups.map((group) => group.phase)).toEqual(['current', 'upcoming', 'ended']);
    expect(groups[0]!.offerings.map((item) => item.courseCode)).toEqual(['ECE 305', 'ECE 311']);
    expect(groups[0]!.aside).toBe('Ends 28 Feb 2027');
    expect(groups[1]!.aside).toBe('Starts 1 Mar 2027');
    expect(groups[2]!.title).toBe('Earlier semesters');
  });

  it('returns nothing for no courses', () => {
    expect(groupOfferings([], NOW)).toEqual([]);
  });
});

describe('summaryLine and rowFacts', () => {
  it('counts this semester’s courses and students', () => {
    expect(summaryLine([offering({ students: 40 }), offering({ courseOfferingId: 'x', students: 1 })], NOW)).toBe('2 courses this semester · 41 students');
    expect(summaryLine([offering({ semesterEndsAt: '2026-11-01T00:00:00Z' })], NOW)).toBe('No courses this semester yet');
    expect(summaryLine([], NOW)).toBeNull();
  });

  it('leaves classes out until one is held', () => {
    expect(rowFacts(offering({ students: 1 }))).toBe('300 level · 1 student');
    expect(rowFacts(offering({ students: 1240, sessions: 1 }))).toBe('300 level · 1,240 students · 1 class');
  });
});

describe('join codes', () => {
  it('groups the code in fours, as students type it', () => {
    expect(formatJoinCode('7K9MPQ2R4XBD')).toBe('7K9M-PQ2R-4XBD');
  });

  it('shares a link that fills the code in, then the code', () => {
    const link = joinLink('https://lasuatos.vercel.app', '7K9MPQ2R4XBD');
    expect(link).toBe('https://lasuatos.vercel.app/courses?code=7K9M-PQ2R-4XBD');
    const text = inviteText(offering(), '7K9MPQ2R4XBD', link);
    expect(text).toContain('Join ECE 305 (Digital Electronics)');
    expect(text).toContain(link);
    expect(text).toContain('7K9M-PQ2R-4XBD');
    expect(text).toContain('28 February 2027');
  });
});

describe('suggestedLevel and defaultSemester', () => {
  it('prefers the course list’s level, else reads it from the code', () => {
    expect(suggestedLevel('ECE 305')).toBe('300');
    expect(suggestedLevel('ECE 305', 400)).toBe('400');
    expect(suggestedLevel('GST 0')).toBeNull();
  });

  it('picks the running semester, else the next', () => {
    const running = { id: 'r', name: 'Now', startsAt: '2026-10-01T00:00:00Z', endsAt: '2027-02-28T00:00:00Z' };
    const next = { id: 'n', name: 'Next', startsAt: '2027-03-01T00:00:00Z', endsAt: '2027-07-01T00:00:00Z' };
    expect(defaultSemester([next, running] as never, NOW)?.id).toBe('r');
    expect(defaultSemester([next] as never, NOW)?.id).toBe('n');
    expect(defaultSemester([], NOW)).toBeNull();
  });
});

describe('withUpdated', () => {
  it('carries a new title and units to every offering of the code, the level only to its own', () => {
    const a = offering({ courseOfferingId: 'a' });
    const b = offering({ courseOfferingId: 'b', level: '400' });
    const c = offering({ courseOfferingId: 'c', courseCode: 'ECE 311' });
    const next = withUpdated([a, b, c], { ...a, courseTitle: 'Digital Electronics I', creditUnits: 2, level: '200' });
    expect(next.map((item) => [item.courseTitle, item.creditUnits, item.level])).toEqual([
      ['Digital Electronics I', 2, '200'],
      ['Digital Electronics I', 2, '400'],
      ['Digital Electronics', 3, '300'],
    ]);
  });
});
