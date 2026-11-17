import { describe, expect, it } from 'vitest';
import {
  classesLabel, dayLabel, daysBetween, disputeChip, evidenceChips, percent, studentsLabel,
  updatedLabel, visibleOfferings, waitLabel, type Offering,
} from './model';

const NOW = '2026-11-16T20:51:00.000Z';
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function offering(n: number, overrides: Partial<Offering> = {}): Offering {
  return {
    courseOfferingId: ID(n),
    courseCode: `ECE ${300 + n}`,
    courseTitle: `Course ${n}`,
    departmentName: 'Electronic and Computer Engineering',
    semesterLabel: '2026/2027 First semester',
    sessionsHeld: 4,
    activeEnrollments: 10,
    completedEnrollments: 0,
    expectedCheckIns: 40,
    presentCheckIns: 30,
    inconclusiveCheckIns: 0,
    manualCheckIns: 0,
    revokedCheckIns: 0,
    rate: 75,
    lastSessionAt: '2026-11-10T09:00:00.000Z',
    openDisputes: 0,
    oldestOpenDisputeAt: null,
    ...overrides,
  };
}

describe('visibleOfferings', () => {
  const list = [
    offering(1, { rate: 82, sessionsHeld: 13 }),
    offering(2, { rate: 54, courseCode: 'MEE 311', departmentName: 'Mechanical Engineering', lastSessionAt: '2026-11-11T09:00:00.000Z' }),
    offering(3, { rate: null, sessionsHeld: 0, expectedCheckIns: 0, presentCheckIns: 0, lastSessionAt: null }),
    offering(4, { rate: 77, openDisputes: 1, oldestOpenDisputeAt: '2026-11-14T10:00:00.000Z', lastSessionAt: '2026-11-13T09:00:00.000Z' }),
    offering(5, { rate: 90, openDisputes: 1, oldestOpenDisputeAt: '2026-11-09T10:00:00.000Z' }),
  ];

  it('hides courses with no classes and puts the lowest rate first', () => {
    expect(visibleOfferings(list).map((row) => row.courseCode)).toEqual(['MEE 311', 'ECE 304', 'ECE 301', 'ECE 305']);
  });

  it('can include courses with no classes, which sort last by rate', () => {
    expect(visibleOfferings(list, { includeEmpty: true }).at(-1)?.courseCode).toBe('ECE 303');
  });

  it('sorts by most open disputes, longest waiting first', () => {
    expect(visibleOfferings(list, { sort: 'disputes' }).slice(0, 2).map((row) => row.courseCode)).toEqual(['ECE 305', 'ECE 304']);
  });

  it('sorts by the most recent class and by code (numbers in order)', () => {
    expect(visibleOfferings(list, { sort: 'recent' })[0]?.courseCode).toBe('ECE 304');
    const codes = [offering(1, { courseCode: 'ECE 1001' }), offering(2, { courseCode: 'ECE 201' })];
    expect(visibleOfferings(codes, { sort: 'code' }).map((row) => row.courseCode)).toEqual(['ECE 201', 'ECE 1001']);
  });

  it('searches code, title and department, ignoring case and spaces', () => {
    expect(visibleOfferings(list, { query: 'mee311' }).map((row) => row.courseCode)).toEqual(['MEE 311']);
    expect(visibleOfferings(list, { query: 'mechanical' })).toHaveLength(1);
    expect(visibleOfferings(list, { query: 'course 4' }).map((row) => row.courseCode)).toEqual(['ECE 304']);
    expect(visibleOfferings(list, { query: 'nothing like it' })).toEqual([]);
  });

  it('does not change the list it was given', () => {
    const before = list.map((row) => row.courseCode);
    visibleOfferings(list, { sort: 'code' });
    expect(list.map((row) => row.courseCode)).toEqual(before);
  });
});

describe('labels', () => {
  it('rounds the rate and shows a dash when nothing is expected', () => {
    expect(percent(78.7)).toBe('79%');
    expect(percent(null)).toBe('–');
  });

  it('says how long the oldest dispute has waited', () => {
    expect(daysBetween('2026-11-20T00:00:00.000Z', NOW)).toBe(0);
    expect(waitLabel(null, NOW)).toBe('None waiting');
    expect(waitLabel('2026-11-16T08:00:00.000Z', NOW)).toBe('Oldest raised today');
    expect(waitLabel('2026-11-15T08:00:00.000Z', NOW)).toBe('Oldest waiting 1 day');
    expect(waitLabel('2026-11-09T08:00:00.000Z', NOW)).toBe('Oldest waiting 7 days');
  });

  it('names who the rate covers, including students who completed the course', () => {
    expect(studentsLabel(offering(1))).toBe('10 enrolled');
    expect(studentsLabel(offering(1, { activeEnrollments: 0, completedEnrollments: 39 }))).toBe('39 completed');
    expect(studentsLabel(offering(1, { completedEnrollments: 3 }))).toBe('10 enrolled · 3 completed');
    expect(studentsLabel(offering(1, { activeEnrollments: 0 }))).toBe('No students');
  });

  it('dates the last class, with the year only when it is another year', () => {
    expect(dayLabel('2026-11-16T09:00:00.000Z', NOW)).toBe('16 Nov');
    expect(dayLabel('2025-10-27T09:00:00.000Z', NOW)).toBe('27 Oct 2025');
    // Lagos is an hour ahead: 23:30 UTC is already the next day there.
    expect(dayLabel('2026-11-15T23:30:00.000Z', NOW)).toBe('16 Nov');
    expect(classesLabel(offering(1, { sessionsHeld: 1 }), NOW)).toBe('1 class · last 10 Nov');
    expect(classesLabel(offering(1, { sessionsHeld: 0, lastSessionAt: null }), NOW)).toBe('No classes yet');
  });

  it('writes the update time in Lagos without a stray comma', () => {
    expect(updatedLabel(NOW)).toBe('16 Nov at 21:51');
  });

  it('lists only the evidence there is, disputes first', () => {
    expect(evidenceChips(offering(1), NOW)).toEqual([]);
    const busy = offering(1, {
      openDisputes: 4, oldestOpenDisputeAt: '2026-11-09T08:00:00.000Z',
      inconclusiveCheckIns: 36, manualCheckIns: 2, revokedCheckIns: 1,
    });
    expect(evidenceChips(busy, NOW).map((chip) => chip.text)).toEqual([
      '4 open disputes, oldest 7 days', '36 location unclear', '2 added by hand', '1 removed',
    ]);
    expect(disputeChip(offering(1, { openDisputes: 1, oldestOpenDisputeAt: '2026-11-16T10:00:00.000Z' }), NOW)).toBe('1 open dispute, raised today');
  });
});
