import { describe, expect, it } from 'vitest';
import {
  canExtend,
  defaultOffering,
  formatCode,
  isFlagged,
  kindOf,
  msUntilRotation,
  openableOfferings,
  presentOf,
  presentRate,
  reasonProblem,
  roster,
  semesterWeek,
  sessionTitle,
  withSession,
  type Attendee,
  type CourseSession,
  type Offering,
} from './model';

const semester = { semesterStartsAt: '2026-10-05T00:00:00.000Z', semesterEndsAt: '2027-02-27T00:00:00.000Z' };
const at = (iso: string) => Date.parse(iso);

function offering(id: string, code: string, overrides: Partial<Offering> = {}): Offering {
  return { courseOfferingId: id, courseCode: code, ...semester, ...overrides } as Offering;
}

function attendee(overrides: Partial<Attendee> = {}): Attendee {
  return {
    studentId: '00000000-0000-4000-8000-000000000020',
    displayName: 'Tolulope Adebayo',
    checkedInAt: '2026-11-10T09:05:00.000Z',
    method: 'qr_code',
    venueOutcome: null,
    status: 'present',
    revokedAt: null,
    sharedDevice: false,
    studentNumber: '220591005',
    levelLabel: '300 Level',
    ...overrides,
  };
}

function session(id: string, startsAt: string, overrides: Partial<CourseSession> = {}): CourseSession {
  return { id, startsAt, endsAt: new Date(Date.parse(startsAt) + 3_600_000).toISOString(), status: 'closed', ...overrides } as CourseSession;
}

describe('semester weeks and titles', () => {
  it('counts weeks from the first day of the semester', () => {
    expect(semesterWeek(semester, at('2026-10-05T08:00:00.000Z'))).toBe(1);
    expect(semesterWeek(semester, at('2026-10-11T23:00:00.000Z'))).toBe(1);
    expect(semesterWeek(semester, at('2026-10-12T00:00:00.000Z'))).toBe(2);
    expect(semesterWeek(semester, at('2026-11-10T09:00:00.000Z'))).toBe(6);
    expect(semesterWeek(semester, at('2026-10-01T09:00:00.000Z'))).toBeNull();
    expect(semesterWeek(semester, at('2027-03-01T09:00:00.000Z'))).toBeNull();
    expect(semesterWeek(semester, 0)).toBeNull();
  });

  it('names a class after its week and kind, and reads the kind back', () => {
    expect(sessionTitle(semester, 'lecture', at('2026-11-10T09:00:00.000Z'))).toBe('Week 6 lecture');
    expect(sessionTitle(semester, 'practical', at('2026-10-05T09:00:00.000Z'))).toBe('Week 1 practical');
    expect(sessionTitle(null, 'tutorial', at('2026-11-10T09:00:00.000Z'))).toBe('Tutorial');
    expect(kindOf('Week 6 lecture')).toBe('lecture');
    expect(kindOf('  Tutorial ')).toBe('tutorial');
    expect(kindOf('Revision class')).toBeNull();
  });
});

describe('which courses can open a class', () => {
  const now = at('2026-11-10T09:00:00.000Z');
  const list = [
    offering('b', 'ECE 399'),
    offering('a', 'ECE 305'),
    offering('c', 'GET 201', { semesterStartsAt: '2027-03-15T00:00:00.000Z', semesterEndsAt: '2027-07-31T00:00:00.000Z' }),
    offering('d', 'ECE 201', { semesterStartsAt: '2026-03-01T00:00:00.000Z', semesterEndsAt: '2026-07-31T00:00:00.000Z' }),
  ];

  it('keeps only running semesters, by code', () => {
    expect(openableOfferings(list, now).map((item) => item.courseCode)).toEqual(['ECE 305', 'ECE 399']);
    expect(openableOfferings(list, 0)).toEqual([]);
  });

  it('preselects the course asked for, or the only one', () => {
    const openable = openableOfferings(list, now);
    expect(defaultOffering(openable, 'b')).toBe('b');
    expect(defaultOffering(openable, 'c')).toBe('');
    expect(defaultOffering(openable, null)).toBe('');
    expect(defaultOffering(openable.slice(0, 1), null)).toBe('a');
  });
});

describe('the roster', () => {
  it('splits present, removed and not checked in, and counts flags', () => {
    const detail = {
      attendees: [
        attendee(),
        attendee({ studentId: 'b', sharedDevice: true }),
        attendee({ studentId: 'c', venueOutcome: 'inconclusive', method: 'manual' }),
        attendee({ studentId: 'd', status: 'revoked', sharedDevice: true }),
      ],
      notCheckedIn: [{ studentId: 'e', displayName: 'Zainab Musa', studentNumber: '220591009', levelLabel: '300 Level' }],
    };
    const result = roster(detail);
    expect(result.present).toHaveLength(3);
    expect(result.revoked).toHaveLength(1);
    expect(result.absent).toHaveLength(1);
    expect(result.classSize).toBe(5);
    expect(result.flagged).toBe(2);
    expect(result.byHand).toBe(1);
  });

  it('flags only check-ins that still count', () => {
    expect(isFlagged(attendee({ sharedDevice: true }))).toBe(true);
    expect(isFlagged(attendee({ venueOutcome: 'within_boundary' }))).toBe(false);
    expect(isFlagged(attendee({ status: 'revoked', sharedDevice: true }))).toBe(false);
  });

  it('words the count and the rate', () => {
    expect(presentOf(12, 40)).toBe('12 of 40');
    expect(presentOf(3, 0)).toBe('3');
    expect(presentOf(1200, 1500)).toBe('1,200 of 1,500');
    expect(presentRate(12, 40)).toBe(30);
    expect(presentRate(0, 0)).toBeNull();
  });
});

describe('codes and changes', () => {
  it('times the next QR change from the challenge window', () => {
    const window = Math.floor(at('2026-11-10T09:00:05.000Z') / 20_000);
    const challenge = `lasu1.00000000-0000-4000-8000-000000000070.${window}.sig`;
    expect(msUntilRotation(challenge, (window * 20_000) + 5_000)).toBe(15_000);
    expect(msUntilRotation(challenge, (window + 2) * 20_000)).toBe(0);
    expect(msUntilRotation('lasu1.x.nope.sig', 0)).toBe(0);
  });

  it('groups the typed code in fours', () => {
    expect(formatCode('ABCDEFGHJKLM')).toBe('ABCD-EFGH-JKLM');
  });

  it('puts a changed or new session in the list, newest first', () => {
    const list = [session('a', '2026-11-09T09:00:00.000Z'), session('b', '2026-11-03T09:00:00.000Z')];
    const updated = withSession(list, { ...list[1]!, attendanceCount: 9 });
    expect(updated.map((item) => [item.id, item.attendanceCount])).toEqual([['a', undefined], ['b', 9]]);
    const added = withSession(list, session('c', '2026-11-10T09:00:00.000Z', { status: 'open' }));
    expect(added.map((item) => item.id)).toEqual(['c', 'a', 'b']);
  });

  it('offers more time only within the four-hour cap', () => {
    const start = '2026-11-10T09:00:00.000Z';
    expect(canExtend({ startsAt: start, endsAt: '2026-11-10T10:00:00.000Z' }, 240)).toBe(true);
    expect(canExtend({ startsAt: start, endsAt: '2026-11-10T12:45:00.000Z' }, 240)).toBe(true);
    expect(canExtend({ startsAt: start, endsAt: '2026-11-10T12:50:00.000Z' }, 240)).toBe(false);
  });

  it('asks for a reason the server will take', () => {
    expect(reasonProblem('too short')).toBe('Write at least 10 characters (1 more).');
    expect(reasonProblem('  In class, phone was dead  ')).toBeNull();
    expect(reasonProblem('x'.repeat(501))).toBe('Keep it under 500 characters.');
  });
});
