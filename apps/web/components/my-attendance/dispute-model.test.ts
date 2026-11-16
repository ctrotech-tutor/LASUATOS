import type { StudentAttendanceDispute, StudentAttendanceDisputes, StudentDisputableSession } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import { addStarter, ago, disputeBySession, groupDisputes, outcomeLine, statementCount, statementProblem, timeLeft, when } from './dispute-model';

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.parse('2026-11-10T12:00:00.000Z');
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const at = (offset: number) => new Date(NOW + offset).toISOString();

function dispute(n: number, session: number, status: StudentAttendanceDispute['status'], created: number, resolved: number | null = null): StudentAttendanceDispute {
  return {
    id: ID(n),
    attendanceSessionId: ID(session),
    courseOfferingId: ID(99),
    courseCode: 'ECE 305',
    courseTitle: 'Circuits',
    sessionTitle: `Week ${session}`,
    sessionStartsAt: at(-20 * DAY),
    kind: 'missing_check_in',
    status,
    statement: 'I was in the third row the whole class.',
    resolutionNote: status === 'upheld' || status === 'rejected' ? 'Checked with the class rep.' : null,
    resolvedByName: status === 'upheld' || status === 'rejected' ? 'Dr Ada Bello' : null,
    resolvedAt: resolved === null ? null : at(resolved),
    createdAt: at(created),
  };
}

function session(n: number, deadline: number): StudentDisputableSession {
  return {
    attendanceSessionId: ID(n),
    courseOfferingId: ID(99),
    courseCode: 'ECE 305',
    courseTitle: 'Circuits',
    sessionTitle: `Week ${n}`,
    startsAt: at(-3 * DAY),
    kind: 'missing_check_in',
    revocation: null,
    disputeDeadline: at(deadline),
  };
}

describe('student disputes model', () => {
  it('counts down to the deadline in words a phone can fit', () => {
    expect(timeLeft(at(9 * DAY + HOUR), NOW)).toEqual({ label: '9 days left', urgent: false, over: false });
    expect(timeLeft(at(2 * DAY + HOUR), NOW)).toMatchObject({ label: '2 days left', urgent: true });
    expect(timeLeft(at(DAY + 5), NOW).label).toBe('1 day left');
    expect(timeLeft(at(5 * HOUR + 60_000), NOW)).toMatchObject({ label: '5 h left', urgent: true });
    expect(timeLeft(at(40 * 60_000), NOW).label).toBe('40 min left');
    expect(timeLeft(at(20_000), NOW).label).toBe('1 min left');
    expect(timeLeft(at(-1), NOW)).toMatchObject({ label: 'Closed', over: true });
  });

  it('says how long ago', () => {
    expect(ago(at(-HOUR), NOW)).toBe('today');
    expect(ago(at(-DAY - HOUR), NOW)).toBe('yesterday');
    expect(ago(at(-3 * DAY), NOW)).toBe('3 days ago');
    expect(ago(at(-15 * DAY), NOW)).toBe('2 weeks ago');
  });

  it('picks the dispute that speaks for a class: waiting, then decided, then the latest withdrawn', () => {
    const map = disputeBySession([
      dispute(1, 10, 'withdrawn', -5 * DAY, -4 * DAY),
      dispute(2, 10, 'open', -2 * DAY),
      dispute(3, 11, 'withdrawn', -6 * DAY, -6 * DAY),
      dispute(4, 11, 'withdrawn', -3 * DAY, -3 * DAY),
      dispute(5, 12, 'withdrawn', -6 * DAY, -6 * DAY),
      dispute(6, 12, 'rejected', -5 * DAY, -1 * DAY),
    ]);
    expect(map.get(ID(10))?.id).toBe(ID(2));
    expect(map.get(ID(11))?.id).toBe(ID(4));
    expect(map.get(ID(12))?.id).toBe(ID(6));
  });

  it('groups what to dispute, what is waiting and what was decided', () => {
    const data: StudentAttendanceDisputes = {
      disputes: [
        dispute(1, 10, 'withdrawn', -5 * DAY, -4 * DAY),
        dispute(2, 10, 'open', -2 * DAY),
        dispute(3, 13, 'open', -6 * DAY),
        dispute(4, 14, 'upheld', -9 * DAY, -8 * DAY),
        dispute(5, 15, 'rejected', -7 * DAY, -2 * DAY),
        dispute(6, 16, 'withdrawn', -3 * DAY, -1 * DAY),
      ],
      disputableSessions: [session(20, 9 * DAY), session(21, 2 * DAY), session(16, 5 * DAY)],
      windowDays: 14,
      openLimit: 2,
    };
    const groups = groupDisputes(data);
    expect(groups.canDispute.map((item) => item.sessionTitle)).toEqual(['Week 21', 'Week 16', 'Week 20']);
    expect(groups.waiting.map((item) => item.id)).toEqual([ID(3), ID(2)]);
    // The withdrawn dispute for class 10 was sent again, so only the waiting one shows.
    expect(groups.decided.map((item) => item.id)).toEqual([ID(6), ID(5), ID(4)]);
    expect(groups.openCount).toBe(2);
    expect(groups.atLimit).toBe(true);
    expect(groupDisputes({ ...data, openLimit: 10 }).atLimit).toBe(false);
  });

  it('checks a statement the way the server does (trimmed, 20 to 1000 characters)', () => {
    expect(statementProblem('   ')).toMatch(/Say what happened/);
    expect(statementProblem('I was there.')).toBe('Add a little more: at least 20 characters (8 to go).');
    expect(statementProblem(`  ${'a'.repeat(20)}  `)).toBeNull();
    expect(statementProblem('a'.repeat(1001))).toMatch(/under 1000/);
    expect(statementCount('I was there.')).toEqual({ label: '8 more to go', ready: false });
    expect(statementCount('a'.repeat(25))).toEqual({ label: '25/1000', ready: true });
  });

  it('adds a starter on its own line', () => {
    expect(addStarter('', 'I was in class. ')).toBe('I was in class. ');
    expect(addStarter('I sat in row 3.  ', 'My phone died. ')).toBe('I sat in row 3.\nMy phone died. ');
  });

  it('explains each outcome from the student’s side', () => {
    expect(outcomeLine(dispute(1, 10, 'open', -3 * DAY), NOW)).toBe('Sent 3 days ago. You get an email when your lecturer decides.');
    expect(outcomeLine(dispute(2, 10, 'upheld', -9 * DAY, -8 * DAY), NOW)).toBe('Dr Ada Bello accepted it on Mon 2 Nov. You are marked present for this class.');
    expect(outcomeLine(dispute(3, 10, 'rejected', -9 * DAY, -8 * DAY), NOW)).toMatch(/^Dr Ada Bello did not accept it on Mon 2 Nov\. Your mark stays/);
    expect(outcomeLine(dispute(4, 10, 'withdrawn', -9 * DAY, -8 * DAY), NOW)).toBe('You withdrew it on Mon 2 Nov.');
  });

  it('formats a class time in Lagos', () => {
    expect(when('2026-10-22T08:00:00.000Z')).toBe('Thu 22 Oct, 09:00');
  });
});
