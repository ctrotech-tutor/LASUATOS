import type { AuthenticatedAccount } from './repository.js';

/**
 * Sessions started with a student's starting password (ADR 033).
 *
 * The starting password is LASU + matric number + SURNAME: anyone who knows a
 * classmate's number and surname can work it out. A session started with it
 * (while the account is still on it) is therefore not proof of who is holding
 * the phone. It can look around, but it cannot register a face, change the
 * password without an emailed code or Google, or, when face checks are off and
 * nothing else proves who is marking, mark attendance. Sessions started by
 * opening the account or resetting the password proved the email and are
 * never marked.
 */
export function needsOwnPassword(account: AuthenticatedAccount | null | undefined): boolean {
  return account?.accountType === 'student' && account.startingPasswordSession === true;
}

export const STARTING_PASSWORD_FACE_MESSAGE =
  'You signed in with the starting password, which anyone who knows your matric number and surname can work out. Choose your own password first (we email you a code), then register your face.';

export const STARTING_PASSWORD_CHECK_IN_MESSAGE =
  'You signed in with the starting password, which anyone who knows your matric number and surname can work out. Choose your own password in Account setup (we email you a code), then mark your attendance.';
