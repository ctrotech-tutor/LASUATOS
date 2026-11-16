import { describe, expect, it } from 'vitest';
import { currentMark, daysSince, inCourse, nextOpen, noteProblem, noteSuggestions, NOTE_MIN, reportHref, standingOf, waitedLabel, type Dispute } from './model';

function dispute(overrides: Partial<Dispute> = {}): Dispute {
  return {
    id: 'd1',
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
    status: 'open',
    statement: 'I was in class but my phone would not scan the code.',
    record: null,
    lastCorrection: null,
    resolutionNote: null,
    resolvedByName: null,
    resolvedAt: null,
    createdAt: '2026-11-03T10:00:00.000Z',
    ...overrides,
  };
}

const record = (overrides: Partial<NonNullable<Dispute['record']>> = {}): NonNullable<Dispute['record']> => ({
  status: 'present', method: 'qr_code', venueOutcome: 'within_boundary', checkedInAt: '2026-11-02T08:05:00.000Z', revokedAt: null, ...overrides,
});

describe('dispute model', () => {
  it('draws the current mark as the report does', () => {
    expect(currentMark(dispute())).toBe('absent');
    expect(currentMark(dispute({ record: record({ status: 'revoked', revokedAt: '2026-11-02T10:00:00.000Z' }) }))).toBe('revoked');
    expect(currentMark(dispute({ record: record({ method: 'manual', venueOutcome: null }) }))).toBe('manual');
    expect(currentMark(dispute({ record: record({ venueOutcome: 'inconclusive' }) }))).toBe('inconclusive');
    expect(currentMark(dispute({ record: record({ venueOutcome: null }) }))).toBe('unlocated');
  });

  it('shows where upholding would put the student', () => {
    expect(standingOf(dispute())).toEqual({
      now: { attended: 5, eligible: 8, rate: 62.5 },
      ifUpheld: { attended: 6, eligible: 8, rate: 75 },
    });
    // A class from before they joined starts counting once they are marked present.
    expect(standingOf(dispute({ standing: { attended: 2, eligible: 3, countsThisClass: false } }))?.ifUpheld).toEqual({ attended: 3, eligible: 4, rate: 75 });
    // Nothing would change: already present, left the course, or already decided.
    expect(standingOf(dispute({ record: record() }))?.ifUpheld).toBeNull();
    expect(standingOf(dispute({ student: { ...dispute().student, enrollmentStatus: 'withdrawn' } }))?.ifUpheld).toBeNull();
    expect(standingOf(dispute({ status: 'rejected' }))?.ifUpheld).toBeNull();
    expect(standingOf(dispute({ standing: null }))).toBeNull();
    expect(standingOf(dispute({ standing: { attended: 0, eligible: 0, countsThisClass: false } }))?.now.rate).toBeNull();
  });

  it('counts waiting days in Lagos time', () => {
    // 23:30 UTC is already the next day in Lagos.
    expect(daysSince('2026-11-02T23:30:00.000Z', '2026-11-03')).toBe(0);
    expect(waitedLabel('2026-11-03T10:00:00.000Z', '2026-11-03')).toBe('Today');
    expect(waitedLabel('2026-11-02T10:00:00.000Z', '2026-11-03')).toBe('1 day');
    expect(waitedLabel('2026-10-29T10:00:00.000Z', '2026-11-03')).toBe('5 days');
  });

  it('moves to the next waiting dispute after a decision', () => {
    const list = [dispute({ id: 'a' }), dispute({ id: 'b' }), dispute({ id: 'c' })];
    expect(nextOpen(list, 'a')?.id).toBe('b');
    expect(nextOpen(list, 'c')?.id).toBe('b');
    expect(nextOpen([dispute({ id: 'a' })], 'a')).toBeNull();
    expect(nextOpen(list, 'gone')?.id).toBe('a');
  });

  it('filters by course and links to the report at the student and class', () => {
    const list = [dispute({ id: 'a' }), dispute({ id: 'b', courseOfferingId: 'o2' })];
    expect(inCourse(list, '').map((item) => item.id)).toEqual(['a', 'b']);
    expect(inCourse(list, 'o2').map((item) => item.id)).toEqual(['b']);
    expect(reportHref(dispute())).toBe('/lecturer/reports/o1?student=u1&class=s1');
  });

  it('asks for a note the student can understand', () => {
    expect(noteProblem('ok')).toMatch(/at least 10/);
    expect(noteProblem('  I saw you in class.  ')).toBeNull();
    for (const decision of ['uphold', 'reject'] as const) {
      for (const kind of ['missing_check_in', 'revoked_check_in'] as const) {
        for (const note of noteSuggestions(decision, kind)) expect(note.trim().length).toBeGreaterThanOrEqual(NOTE_MIN);
      }
    }
  });
});
