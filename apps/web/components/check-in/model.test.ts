import type { StudentOpenAttendanceSession } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import { challengeSessionId, classLine, findClass, needsLocation, readProblem, venueNote } from './model';

const ID = '0b6c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d';

function session(overrides: Partial<StudentOpenAttendanceSession> = {}): StudentOpenAttendanceSession {
  return {
    attendanceSessionId: ID,
    courseOfferingId: '1b6c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d',
    courseCode: 'ECE 405',
    courseTitle: 'Control Systems',
    sessionTitle: 'Week 9 lecture',
    venueCode: 'LT1',
    venueName: 'Lecture Theatre 1',
    locationRequired: true,
    qrOnly: true,
    endsAt: '2026-11-16T12:00:00.000Z',
    venueGuide: null,
    ...overrides,
  };
}

describe('course check-in model', () => {
  it('reads the session out of a rotating code', () => {
    expect(challengeSessionId(`lasu1.${ID.toUpperCase()}.123.sig`)).toBe(ID);
    expect(challengeSessionId('lasu1.not-a-session.1.sig')).toBeNull();
    expect(challengeSessionId('')).toBeNull();
  });

  it('finds the class among the open ones', () => {
    const open = [session({ attendanceSessionId: '2b6c1d2e-3f40-4a5b-8c6d-7e8f9a0b1c2d' }), session()];
    expect(findClass(`lasu1.${ID}.1.sig`, open)?.attendanceSessionId).toBe(ID);
    expect(findClass(`lasu1.${ID}.1.sig`, null)).toBeNull();
    expect(findClass('lasu1.x.1.sig', open)).toBeNull();
  });

  it('asks for location only when the class (or, unknown, any class) is at a venue', () => {
    expect(needsLocation(session({ locationRequired: false }), [session()])).toBe(false);
    expect(needsLocation(session(), [])).toBe(true);
    expect(needsLocation(null, [session({ locationRequired: false })])).toBe(false);
    expect(needsLocation(null, [session()])).toBe(true);
    expect(needsLocation(null, null)).toBe(true);
  });

  it('writes the ticket line from the session title and venue', () => {
    expect(classLine(session())).toBe('Week 9 lecture · Lecture Theatre 1');
    expect(classLine(session({ venueName: null }))).toBe('Week 9 lecture');
  });

  it('turns server answers into screens the student can act on', () => {
    const problem = (status: number, message: string) => readProblem({ status, message }, 'Lecture Theatre 1').kind;
    expect(problem(400, 'This QR code is expired or invalid. Scan the code currently shown by your lecturer.')).toBe('expired');
    expect(problem(400, 'This attendance code is invalid or no longer active.')).toBe('expired');
    expect(problem(409, 'This attendance session is closed or has expired.')).toBe('closed');
    expect(problem(409, 'This attendance session has already been closed.')).toBe('closed');
    expect(problem(403, 'Join this course before checking in to its attendance session.')).toBe('not_enrolled');
    expect(problem(400, 'This session takes place at LT1 and requires your device location to check in.')).toBe('location');
    expect(problem(422, 'Your device location is clearly outside LT1. Move to the venue and try again.')).toBe('outside');
    expect(problem(409, 'Your lecturer removed your check-in for this session. If you think this is wrong…')).toBe('removed');
    expect(problem(429, 'Too many requests')).toBe('busy');
    expect(problem(503, 'Unavailable')).toBe('offline');
    expect(problem(401, 'Sign in')).toBe('signed_out');
    expect(readProblem(new TypeError('Failed to fetch'), null).kind).toBe('offline');
    const other = readProblem({ status: 409, message: 'The venue boundary changed during check-in. Retry the check-in.' }, null);
    expect(other).toMatchObject({ kind: 'other', text: 'The venue boundary changed during check-in. Retry the check-in.' });
    expect(readProblem({ status: 422, message: 'outside' }, null).title).toBe('You seem to be outside the venue');
  });

  it('describes the location outcome on the receipt', () => {
    expect(venueNote('within_boundary', 'LT1')).toBe('In LT1');
    expect(venueNote('inconclusive', 'LT1')).toMatch(/imprecise/i);
    expect(venueNote(null, 'LT1')).toBeNull();
  });
});
