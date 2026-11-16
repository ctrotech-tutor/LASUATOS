import type { AccountSession } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import type { CurrentAccount } from '../../lib/current-account';
import {
  ago,
  dateLabel,
  detailsNote,
  deviceFromAgent,
  isIdle,
  normalizeMatric,
  normalizeStaffNumber,
  orderSessions,
  roleLine,
  sessionLine,
  sheetFromHash,
  signedOutText,
  tidyName,
} from './model';

const NOW = Date.parse('2026-11-16T12:00:00Z'); // 13:00 in Lagos

const session = (id: string, createdAt: string, lastSeenAt: string | null, current = false): AccountSession => ({
  id, createdAt, lastSeenAt, expiresAt: '2026-12-16T12:00:00.000Z', current,
});

const student = (verified: boolean): CurrentAccount => ({
  id: '00000000-0000-4000-8000-000000000020',
  email: 'tolu@st.lasu.edu.ng',
  displayName: 'Tolulope Oyelaran',
  accountType: 'student',
  emailVerified: true,
  matricNumber: '220591005',
  matricNumberVerified: verified,
  sessionExpiresAt: '2026-12-16T12:00:00.000Z',
});

describe('deviceFromAgent', () => {
  it('names phones, tablets and computers with their browser', () => {
    expect(deviceFromAgent('Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Mobile Safari/537.36'))
      .toEqual({ kind: 'phone', name: 'Android phone', browser: 'Chrome' });
    expect(deviceFromAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'))
      .toEqual({ kind: 'phone', name: 'iPhone', browser: 'Safari' });
    expect(deviceFromAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0'))
      .toEqual({ kind: 'computer', name: 'Windows computer', browser: 'Edge' });
    expect(deviceFromAgent('Mozilla/5.0 (Linux; Android 13; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/24.0 Chrome/117.0.0.0 Safari/537.36'))
      .toEqual({ kind: 'tablet', name: 'Android tablet', browser: 'Samsung Internet' });
    expect(deviceFromAgent('Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36 OPR/83.0').browser).toBe('Opera');
  });

  it('reads iPadOS (which asks for desktop sites) as an iPad when it has touch', () => {
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
    expect(deviceFromAgent(mac)).toEqual({ kind: 'computer', name: 'Mac', browser: 'Safari' });
    expect(deviceFromAgent(mac, { touch: true })).toEqual({ kind: 'tablet', name: 'iPad', browser: 'Safari' });
  });

  it('says the installed app instead of the browser, and copes with an empty agent', () => {
    expect(deviceFromAgent('Mozilla/5.0 (Linux; Android 14) Chrome/138.0 Mobile Safari/537.36', { installed: true }).browser).toBe('LASUATOS app');
    expect(deviceFromAgent('')).toEqual({ kind: 'computer', name: 'Computer', browser: null });
  });
});

describe('times', () => {
  it('says how long ago in plain words', () => {
    expect(ago('2026-11-16T11:59:30Z', NOW)).toBe('just now');
    expect(ago('2026-11-16T11:35:00Z', NOW)).toBe('25 min ago');
    expect(ago('2026-11-16T11:00:00Z', NOW)).toBe('1 hour ago');
    expect(ago('2026-11-16T09:00:00Z', NOW)).toBe('3 hours ago');
    expect(ago('2026-11-15T09:00:00Z', NOW)).toBe('yesterday');
    expect(ago('2026-11-12T09:00:00Z', NOW)).toBe('4 days ago');
    expect(ago('2026-11-02T09:00:00Z', NOW)).toBe('on 2 Nov');
  });

  it('adds the year to dates outside this one', () => {
    expect(dateLabel('2026-03-05T10:00:00Z', NOW)).toBe('5 Mar');
    expect(dateLabel('2025-12-31T23:30:00Z', NOW)).toBe('1 Jan');
    expect(dateLabel('2025-11-20T10:00:00Z', NOW)).toBe('20 Nov 2025');
  });
});

describe('sessions', () => {
  const current = session('a', '2026-11-16T11:00:00Z', '2026-11-16T11:58:00Z', true);
  const recent = session('b', '2026-11-11T10:00:00Z', '2026-11-16T09:00:00Z');
  const idle = session('c', '2026-10-26T10:00:00Z', '2026-11-01T10:00:00Z');

  it('puts this device first, then the most recently used', () => {
    expect(orderSessions([idle, recent, current]).map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('describes another sign-in by when it was used and started', () => {
    expect(sessionLine(recent, NOW)).toBe('Active 3 hours ago · signed in 11 Nov');
    expect(isIdle(idle, NOW)).toBe(true);
    expect(sessionLine(idle, NOW)).toBe('Not used since 1 Nov · signed in 26 Oct');
    expect(sessionLine(session('d', '2026-11-16T10:00:00Z', null), NOW)).toBe('Active 2 hours ago · signed in 16 Nov');
  });

  it('counts the sign-ins ended', () => {
    expect(signedOutText(0)).toBe('No other devices were signed in.');
    expect(signedOutText(1)).toBe('Signed out 1 other device.');
    expect(signedOutText(3)).toBe('Signed out 3 other devices.');
  });
});

describe('details', () => {
  it('says what each kind of account is', () => {
    expect(roleLine(student(true))).toBe('Student');
    expect(roleLine({
      id: '00000000-0000-4000-8000-000000000010', email: 'a@lasu.edu.ng', displayName: 'Funmilayo Adeyemi', accountType: 'administrator', emailVerified: true,
      institutionName: 'Lagos State University', institutionId: '00000000-0000-4000-8000-000000000001', sessionExpiresAt: '2026-12-16T12:00:00.000Z',
      role: 'department_administrator', scope: { type: 'department', id: '00000000-0000-4000-8000-000000000003', label: 'Computer Engineering', facultyName: 'Engineering' },
    })).toBe('Department administrator · Computer Engineering');
  });

  it('tells a confirmed student who corrects their name', () => {
    expect(detailsNote(student(true))).toMatch(/ask your HOC/);
    expect(detailsNote(student(false))).toMatch(/matric number/);
  });

  it('tidies typed values the way the server stores them', () => {
    expect(normalizeMatric(' 2205 91005 ')).toBe('220591005');
    expect(normalizeStaffNumber('  sp/ 1234  ')).toBe('SP/ 1234');
    expect(tidyName('  Ada   Bello ')).toBe('Ada Bello');
  });

  it('opens a sheet from the address', () => {
    expect(sheetFromHash('#change-password')).toBe('password');
    expect(sheetFromHash('#face')).toBe('face');
    expect(sheetFromHash('')).toBeNull();
    expect(sheetFromHash('#other')).toBeNull();
  });
});
