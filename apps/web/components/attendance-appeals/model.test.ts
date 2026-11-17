import type { AdministratorAttendanceAppeal } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import { appealNoteSuggestions, appealStanding, blocker, decidedLine, decideHint, nextOpenAppeal, NOTE_MIN, waitingLine } from './model';

function appeal(id: string, overrides: Partial<AdministratorAttendanceAppeal> = {}, dispute: Partial<AdministratorAttendanceAppeal['dispute']> = {}): AdministratorAttendanceAppeal {
  return {
    id,
    status: 'open',
    statement: 'Tunde sat next to me and can confirm I was there.',
    departmentName: 'Computer Engineering',
    decisionNote: null,
    decidedByName: null,
    decidedAt: null,
    createdAt: '2026-11-08T10:00:00.000Z',
    conflict: false,
    dispute: {
      id: `d-${id}`,
      courseOfferingId: 'o1',
      courseCode: 'ECE 305',
      courseTitle: 'Digital Systems Design',
      attendanceSessionId: 's1',
      sessionTitle: 'Week 3 lecture',
      sessionStartsAt: '2026-11-02T08:00:00.000Z',
      venueName: null,
      student: { id: 'u1', displayName: 'Ada Obi', studentNumber: '240591001', studentNumberVerified: true, enrollmentStatus: 'active' },
      standing: { attended: 5, eligible: 8, countsThisClass: true },
      kind: 'missing_check_in',
      status: 'rejected',
      statement: 'I was in class but my phone would not scan the code.',
      record: null,
      lastCorrection: null,
      resolutionNote: 'I did not see you in class.',
      resolvedByName: 'Dr Bello',
      resolvedAt: '2026-11-05T10:00:00.000Z',
      createdAt: '2026-11-03T10:00:00.000Z',
      appeal: null,
      ...dispute,
    },
    ...overrides,
  };
}

describe('attendance appeals model', () => {
  it('works out the figures as if the dispute were still open', () => {
    const standing = appealStanding(appeal('a'));
    expect(standing?.now).toMatchObject({ attended: 5, eligible: 8 });
    expect(standing?.ifUpheld).toMatchObject({ attended: 6, eligible: 8 });
    expect(appealStanding(appeal('b', { status: 'rejected' }))?.ifUpheld).toBeNull();
    expect(appealStanding(appeal('c', {}, { student: { id: 'u1', displayName: 'Ada Obi', studentNumber: '1', studentNumberVerified: false, enrollmentStatus: 'withdrawn' } }))).toBeNull();
  });

  it('keeps the lecturer who turned it down from deciding', () => {
    expect(blocker(appeal('a'))).toBeNull();
    expect(blocker(appeal('a', { conflict: true }))).toBe('conflict');
    expect(blocker(appeal('a', { status: 'upheld' }))).toBe('decided');
  });

  it('moves on to the next appeal this administrator can decide', () => {
    const list = [appeal('a'), appeal('b', { conflict: true }), appeal('c'), appeal('d')];
    expect(nextOpenAppeal(list, 'a')?.id).toBe('c');
    expect(nextOpenAppeal(list, 'd')?.id).toBe('c');
    expect(nextOpenAppeal([appeal('a'), appeal('b', { conflict: true })], 'a')).toBeNull();
  });

  it('says what is waiting', () => {
    expect(waitingLine(undefined)).toBe('\u00a0');
    expect(waitingLine({ appeals: [], openCount: 0 })).toBe('Nothing waiting');
    expect(waitingLine({ appeals: [appeal('a'), appeal('b')], openCount: 2 })).toBe('2 waiting for a decision');
    expect(waitingLine({ appeals: [appeal('a'), appeal('b', { conflict: true })], openCount: 2 })).toBe('2 waiting · 1 for another administrator');
  });

  it('explains decisions and what deciding does', () => {
    expect(decidedLine(appeal('a', { status: 'upheld', decidedByName: 'Prof Adeyemi' }))).toMatch(/^Prof Adeyemi accepted the appeal/);
    expect(decidedLine(appeal('a', { status: 'withdrawn' }))).toMatch(/withdrew/);
    expect(decideHint(appeal('a'))).toMatch(/^Marking them present changes the register\. Ada and the lecturer read your note/);
    expect(decideHint(appeal('a', {}, { student: { id: 'u1', displayName: 'Ada Obi', studentNumber: '1', studentNumberVerified: false, enrollmentStatus: 'withdrawn' } }))).toMatch(/has left this course/);
    for (const decision of ['uphold', 'reject'] as const) {
      for (const note of appealNoteSuggestions(decision)) expect(note.length).toBeGreaterThanOrEqual(NOTE_MIN);
    }
  });
});
