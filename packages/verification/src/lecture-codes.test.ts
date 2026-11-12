import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  createCheckInTicket,
  createLectureQrFrame,
  generatePublicCode,
  matchRotatingCode,
  normalizeAttendanceCode,
  parseLectureChallenge,
  verifyCheckInTicket,
  verifyLectureChallenge,
} from './lecture-codes.js';
import { generateSessionSecret } from './session-challenge.js';

const sessionId = '0f6d3a52-6c1b-4f0e-9a51-2a9a3f1c7d10';
const now = new Date('2026-11-12T09:00:05.000Z');

describe('lecture codes', () => {
  it('generates unambiguous fixed codes', () => {
    const codes = new Set(Array.from({ length: 200 }, generatePublicCode));
    expect(codes.size).toBe(200);
    for (const code of codes) {
      expect(code).toMatch(/^[A-Z2-9]{8}$/);
      for (const character of code) expect(CODE_ALPHABET).toContain(character);
      expect(code).not.toMatch(/[ILO01]/);
    }
  });

  it('normalises typed codes', () => {
    expect(normalizeAttendanceCode(' k7m2-9qxd ')).toBe('K7M29QXD');
  });

  it('accepts a QR frame for its window and the next one only', () => {
    const secret = generateSessionSecret();
    const frame = createLectureQrFrame({ secret, sessionId, now });
    expect(parseLectureChallenge(frame.challenge)?.sessionId).toBe(sessionId);
    expect(verifyLectureChallenge(frame.challenge, { secret, now })).toBe(true);
    expect(verifyLectureChallenge(frame.challenge, { secret, now: new Date(now.getTime() + 30_000) })).toBe(true);
    expect(verifyLectureChallenge(frame.challenge, { secret, now: new Date(now.getTime() + 60_000) })).toBe(false);
    expect(verifyLectureChallenge(frame.challenge, { secret: generateSessionSecret(), now })).toBe(false);
    expect(verifyLectureChallenge(frame.challenge.replace(/.$/, frame.challenge.endsWith('A') ? 'B' : 'A'), { secret, now })).toBe(false);
  });

  it('matches the rotating code shown under the QR, with one window of grace', () => {
    const secret = generateSessionSecret();
    const frame = createLectureQrFrame({ secret, sessionId, now });
    expect(frame.code).toMatch(/^[A-Z2-9]{6}$/);
    expect(matchRotatingCode(frame.code.toLowerCase(), { secret, sessionId, now })).toBe(true);
    expect(matchRotatingCode(frame.code, { secret, sessionId, now: new Date(now.getTime() + 30_000) })).toBe(true);
    expect(matchRotatingCode(frame.code, { secret, sessionId, now: new Date(now.getTime() + 61_000) })).toBe(false);
    expect(matchRotatingCode('AAAAAA', { secret, sessionId, now })).toBe(frame.code === 'AAAAAA');
  });

  it('issues check-in tickets that expire after ten minutes', () => {
    const secret = generateSessionSecret();
    const { ticket, expiresAt } = createCheckInTicket({ secret, sessionId, method: 'qr', now });
    expect(expiresAt.getTime() - now.getTime()).toBeLessThanOrEqual(600_000);
    expect(verifyCheckInTicket(ticket, { secret, now: new Date(now.getTime() + 9 * 60_000) })).toBe(true);
    expect(verifyCheckInTicket(ticket, { secret, now: new Date(now.getTime() + 11 * 60_000) })).toBe(false);
    expect(verifyCheckInTicket(ticket, { secret: generateSessionSecret(), now })).toBe(false);
    expect(verifyCheckInTicket(ticket.replace('.qr.', '.code.'), { secret, now })).toBe(false);
  });
});
