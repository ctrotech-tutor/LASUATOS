import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Short-lived, session-bound attendance challenges for rotating QR codes.
 *
 * A challenge is `lasu1.<sessionId>.<window>.<signature>` where the signature
 * is a truncated HMAC-SHA256 over `<sessionId>.<window>` keyed by the
 * session's server-held secret. The payload contains no attendance authority
 * by itself: the server re-derived state (open session, enrollment, venue
 * evidence) still gates check-in, and a challenge expires after its time
 * window plus one window of clock-skew tolerance.
 *
 * Design constraints honoured here:
 * - Cryptographically secure randomness for secrets and MACs.
 * - Server-only secrets; the challenge is safe to project/display.
 * - No long-lived, replayable tokens.
 */

export const CHALLENGE_PREFIX = 'lasu1';
export const DEFAULT_CHALLENGE_WINDOW_SECONDS = 20;
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 16-byte HMAC truncation, base64url-encoded without padding. */
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function generateSessionSecret(): string {
  return randomBytes(32).toString('base64url');
}

function sign(secret: string, sessionId: string, window: number): string {
  return createHmac('sha256', Buffer.from(secret, 'base64url'))
    .update(`${sessionId}.${window}`)
    .digest()
    .subarray(0, 16)
    .toString('base64url');
}

export interface SessionQrChallenge {
  /** The opaque value encoded into the QR code. */
  readonly challenge: string;
  /** The end (exclusive) of the acceptance window covering this challenge. */
  readonly validUntil: Date;
}

/**
 * Builds the challenge for the time window containing `now`. The same window
 * always yields the same challenge, so a lecturer display polling every few
 * seconds stays stable within a window.
 */
export function createSessionQrChallenge(options: {
  readonly secret: string;
  readonly sessionId: string;
  readonly now: Date;
  readonly windowSeconds?: number;
  /** Extra windows of acceptance granted for clock skew; must match verify. */
  readonly graceWindows?: number;
}): SessionQrChallenge {
  const windowSeconds = options.windowSeconds ?? DEFAULT_CHALLENGE_WINDOW_SECONDS;
  const graceWindows = options.graceWindows ?? 1;
  if (!SESSION_ID_PATTERN.test(options.sessionId)) {
    throw new RangeError('sessionId must be a UUID.');
  }
  const windowMs = windowSeconds * 1000;
  const window = Math.floor(options.now.getTime() / windowMs);
  const normalizedSession = options.sessionId.toLowerCase();
  return {
    challenge: `${CHALLENGE_PREFIX}.${normalizedSession}.${window}.${sign(options.secret, normalizedSession, window)}`,
    validUntil: new Date((window + 1 + graceWindows) * windowMs),
  };
}

export type SessionQrChallengeVerification =
  | { readonly valid: true; readonly sessionId: string }
  | { readonly valid: false };

/**
 * Verifies a presented challenge against the session secret at `now`,
 * accepting the current window and `graceWindows` immediately preceding
 * windows (so a student scanning 1 second before rotation is not penalized).
 * Verification is constant-time over the signature bytes.
 */
export function verifySessionQrChallenge(
  challenge: string,
  options: {
    readonly secret: string;
    readonly now: Date;
    readonly windowSeconds?: number;
    readonly graceWindows?: number;
  },
): SessionQrChallengeVerification {
  const windowSeconds = options.windowSeconds ?? DEFAULT_CHALLENGE_WINDOW_SECONDS;
  const graceWindows = options.graceWindows ?? 1;
  const parts = challenge.split('.');
  if (parts.length !== 4 || parts[0] !== CHALLENGE_PREFIX) return { valid: false };
  const [, sessionId, windowText, presentedSignature] = parts;
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) return { valid: false };
  if (!windowText || !/^\d{1,15}$/.test(windowText)) return { valid: false };
  if (!presentedSignature || !SIGNATURE_PATTERN.test(presentedSignature)) return { valid: false };
  const window = Number(windowText);
  const windowMs = windowSeconds * 1000;
  const currentWindow = Math.floor(options.now.getTime() / windowMs);
  if (window > currentWindow || window < currentWindow - graceWindows) return { valid: false };

  const normalizedSession = sessionId.toLowerCase();
  const expected = sign(options.secret, normalizedSession, window);
  const expectedBytes = Buffer.from(expected, 'utf8');
  const presentedBytes = Buffer.from(presentedSignature, 'utf8');
  if (expectedBytes.length !== presentedBytes.length) return { valid: false };
  if (!timingSafeEqual(expectedBytes, presentedBytes)) return { valid: false };
  return { valid: true, sessionId: normalizedSession };
}

/**
 * Parses a challenge (without authenticity checks) so callers can look up the
 * session secret before calling {@link verifySessionQrChallenge}. Returns null
 * for malformed values.
 */
export function parseSessionQrChallenge(challenge: string): { readonly sessionId: string; readonly window: number } | null {
  const parts = challenge.split('.');
  if (parts.length !== 4 || parts[0] !== CHALLENGE_PREFIX) return null;
  const [, sessionId, windowText, signature] = parts;
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) return null;
  if (!windowText || !/^\d{1,15}$/.test(windowText)) return null;
  if (!signature || !SIGNATURE_PATTERN.test(signature)) return null;
  return { sessionId: sessionId.toLowerCase(), window: Number(windowText) };
}
