import type { StudentOpenAttendanceSession } from '@lasuatos/contracts';

/**
 * Pure helpers for the course check-in screen (/check-in): the page a course's rotating QR code
 * opens. Kept apart from the screen so the rules can be tested without a browser.
 */

/** The session a rotating code belongs to: `lasu1.<sessionId>.<window>.<signature>`. */
export function challengeSessionId(challenge: string): string | null {
  const id = challenge.split('.')[1]?.toLowerCase() ?? '';
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id) ? id : null;
}

/** The open class the code is for, among the student's open classes. */
export function findClass(
  challenge: string,
  sessions: readonly StudentOpenAttendanceSession[] | null,
): StudentOpenAttendanceSession | null {
  const id = challengeSessionId(challenge);
  if (!id || !sessions) return null;
  return sessions.find((session) => session.attendanceSessionId.toLowerCase() === id) ?? null;
}

/**
 * Whether to read the phone's location before checking in. Only for a class at a venue; when the
 * class cannot be found (not enrolled yet, or the list failed), ask whenever any open class
 * needs it, or when nothing is known, so a venue class is never sent without a position.
 * A class the student is already marked in needs none.
 */
export function needsLocation(
  target: StudentOpenAttendanceSession | null,
  sessions: readonly StudentOpenAttendanceSession[] | null,
): boolean {
  // Already marked: the server answers that before it looks at location, so don't wait for one.
  if (target?.checkedInAt) return false;
  if (target) return target.locationRequired;
  if (!sessions) return true;
  return sessions.some((session) => session.locationRequired);
}

/** The line under the course title on the ticket: "Week 9 lecture · Lecture Theatre 1". */
export function classLine(session: { readonly sessionTitle: string; readonly venueName: string | null }): string {
  return [session.sessionTitle, session.venueName].filter(Boolean).join(' · ');
}

export type ProblemKind =
  | 'expired'
  | 'closed'
  | 'not_enrolled'
  | 'location'
  | 'outside'
  | 'removed'
  | 'busy'
  | 'offline'
  | 'signed_out'
  | 'phone_full'
  | 'password'
  | 'other';

export interface CheckInProblem {
  readonly kind: ProblemKind;
  readonly title: string;
  readonly text: string;
}

function statusOf(error: unknown): number | null {
  return error && typeof error === 'object' && 'status' in error && typeof error.status === 'number' ? error.status : null;
}

function messageOf(error: unknown): string {
  return error && typeof error === 'object' && 'message' in error && typeof error.message === 'string' ? error.message : '';
}

/**
 * What went wrong, in words the student can act on. The server's messages are matched loosely
 * (by status and a few stable words) so a reworded message still lands on a helpful screen, and
 * anything unknown shows the server's own words.
 */
export function readProblem(error: unknown, venueName: string | null): CheckInProblem {
  const status = statusOf(error);
  const message = messageOf(error);
  const venue = venueName ?? 'the venue';

  // fetch() rejects with a TypeError (no status) when the phone has no connection.
  if (status === null) {
    return { kind: 'offline', title: 'No connection', text: 'Your phone could not reach LASUATOS. Check your data or Wi-Fi, then scan the code again.' };
  }
  if (status === 401) {
    return { kind: 'signed_out', title: 'Sign in again', text: 'Your sign-in ended. Sign in, then scan the code again.' };
  }
  if (status === 403 && /starting password/i.test(message)) {
    return { kind: 'password', title: 'Choose your own password first', text: message };
  }
  if (status === 409 && /this phone has already/i.test(message)) {
    return { kind: 'phone_full', title: 'This phone has marked two students', text: message };
  }
  if (status === 410) {
    return { kind: 'expired', title: 'That check-in expired', text: 'It took more than ten minutes. Scan the code your lecturer is showing again.' };
  }
  if (status === 429 && /face/i.test(message)) {
    return { kind: 'other', title: 'Face check did not pass', text: message };
  }
  if (status === 429) {
    return { kind: 'busy', title: 'Too many tries', text: 'Wait a minute, then scan the code again.' };
  }
  if (status >= 500) {
    return { kind: 'offline', title: 'LASUATOS is not responding', text: 'This is on our side, not yours. Wait a moment, then scan the code again.' };
  }
  if (/removed your check-in/i.test(message)) {
    return { kind: 'removed', title: 'Your check-in was removed', text: 'Your lecturer removed your check-in for this class. If you think that is wrong, you can dispute it from My attendance.' };
  }
  if (/closed|has expired/i.test(message) && status === 409) {
    return { kind: 'closed', title: 'This class has closed', text: 'Attendance for it is not open any more. If you were in class, ask your lecturer to add you.' };
  }
  if (/expired or invalid|no longer active/i.test(message)) {
    return { kind: 'expired', title: 'That code has changed', text: 'The code on the screen changes every 30 seconds. Scan the one showing now.' };
  }
  if (status === 403 && /join/i.test(message)) {
    return { kind: 'not_enrolled', title: 'You’re not in this course yet', text: 'Join it with the course code from your lecturer, then scan again.' };
  }
  if (/outside/i.test(message)) {
    return { kind: 'outside', title: `You seem to be outside ${venue}`, text: 'Move into the venue and scan again. If you are inside, step nearer a window or door for a better reading.' };
  }
  if (/location/i.test(message)) {
    return { kind: 'location', title: 'Your location is needed', text: `This class is at ${venue}, so attendance checks you are there. Allow location for this site, then scan again.` };
  }
  return { kind: 'other', title: 'Not marked yet', text: message || 'The check-in could not be completed. Scan the code again.' };
}

/** The note under the receipt about the location reading. */
export function venueNote(outcome: string | null, venueName: string | null): string | null {
  const venue = venueName ?? 'the venue';
  if (outcome === 'within_boundary') return `In ${venue}`;
  if (outcome === 'inconclusive') return 'Imprecise location, noted for your lecturer';
  return null;
}
