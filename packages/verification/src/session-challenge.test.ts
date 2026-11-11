import { describe, expect, it } from 'vitest';
import {
  createSessionQrChallenge,
  generateSessionSecret,
  parseSessionQrChallenge,
  verifySessionQrChallenge,
} from './session-challenge.js';

const sessionId = 'd7b6b0a2-7f4f-4f3a-9db3-9f3b12f1c001';
const secret = generateSessionSecret();

describe('session QR challenges', () => {
  it('creates stable challenges within a window and rotates across windows', () => {
    const now = new Date('2026-11-10T12:00:05.000Z');
    const first = createSessionQrChallenge({ secret, sessionId, now });
    const again = createSessionQrChallenge({ secret, sessionId, now });
    expect(first.challenge).toBe(again.challenge);
    expect(first.validUntil.getTime()).toBeGreaterThan(now.getTime());

    const later = createSessionQrChallenge({
      secret, sessionId, now: new Date(now.getTime() + 20_000),
    });
    expect(later.challenge).not.toBe(first.challenge);

    const payload = parseSessionQrChallenge(first.challenge);
    expect(payload?.sessionId).toBe(sessionId);
    expect(first.challenge.startsWith(`lasu1.${sessionId}.`)).toBe(true);
  });

  it('accepts the current window and one grace window, then rejects staleness', () => {
    const now = new Date('2026-11-10T12:00:05.000Z');
    const current = createSessionQrChallenge({ secret, sessionId, now });
    expect(verifySessionQrChallenge(current.challenge, { secret, now })).toEqual({
      valid: true,
      sessionId,
    });

    const gracePoint = new Date(now.getTime() + 20_000); // next window starts
    expect(verifySessionQrChallenge(current.challenge, { secret, now: gracePoint })).toEqual({
      valid: true,
      sessionId,
    });

    const stale = new Date(now.getTime() + 45_000);
    expect(verifySessionQrChallenge(current.challenge, { secret, now: stale })).toEqual({ valid: false });
  });

  it('rejects tampered signatures, wrong secrets, wrong sessions and future windows', () => {
    const now = new Date('2026-11-10T12:00:05.000Z');
    const current = createSessionQrChallenge({ secret, sessionId, now });

    expect(verifySessionQrChallenge(current.challenge.replace(/.$/, 'X'), { secret, now }))
      .toEqual({ valid: false });
    expect(verifySessionQrChallenge(current.challenge, { secret: generateSessionSecret(), now }))
      .toEqual({ valid: false });

    const otherSession = createSessionQrChallenge({
      secret,
      sessionId: '6f0f1b0a-9b8f-4eab-92bc-f364b09d1111',
      now,
    });
    expect(verifySessionQrChallenge(otherSession.challenge, { secret, now })).toEqual({
      valid: true,
      sessionId: '6f0f1b0a-9b8f-4eab-92bc-f364b09d1111',
    });

    const future = createSessionQrChallenge({ secret, sessionId, now: new Date(now.getTime() + 120_000) });
    expect(verifySessionQrChallenge(future.challenge, { secret, now })).toEqual({ valid: false });
  });

  it('rejects malformed, injected and oversized values before doing crypto work', () => {
    const now = new Date();
    for (const malformed of [
      '',
      'lasu1',
      'lasu1.not-a-uuid.1.sig',
      'lasu2.' + sessionId + '.1.x',
      `lasu1.${sessionId}.-5.x`,
      `lasu1.${sessionId}.999999999999999999999.x`,
      `lasu1.${sessionId}.1.` + 'x'.repeat(500),
      `lasu1.${sessionId.toUpperCase().replace('C001', 'C00-')}.1.x`,
      'lasu1..123.x',
    ]) {
      expect(verifySessionQrChallenge(malformed, { secret, now })).toEqual({ valid: false });
      expect(parseSessionQrChallenge(malformed)).toBeNull();
    }
  });

  it('treats a mixed-case session id as the same session', () => {
    const now = new Date('2026-11-10T12:00:05.000Z');
    const upper = createSessionQrChallenge({ secret, sessionId: sessionId.toUpperCase(), now });
    expect(verifySessionQrChallenge(upper.challenge, { secret, now })).toEqual({
      valid: true,
      sessionId,
    });
  });
});
