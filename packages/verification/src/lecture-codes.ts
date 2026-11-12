import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Codes for lecture attendance sessions (the quick sessions a lecturer, an
 * administrator or a class representative opens with just a course code and
 * title).
 *
 * - A static session has a fixed 8-character public code. It is printed on a
 *   QR poster (`/a/<code>`) and can be typed by students.
 * - A dynamic session shows a QR code that changes every 30 seconds
 *   (`/a#lasu2.<session>.<window>.<mac>`) and a 6-character code that changes
 *   with it, so a photo of the screen forwarded to a group chat soon stops
 *   working.
 * - Scanning or typing a valid code returns a check-in ticket valid for ten
 *   minutes, so a student without an account has time to type a name and
 *   matric number after the code on screen has moved on.
 *
 * Every value is keyed by the session's server-held secret. Codes avoid
 * letters and digits that are easy to confuse (I, L, O, 0, 1).
 */

export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PUBLIC_CODE_LENGTH = 8;
export const ROTATING_CODE_LENGTH = 6;
export const LECTURE_WINDOW_SECONDS = 30;
export const LECTURE_GRACE_WINDOWS = 1;
export const CHECK_IN_TICKET_SECONDS = 10 * 60;
export const LECTURE_CHALLENGE_PREFIX = 'lasu2';
const TICKET_PREFIX = 't1';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAC = /^[A-Za-z0-9_-]{22}$/;

function mac(secret: string, message: string): Buffer {
  return createHmac('sha256', Buffer.from(secret, 'base64url')).update(message).digest();
}

function shortMac(secret: string, message: string): string {
  return mac(secret, message).subarray(0, 16).toString('base64url');
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

function toAlphabet(bytes: Buffer, length: number): string {
  let out = '';
  for (let index = 0; index < length; index += 1) {
    out += CODE_ALPHABET[(bytes[index] ?? 0) % CODE_ALPHABET.length];
  }
  return out;
}

/** Upper case with spaces, dashes and other separators removed. */
export function normalizeAttendanceCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** A random fixed code for a static session, drawn without modulo bias. */
export function generatePublicCode(): string {
  let out = '';
  // 248 is the largest multiple of 31 below 256.
  while (out.length < PUBLIC_CODE_LENGTH) {
    for (const byte of randomBytes(16)) {
      if (byte < 248 && out.length < PUBLIC_CODE_LENGTH) out += CODE_ALPHABET[byte % CODE_ALPHABET.length];
    }
  }
  return out;
}

function windowAt(now: Date): number {
  return Math.floor(now.getTime() / (LECTURE_WINDOW_SECONDS * 1000));
}

function rotatingCodeFor(secret: string, sessionId: string, window: number): string {
  return toAlphabet(mac(secret, `code.${sessionId.toLowerCase()}.${window}`), ROTATING_CODE_LENGTH);
}

export interface LectureQrFrame {
  /** Placed in the URL fragment of the QR link. */
  readonly challenge: string;
  /** The 6-character code shown under the QR code. */
  readonly code: string;
  /** When the screen should move to the next frame. */
  readonly rotatesAt: Date;
}

export function createLectureQrFrame(options: { readonly secret: string; readonly sessionId: string; readonly now: Date }): LectureQrFrame {
  if (!UUID.test(options.sessionId)) throw new RangeError('sessionId must be a UUID.');
  const sessionId = options.sessionId.toLowerCase();
  const window = windowAt(options.now);
  return {
    challenge: `${LECTURE_CHALLENGE_PREFIX}.${sessionId}.${window}.${shortMac(options.secret, `${LECTURE_CHALLENGE_PREFIX}.${sessionId}.${window}`)}`,
    code: rotatingCodeFor(options.secret, sessionId, window),
    rotatesAt: new Date((window + 1) * LECTURE_WINDOW_SECONDS * 1000),
  };
}

/** Reads the session id from a challenge so its secret can be looked up. No authenticity check. */
export function parseLectureChallenge(challenge: string): { readonly sessionId: string; readonly window: number } | null {
  const parts = challenge.split('.');
  if (parts.length !== 4 || parts[0] !== LECTURE_CHALLENGE_PREFIX) return null;
  const [, sessionId, windowText, signature] = parts;
  if (!sessionId || !UUID.test(sessionId) || !windowText || !/^\d{1,15}$/.test(windowText) || !signature || !MAC.test(signature)) return null;
  return { sessionId: sessionId.toLowerCase(), window: Number(windowText) };
}

/** Accepts the current window and one earlier one, so a scan just before a change still works. */
export function verifyLectureChallenge(challenge: string, options: { readonly secret: string; readonly now: Date }): boolean {
  const parsed = parseLectureChallenge(challenge);
  if (!parsed) return false;
  const current = windowAt(options.now);
  if (parsed.window > current || parsed.window < current - LECTURE_GRACE_WINDOWS) return false;
  const signature = challenge.split('.')[3] ?? '';
  return safeEqual(signature, shortMac(options.secret, `${LECTURE_CHALLENGE_PREFIX}.${parsed.sessionId}.${parsed.window}`));
}

/** True when `code` is the rotating code of this session for the current or previous window. */
export function matchRotatingCode(code: string, options: { readonly secret: string; readonly sessionId: string; readonly now: Date }): boolean {
  const normalized = normalizeAttendanceCode(code);
  if (normalized.length !== ROTATING_CODE_LENGTH) return false;
  const current = windowAt(options.now);
  let matched = false;
  for (let window = current - LECTURE_GRACE_WINDOWS; window <= current; window += 1) {
    // Compare every candidate so timing does not reveal which window matched.
    if (safeEqual(normalized, rotatingCodeFor(options.secret, options.sessionId, window))) matched = true;
  }
  return matched;
}

export function createCheckInTicket(options: {
  readonly secret: string;
  readonly sessionId: string;
  readonly method: 'qr' | 'code';
  readonly now: Date;
}): { readonly ticket: string; readonly expiresAt: Date } {
  const sessionId = options.sessionId.toLowerCase();
  const expires = Math.floor(options.now.getTime() / 1000) + CHECK_IN_TICKET_SECONDS;
  const body = `${TICKET_PREFIX}.${sessionId}.${options.method}.${expires}`;
  return { ticket: `${body}.${shortMac(options.secret, body)}`, expiresAt: new Date(expires * 1000) };
}

export function parseCheckInTicket(ticket: string): { readonly sessionId: string; readonly method: 'qr' | 'code'; readonly expires: number } | null {
  const parts = ticket.split('.');
  if (parts.length !== 5 || parts[0] !== TICKET_PREFIX) return null;
  const [, sessionId, method, expiresText, signature] = parts;
  if (!sessionId || !UUID.test(sessionId) || (method !== 'qr' && method !== 'code')) return null;
  if (!expiresText || !/^\d{1,12}$/.test(expiresText) || !signature || !MAC.test(signature)) return null;
  return { sessionId: sessionId.toLowerCase(), method, expires: Number(expiresText) };
}

export function verifyCheckInTicket(ticket: string, options: { readonly secret: string; readonly now: Date }): boolean {
  const parsed = parseCheckInTicket(ticket);
  if (!parsed) return false;
  if (parsed.expires * 1000 <= options.now.getTime()) return false;
  const signature = ticket.split('.')[4] ?? '';
  return safeEqual(signature, shortMac(options.secret, `${TICKET_PREFIX}.${parsed.sessionId}.${parsed.method}.${parsed.expires}`));
}
