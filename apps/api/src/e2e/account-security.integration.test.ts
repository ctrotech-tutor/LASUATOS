import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { DatabaseClient } from '@lasuatos/database';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { StudentAuthService } from '../auth/service.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import type { PasswordResetEmail, SecurityNoticeEmail, VerificationEmail } from '../email/transport.js';
import { PostgresRateLimitStore, RateLimiter } from '../security/rate-limit.js';
import {
  INSTITUTION_SLUG,
  LECTURER_EMAIL,
  LECTURER_PASSWORD,
  applyMigrations,
  jsonBody,
  seedLecturerFixture,
  sessionCookie,
} from './harness.js';

/**
 * Account-security flows over HTTP against embedded PostgreSQL with the
 * production repositories: session listing and revocation, password change,
 * password reset (single use, cooldown, revokes sessions) and the shared
 * PostgreSQL rate-limit store.
 */

const MINUTE = 60_000;

async function setup(options: { readonly rateLimit?: boolean } = {}) {
  const client = new PGlite();
  await applyMigrations(client);
  await seedLecturerFixture(client);
  const database = drizzle(client) as unknown as DatabaseClient;

  let clock = new Date();
  const advance = (milliseconds: number) => { clock = new Date(clock.getTime() + milliseconds); };
  const mail = {
    verification: [] as VerificationEmail[],
    resets: [] as PasswordResetEmail[],
    notices: [] as SecurityNoticeEmail[],
  };
  const server = buildServer({
    logger: false,
    trustedOrigins: ['https://attendance.example.edu'],
    ...(options.rateLimit
      ? { rateLimiter: new RateLimiter({ store: new PostgresRateLimitStore(database, { random: () => 1 }) }) }
      : {}),
    auth: new StudentAuthService({
      repository: new PostgresAuthRepository(database),
      emailTransport: {
        sendVerification: async (email) => { mail.verification.push(email); },
        sendPasswordReset: async (email) => { mail.resets.push(email); },
        sendSecurityNotice: async (email) => { mail.notices.push(email); },
      },
      institutionSlug: INSTITUTION_SLUG,
      now: () => clock,
    }),
  });

  const login = async (password = LECTURER_PASSWORD, email = LECTURER_EMAIL) => server.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
  const signIn = async (password = LECTURER_PASSWORD) => {
    const response = await login(password);
    expect(response.statusCode).toBe(200);
    return sessionCookie(response.headers);
  };
  const sessionStatus = async (cookie: string) => (
    await server.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } })
  ).statusCode;

  return { client, database, server, mail, advance, login, signIn, sessionStatus };
}

describe('account security over HTTP with PostgreSQL', () => {
  it('lists sessions, revokes one or all others, and changes the password', async () => {
    const { client, server, mail, advance, login, signIn, sessionStatus } = await setup();
    try {
      const laptop = await signIn();
      advance(MINUTE);
      const phone = await signIn();
      advance(MINUTE);
      const tablet = await signIn();

      // Session use refreshes last-seen (throttled), so the list reflects activity.
      advance(10 * MINUTE);
      expect(await sessionStatus(laptop)).toBe(200);

      const listed = await server.inject({ method: 'GET', url: '/api/v1/auth/sessions', headers: { cookie: laptop } });
      expect(listed.statusCode).toBe(200);
      const sessions = (jsonBody(listed).sessions as Array<{ id: string; current: boolean; lastSeenAt: string }>);
      expect(sessions).toHaveLength(3);
      expect(sessions.filter((session) => session.current)).toHaveLength(1);
      expect(sessions[0]?.current).toBe(true); // most recently seen first
      expect(listed.body).not.toMatch(/[A-Za-z0-9_-]{43}/);

      // Revoke the phone by id from the laptop.
      const phoneId = (jsonBody(await server.inject({
        method: 'GET', url: '/api/v1/auth/sessions', headers: { cookie: phone },
      })).sessions as Array<{ id: string; current: boolean }>).find((session) => session.current)!.id;
      const revokedOne = await server.inject({ method: 'DELETE', url: `/api/v1/auth/sessions/${phoneId}`, headers: { cookie: laptop } });
      expect(jsonBody(revokedOne)).toEqual({ revokedSessions: 1 });
      expect(await sessionStatus(phone)).toBe(401);
      // The current session cannot be revoked through this route (use sign out).
      const currentId = sessions.find((session) => session.current)!.id;
      expect((await server.inject({ method: 'DELETE', url: `/api/v1/auth/sessions/${currentId}`, headers: { cookie: laptop } })).statusCode).toBe(404);

      // Sign out everywhere else.
      const others = await server.inject({ method: 'POST', url: '/api/v1/auth/sessions/revoke-others', headers: { cookie: laptop } });
      expect(jsonBody(others)).toEqual({ revokedSessions: 1 });
      expect(await sessionStatus(tablet)).toBe(401);
      expect(await sessionStatus(laptop)).toBe(200);

      // Change password: wrong current password is refused; success revokes other sessions only.
      const desktop = await signIn();
      const wrong = await server.inject({
        method: 'POST', url: '/api/v1/auth/password', headers: { cookie: laptop },
        payload: { currentPassword: 'not the password', newPassword: 'a changed lecturer passphrase' },
      });
      expect(wrong.statusCode).toBe(400);
      expect(jsonBody(wrong).detail).toBe('Your current password was not accepted.');

      const changed = await server.inject({
        method: 'POST', url: '/api/v1/auth/password', headers: { cookie: laptop },
        payload: { currentPassword: LECTURER_PASSWORD, newPassword: 'a changed lecturer passphrase' },
      });
      expect(jsonBody(changed)).toEqual({ status: 'password_changed', revokedSessions: 1 });
      expect(await sessionStatus(desktop)).toBe(401);
      expect(await sessionStatus(laptop)).toBe(200);
      expect((await login()).statusCode).toBe(401);
      expect((await login('a changed lecturer passphrase')).statusCode).toBe(200);
      expect(mail.notices.map((notice) => notice.kind)).toEqual(['password_changed']);
    } finally {
      await server.close();
      await client.close();
    }
  });

  it('resets a password once, with cooldown and no account enumeration, and signs out everywhere', async () => {
    const { client, server, mail, advance, login, signIn, sessionStatus } = await setup();
    try {
      const existing = await signIn();
      const request = (email: string) => server.inject({
        method: 'POST', url: '/api/v1/auth/password-reset/request', payload: { email },
      });

      const known = await request('LECTURER@e2e.invalid');
      const unknown = await request('nobody@e2e.invalid');
      expect(known.statusCode).toBe(202);
      expect(unknown.statusCode).toBe(202);
      expect(unknown.json()).toEqual(known.json());
      expect(mail.resets).toHaveLength(1);
      expect(mail.resets[0]?.to).toBe(LECTURER_EMAIL);

      // A pending (unverified) student cannot use recovery to bypass email confirmation.
      await server.inject({
        method: 'POST', url: '/api/v1/auth/register',
        payload: { displayName: 'Pending Student', email: 'pending@e2e.invalid', matricNumber: 'P-1', password: 'pending student passphrase' },
      });
      expect((await request('pending@e2e.invalid')).statusCode).toBe(202);
      expect(mail.resets).toHaveLength(1);

      // Within the cooldown nothing new is sent; afterwards the token is replaced.
      advance(MINUTE);
      await request(LECTURER_EMAIL);
      expect(mail.resets).toHaveLength(1);
      advance(2 * MINUTE);
      await request(LECTURER_EMAIL);
      expect(mail.resets).toHaveLength(2);
      const [first, second] = mail.resets;

      const complete = (token: string, password: string) => server.inject({
        method: 'POST', url: '/api/v1/auth/password-reset/complete', payload: { token, password },
      });
      const superseded = await complete(first!.token, 'a reset lecturer passphrase');
      expect(superseded.statusCode).toBe(400);
      expect(jsonBody(superseded).detail).toMatch(/invalid, has expired or has already been used/);

      const reset = await complete(second!.token, 'a reset lecturer passphrase');
      expect(reset.statusCode).toBe(200);
      expect(String(reset.headers['set-cookie'])).toContain('Max-Age=0');
      expect(await sessionStatus(existing)).toBe(401);
      expect((await login()).statusCode).toBe(401);
      expect((await login('a reset lecturer passphrase')).statusCode).toBe(200);
      expect(mail.notices.map((notice) => notice.kind)).toEqual(['password_reset']);

      expect((await complete(second!.token, 'another reset passphrase')).statusCode).toBe(400);

      // Tokens expire after 30 minutes.
      advance(3 * MINUTE);
      await request(LECTURER_EMAIL);
      advance(31 * MINUTE);
      expect((await complete(mail.resets[2]!.token, 'too late passphrase here')).statusCode).toBe(400);

      // Changing the password invalidates a pending reset link.
      await request(LECTURER_EMAIL);
      const current = await signIn('a reset lecturer passphrase');
      await server.inject({
        method: 'POST', url: '/api/v1/auth/password', headers: { cookie: current },
        payload: { currentPassword: 'a reset lecturer passphrase', newPassword: 'final lecturer passphrase' },
      });
      expect((await complete(mail.resets[3]!.token, 'should not apply here')).statusCode).toBe(400);
      expect((await login('final lecturer passphrase')).statusCode).toBe(200);

      // Only hashes are stored.
      const stored = await client.query<{ token_hash: string }>('SELECT token_hash FROM password_reset_tokens');
      expect(stored.rows).toHaveLength(1);
      expect(stored.rows[0]?.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(mail.resets.map((email) => email.token)).not.toContain(stored.rows[0]?.token_hash);
    } finally {
      await server.close();
      await client.close();
    }
  });

  it('enforces rate limits with the shared PostgreSQL store without storing raw identifiers', async () => {
    const { client, database, server, login } = await setup({ rateLimit: true });
    try {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        expect((await login('wrong password')).statusCode).toBe(401);
      }
      const limited = await login();
      expect(limited.statusCode).toBe(429);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(14 * 60);

      const rows = await client.query<{ key_hash: string; count: number }>('SELECT key_hash, count FROM rate_limit_counters ORDER BY count');
      expect(rows.rows.map((row) => row.count)).toEqual([11, 11]); // per-email and per-address
      expect(JSON.stringify(rows.rows)).not.toContain('lecturer');
      expect(JSON.stringify(rows.rows)).not.toContain('127.0.0.1');

      // Window arithmetic and reset straight against the store.
      const store = new PostgresRateLimitStore(database, { random: () => 0 });
      const t0 = new Date('2026-11-10T09:00:00.000Z');
      const counts = await Promise.all(Array.from({ length: 5 }, () => store.hit('f'.repeat(64), MINUTE, t0)));
      expect(counts.map((hit) => hit.count).sort()).toEqual([1, 2, 3, 4, 5]);
      await expect(store.hit('f'.repeat(64), MINUTE, new Date(t0.getTime() + MINUTE)))
        .resolves.toEqual({ count: 1, resetAt: new Date(t0.getTime() + 2 * MINUTE) });
    } finally {
      await server.close();
      await client.close();
    }
  });

  it('rejects cross-site mutations before they reach account logic', async () => {
    const { client, server, mail } = await setup();
    try {
      const forged = await server.inject({
        method: 'POST',
        url: '/api/v1/auth/password-reset/request',
        headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
        payload: { email: LECTURER_EMAIL },
      });
      expect(forged.statusCode).toBe(403);
      expect(mail.resets).toHaveLength(0);
    } finally {
      await server.close();
      await client.close();
    }
  });
});
