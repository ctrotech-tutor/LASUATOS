import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { hashPassword } from '@lasuatos/auth';
import { PASSKEY_LIMIT, PasskeyListSchema, PasskeyOptionsSchema } from '@lasuatos/contracts';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import { SignInCleanup } from '../auth/cleanup.js';
import { PostgresPasskeyRepository } from '../auth/passkey-repository.js';
import { PasskeyService, relyingPartyFor } from '../auth/passkeys.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import { StudentAuthService } from '../auth/service.js';
import type { EmailTransport, SecurityNoticeEmail } from '../email/transport.js';
import { buildServer } from '../server.js';
import { INSTITUTION_SLUG, LECTURER_EMAIL, LECTURER_PASSWORD, applyMigrations, ids, jsonBody, seedLecturerFixture, sessionCookie } from './harness.js';
import { SoftwarePasskey } from './fake-passkey.js';

/**
 * Staff passkeys end to end (ADR 037), with a software passkey that signs real
 * WebAuthn answers, against the real migrations:
 *  - adding one needs a staff session and the current password, and emails a notice;
 *  - signing in needs only the passkey, and works once per challenge;
 *  - a fake site's answer, an old answer, a cloned key and a removed passkey are refused;
 *  - a password sign-in on an account with a passkey emails a notice;
 *  - students cannot add one, suspended staff cannot use one.
 */

const ORIGIN = 'https://lasuatos.example.edu';
const STUDENT_ID = 'c7777777-7777-4777-8777-777777777777';
const STUDENT_PASSWORD = 'e2e-student-passphrase';

it('adds a passkey with the password, signs staff in with it, and refuses every way of faking one', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    await seedLecturerFixture(client);
    await client.query(
      `INSERT INTO users (id, institution_id, email, display_name, password_hash, status, email_verified_at) VALUES ($1, $2, 'student@e2e.invalid', 'Ada Student', $3, 'active', now())`,
      [STUDENT_ID, ids.institution, await hashPassword(STUDENT_PASSWORD)],
    );
    await client.query('INSERT INTO student_profiles (user_id, institution_id, department_id, student_number) VALUES ($1, $2, $3, $4)', [STUDENT_ID, ids.institution, ids.department, '240591001']);
    await client.query(`INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, 'student', 'institution', $2)`, [STUDENT_ID, ids.institution]);

    const database = drizzle(client) as unknown as DatabaseClient;
    const notices: SecurityNoticeEmail[] = [];
    const transport: EmailTransport = {
      sendVerification: async () => undefined,
      sendPasswordReset: async () => undefined,
      sendSecurityNotice: async (email) => { notices.push(email); },
      sendStaffInvitation: async () => undefined,
    };
    let clock = new Date();
    const now = () => clock;
    const authRepository = new PostgresAuthRepository(database);
    const passkeyRepository = new PostgresPasskeyRepository(database);
    const auth = new StudentAuthService({ repository: authRepository, institutionSlug: INSTITUTION_SLUG, emailTransport: transport, now, passkeys: passkeyRepository });
    const passkeys = new PasskeyService({
      repository: passkeyRepository,
      auth: authRepository,
      relyingParty: relyingPartyFor(ORIGIN, ['https://preview.example.net']),
      emailTransport: transport,
      now,
    });
    const server = buildServer({ logger: false, auth, passkeys, trustedOrigins: [ORIGIN] });
    const post = (url: string, payload: unknown, cookie?: string) => server.inject({ method: 'POST', url, payload: payload as object, headers: cookie ? { cookie } : {} });

    const signIn = async (email: string, password: string) => {
      const response = await post('/api/v1/auth/login', { email, password });
      expect(response.statusCode).toBe(200);
      return sessionCookie(response.headers);
    };
    const lecturer = await signIn(LECTURER_EMAIL, LECTURER_PASSWORD);
    expect(notices).toHaveLength(0);

    // Nothing yet.
    const empty = PasskeyListSchema.parse(jsonBody(await server.inject({ method: 'GET', url: '/api/v1/auth/passkeys', headers: { cookie: lecturer } })));
    expect(empty).toEqual({ passkeys: [], limit: PASSKEY_LIMIT });

    // Students cannot add one; signed-out callers cannot either.
    const student = await signIn('student@e2e.invalid', STUDENT_PASSWORD);
    expect((await server.inject({ method: 'GET', url: '/api/v1/auth/passkeys', headers: { cookie: student } })).statusCode).toBe(403);
    expect((await post('/api/v1/auth/passkeys/registration/options', { currentPassword: STUDENT_PASSWORD }, student)).statusCode).toBe(403);
    expect((await post('/api/v1/auth/passkeys/registration/options', { currentPassword: LECTURER_PASSWORD })).statusCode).toBe(401);

    // The password is asked for again.
    const wrong = await post('/api/v1/auth/passkeys/registration/options', { currentPassword: 'not-the-password' }, lecturer);
    expect(wrong.statusCode).toBe(400);
    expect(jsonBody(wrong).detail).toBe('Your current password was not accepted.');

    const started = PasskeyOptionsSchema.parse(jsonBody(await post('/api/v1/auth/passkeys/registration/options', { currentPassword: LECTURER_PASSWORD }, lecturer)));
    const creation = started.options as unknown as { challenge: string; rp: { id: string; name: string }; user: { id: string; name: string }; authenticatorSelection: Record<string, string>; attestation: string };
    expect(creation.rp).toEqual({ id: 'lasuatos.example.edu', name: 'LASUATOS' });
    expect(creation.user.name).toBe(LECTURER_EMAIL);
    expect(creation.authenticatorSelection).toMatchObject({ residentKey: 'required', userVerification: 'required' });
    expect(creation.attestation).toBe('none');

    const phone = new SoftwarePasskey();
    const added = await post('/api/v1/auth/passkeys/registration', { challengeId: started.challengeId, credential: phone.register(creation, ORIGIN) }, lecturer);
    expect(added.statusCode).toBe(201);
    expect(jsonBody(added).passkey).toMatchObject({ name: 'Google Password Manager', synced: true, lastUsedAt: null });
    expect(notices.map((notice) => [notice.kind, notice.to, notice.passkeyName])).toEqual([['passkey_added', LECTURER_EMAIL, 'Google Password Manager']]);

    // A challenge works once.
    const replayed = await post('/api/v1/auth/passkeys/registration', { challengeId: started.challengeId, credential: phone.register(creation, ORIGIN) }, lecturer);
    expect(replayed.statusCode).toBe(410);

    // A second device: refused when it does not unlock (no fingerprint or PIN), or answers for another site.
    const laptop = new SoftwarePasskey({ aaguid: '00000000-0000-0000-0000-000000000000', counter: 1, synced: false });
    const again = async () => PasskeyOptionsSchema.parse(jsonBody(await post('/api/v1/auth/passkeys/registration/options', { currentPassword: LECTURER_PASSWORD }, lecturer)));
    let next = await again();
    expect((await post('/api/v1/auth/passkeys/registration', { challengeId: next.challengeId, credential: laptop.register(next.options as never, ORIGIN, { userVerified: false }) }, lecturer)).statusCode).toBe(400);
    next = await again();
    expect((await post('/api/v1/auth/passkeys/registration', { challengeId: next.challengeId, credential: laptop.register(next.options as never, 'https://lasuatos-login.example.com') }, lecturer)).statusCode).toBe(400);
    next = await again();
    const second = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/passkeys/registration',
      payload: { challengeId: next.challengeId, credential: laptop.register(next.options as never, ORIGIN) },
      headers: { cookie: lecturer, 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' },
    });
    expect(second.statusCode).toBe(201);
    expect(jsonBody(second).passkey).toMatchObject({ name: 'Passkey on Chrome 131 on Windows', synced: false });
    // The same passkey twice is refused (browsers stop it first; this is the server's own check).
    next = await again();
    expect((await post('/api/v1/auth/passkeys/registration', { challengeId: next.challengeId, credential: laptop.register(next.options as never, ORIGIN) }, lecturer)).statusCode).toBe(409);

    // Signing in: no email, no cookie, just the passkey.
    const signInOptions = async () => PasskeyOptionsSchema.parse(jsonBody(await post('/api/v1/auth/passkeys/sign-in/options', {})));
    let challenge = await signInOptions();
    expect(challenge.options).toMatchObject({ rpId: 'lasuatos.example.edu', userVerification: 'required' });
    expect(challenge.options).not.toHaveProperty('allowCredentials.0');
    const assertion = phone.authenticate(challenge.options as never, ORIGIN);
    const signedIn = await post('/api/v1/auth/passkeys/sign-in', { challengeId: challenge.challengeId, credential: assertion });
    expect(signedIn.statusCode).toBe(200);
    expect(jsonBody(signedIn)).toMatchObject({ status: 'authenticated', account: { accountType: 'lecturer', email: LECTURER_EMAIL } });
    const viaPasskey = sessionCookie(signedIn.headers);
    expect((await server.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: viaPasskey } })).statusCode).toBe(200);
    // No "password used" notice for a passkey sign-in.
    expect(notices).toHaveLength(2);

    // The same answer cannot be used again, with its own challenge or a fresh one.
    expect((await post('/api/v1/auth/passkeys/sign-in', { challengeId: challenge.challengeId, credential: assertion })).statusCode).toBe(410);
    challenge = await signInOptions();
    expect((await post('/api/v1/auth/passkeys/sign-in', { challengeId: challenge.challengeId, credential: assertion })).statusCode).toBe(401);

    // A fake LASUATOS site gets an answer for its own address, which is worthless here.
    challenge = await signInOptions();
    expect((await post('/api/v1/auth/passkeys/sign-in', { challengeId: challenge.challengeId, credential: phone.authenticate(challenge.options as never, 'https://lasuatos-login.example.com', { rpId: 'lasuatos-login.example.com' }) })).statusCode).toBe(401);
    // A passkey that did not ask for the fingerprint or PIN is refused.
    challenge = await signInOptions();
    expect((await post('/api/v1/auth/passkeys/sign-in', { challengeId: challenge.challengeId, credential: phone.authenticate(challenge.options as never, ORIGIN, { userVerified: false }) })).statusCode).toBe(401);
    // An answer after five minutes is too late.
    challenge = await signInOptions();
    clock = new Date(clock.getTime() + 6 * 60_000);
    expect((await post('/api/v1/auth/passkeys/sign-in', { challengeId: challenge.challengeId, credential: phone.authenticate(challenge.options as never, ORIGIN) })).statusCode).toBe(410);

    // A security key counts up; a copy whose count fell behind is refused.
    challenge = await signInOptions();
    expect((await post('/api/v1/auth/passkeys/sign-in', { challengeId: challenge.challengeId, credential: laptop.authenticate(challenge.options as never, ORIGIN) })).statusCode).toBe(200);
    laptop.rewindCounter(0);
    challenge = await signInOptions();
    expect((await post('/api/v1/auth/passkeys/sign-in', { challengeId: challenge.challengeId, credential: laptop.authenticate(challenge.options as never, ORIGIN) })).statusCode).toBe(401);

    // The list shows both, with when each was last used.
    const listed = PasskeyListSchema.parse(jsonBody(await server.inject({ method: 'GET', url: '/api/v1/auth/passkeys', headers: { cookie: viaPasskey } })));
    expect(listed.passkeys.map((passkey) => [passkey.name, passkey.lastUsedAt !== null])).toEqual([['Google Password Manager', true], ['Passkey on Chrome 131 on Windows', true]]);

    // A password sign-in now emails a notice, because a password is what a fake page collects.
    await signIn(LECTURER_EMAIL, LECTURER_PASSWORD);
    expect(notices.at(-1)).toMatchObject({ kind: 'password_sign_in', to: LECTURER_EMAIL });
    await signIn('student@e2e.invalid', STUDENT_PASSWORD);
    expect(notices.filter((notice) => notice.kind === 'password_sign_in')).toHaveLength(1);

    // Rename and remove, only your own.
    const [first, laptopKey] = listed.passkeys;
    const renamed = await post(`/api/v1/auth/passkeys/${first!.id}`, { name: '  My Pixel  ' }, viaPasskey);
    expect(jsonBody(renamed).passkey).toMatchObject({ name: 'My Pixel' });
    expect((await post(`/api/v1/auth/passkeys/${first!.id}`, { name: '' }, viaPasskey)).statusCode).toBe(400);
    expect((await server.inject({ method: 'DELETE', url: `/api/v1/auth/passkeys/${laptopKey!.id}`, headers: { cookie: student } })).statusCode).toBe(403);
    expect((await server.inject({ method: 'DELETE', url: `/api/v1/auth/passkeys/${laptopKey!.id}`, headers: { cookie: viaPasskey } })).statusCode).toBe(204);
    expect(notices.at(-1)).toMatchObject({ kind: 'passkey_removed', passkeyName: 'Passkey on Chrome 131 on Windows' });
    expect((await server.inject({ method: 'DELETE', url: `/api/v1/auth/passkeys/${laptopKey!.id}`, headers: { cookie: viaPasskey } })).statusCode).toBe(404);
    challenge = await signInOptions();
    const removed = await post('/api/v1/auth/passkeys/sign-in', { challengeId: challenge.challengeId, credential: laptop.authenticate(challenge.options as never, ORIGIN) });
    expect(removed.statusCode).toBe(401);
    expect(String(jsonBody(removed).detail)).toContain('not registered with LASUATOS');

    // Suspended staff cannot sign in with a passkey either.
    await client.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [ids.lecturer]);
    challenge = await signInOptions();
    expect((await post('/api/v1/auth/passkeys/sign-in', { challengeId: challenge.challengeId, credential: phone.authenticate(challenge.options as never, ORIGIN) })).statusCode).toBe(403);
    await client.query(`UPDATE users SET status = 'active' WHERE id = $1`, [ids.lecturer]);

    // At most ten per account.
    const fresh = await signIn(LECTURER_EMAIL, LECTURER_PASSWORD);
    for (let index = 1; index < PASSKEY_LIMIT; index += 1) {
      await client.query(`INSERT INTO passkeys (user_id, credential_id, public_key, name) VALUES ($1, $2, '\\x00', $3)`, [ids.lecturer, `filler-credential-${index}`.padEnd(20, 'x'), `Filler ${index}`]);
    }
    const full = await post('/api/v1/auth/passkeys/registration/options', { currentPassword: LECTURER_PASSWORD }, fresh);
    expect(full.statusCode).toBe(409);
    expect(String(jsonBody(full).detail)).toContain(`${PASSKEY_LIMIT} passkeys`);

    // Unanswered challenges go with the daily clean-up.
    await signInOptions();
    const before = Number((await client.query<{ count: number }>('SELECT count(*)::int AS count FROM passkey_challenges')).rows[0]!.count);
    expect(before).toBeGreaterThan(0);
    await new SignInCleanup(database, () => new Date(clock.getTime() + 2 * 86_400_000)).prune();
    expect((await client.query<{ count: number }>('SELECT count(*)::int AS count FROM passkey_challenges')).rows[0]!.count).toBe(0);

    await server.close();
  } finally {
    await client.close();
  }
}, 60_000);
