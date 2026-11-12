import { isCheckInChallenge } from '@lasuatos/contracts';

/**
 * Browser-local helpers for check-in.
 *
 * Device token: a random value created once per browser and kept in
 * localStorage. It is NOT a fingerprint — it is derived from nothing about the
 * device, clearing site data resets it, and the server only stores a hash of
 * it salted with the attendance session id. Its single purpose is to notice
 * when one browser checks in several different students in the same session.
 *
 * Pending check-in: when a phone camera opens a /check-in link but the student
 * still has to sign in, the challenge is parked in sessionStorage (this tab
 * only) so the check-in can resume straight after sign-in.
 */

const DEVICE_TOKEN_KEY = 'lasuatos.deviceToken';
const PENDING_CHECK_IN_KEY = 'lasuatos.pendingCheckIn';
/** Long enough to sign in; the server rejects stale challenges anyway. */
const PENDING_MAX_AGE_MS = 5 * 60_000;

function randomToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Returns this browser's check-in token, creating it on first use; undefined when storage is blocked. */
export function getDeviceToken(): string | undefined {
  try {
    const existing = window.localStorage.getItem(DEVICE_TOKEN_KEY);
    if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) return existing;
    const created = randomToken();
    window.localStorage.setItem(DEVICE_TOKEN_KEY, created);
    return created;
  } catch {
    return undefined;
  }
}

export function savePendingCheckIn(challenge: string): void {
  try {
    window.sessionStorage.setItem(PENDING_CHECK_IN_KEY, JSON.stringify({ challenge, savedAt: Date.now() }));
  } catch {
    // Private browsing can block storage; the student can still scan again after signing in.
  }
}

export function hasPendingCheckIn(): boolean {
  return readPending(false) !== null;
}

/** Reads and clears the parked challenge, ignoring stale or malformed entries. */
export function takePendingCheckIn(): string | null {
  return readPending(true);
}

function readPending(clear: boolean): string | null {
  try {
    const raw = window.sessionStorage.getItem(PENDING_CHECK_IN_KEY);
    if (!raw) return null;
    if (clear) window.sessionStorage.removeItem(PENDING_CHECK_IN_KEY);
    const parsed = JSON.parse(raw) as { challenge?: unknown; savedAt?: unknown };
    if (typeof parsed.challenge !== 'string' || typeof parsed.savedAt !== 'number') return null;
    if (Date.now() - parsed.savedAt > PENDING_MAX_AGE_MS) return null;
    return isCheckInChallenge(parsed.challenge) ? parsed.challenge : null;
  } catch {
    return null;
  }
}
