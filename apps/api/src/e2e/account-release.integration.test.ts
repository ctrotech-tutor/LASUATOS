import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { hashPassword } from '@lasuatos/auth';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { StudentAuthService } from '../auth/service.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import { FaceVerifier } from '../students/face.js';
import { PostgresStudentRepository } from '../students/postgres-repository.js';
import { StudentService } from '../students/service.js';
import type { EmailTransport, SecurityNoticeEmail, StudentEmailCodeEmail } from '../email/transport.js';
import { INSTITUTION_SLUG, applyMigrations, ids, jsonBody, seedLecturerFixture, sessionCookie } from './harness.js';
import { capture, fakeEngine } from './fake-face.js';

/**
 * When the wrong person confirmed an account (the class list had someone
 * else's LASU email), an administrator releases it: the wrong person is
 * signed out for good and told by email, the face they registered is
 * deleted, the corrected email goes on the list, and only that address (or a
 * setup code) opens the account again, which then moves to the real student
 * with its attendance. HOCs cannot release; they are pointed to an
 * administrator. Security notices also follow takeovers and code resets.
 */

const ADMIN_ID = 'c9999999-9999-4999-8999-999999999999';
const ADMIN_EMAIL = 'admin@e2e.invalid';
const ADMIN_PASSWORD = 'e2e-admin-passphrase';

it('lets an administrator release a wrongly confirmed account to the real student', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    await seedLecturerFixture(client);
    await client.query(
      `INSERT INTO users (id, institution_id, email, display_name, password_hash, status) VALUES ($1, $2, $3, 'E2E Admin', $4, 'active')`,
      [ADMIN_ID, ids.institution, ADMIN_EMAIL, await hashPassword(ADMIN_PASSWORD)],
    );
    await client.query(
      `INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, 'institution_administrator', 'institution', $2)`,
      [ADMIN_ID, ids.institution],
    );

    const database = drizzle(client) as unknown as DatabaseClient;
    const codes: StudentEmailCodeEmail[] = [];
    const notices: SecurityNoticeEmail[] = [];
    const transport: EmailTransport = {
      sendVerification: async () => undefined,
      sendPasswordReset: async () => undefined,
      sendSecurityNotice: async () => undefined,
      sendStaffInvitation: async () => undefined,
    };
    let clock = new Date();
    const now = () => clock;
    const later = (seconds: number) => { clock = new Date(clock.getTime() + seconds * 1000); };
    const auth = new StudentAuthService({ repository: new PostgresAuthRepository(database), institutionSlug: INSTITUTION_SLUG, emailTransport: transport, now });
    const students = new StudentService({
      repository: new PostgresStudentRepository(database),
      institutionSlug: INSTITUTION_SLUG,
      emailSender: {
        sendStudentEmailCode: async (email) => { codes.push(email); },
        sendSecurityNotice: async (email) => { notices.push(email); },
      },
      faces: new FaceVerifier({ engine: async () => fakeEngine }),
      now,
    });
    const server = buildServer({ logger: false, secureCookies: false, auth, students, openStudentSignUp: false });
    const post = (url: string, payload: unknown, cookie?: string) =>
      server.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, ...(cookie ? { headers: { cookie } } : {}) });
    const get = (url: string, cookie?: string) => server.inject({ method: 'GET', url, ...(cookie ? { headers: { cookie } } : {}) });
    const lastCode = () => {
      const last = codes.at(-1);
      if (!last) throw new Error('no code sent');
      return last.code;
    };

    const adminCookie = sessionCookie((await post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).headers);
    // The HOC typed Aisha's LASU email on Musa's row by mistake.
    expect(jsonBody(await post('/api/v1/class-lists/import', {
      departmentId: ids.department,
      entryYear: 2024,
      rows: [
        { matricNumber: '240591020', surname: 'Ojo', firstName: 'Bayo', lasuEmail: 'bayo.ojo@st.lasu.edu.ng' },
        { matricNumber: '240591021', surname: 'Musa', firstName: 'Ibrahim', lasuEmail: 'aisha.bello@st.lasu.edu.ng' },
        { matricNumber: '240591022', surname: 'Eze', firstName: 'Chika' },
      ],
      apply: true,
    }, adminCookie))).toMatchObject({ applied: true, added: 3 });
    const entries = jsonBody(await get(`/api/v1/class-lists?departmentId=${ids.department}&entryYear=2024`, adminCookie)).entries as Array<{ id: string; matricNumber: string; stage: string; lasuEmail: string | null }>;
    const entryOf = (matric: string) => entries.find((entry) => entry.matricNumber === matric)!;

    // Bayo opens his account and is made the set's HOC.
    expect((await post('/api/v1/students/open/code', { matricNumber: '240591020' })).statusCode).toBe(200);
    const bayo = await post('/api/v1/students/open', { matricNumber: '240591020', code: lastCode() });
    expect(bayo.statusCode).toBe(201);
    const bayoId = String((jsonBody(bayo).student as { id: string }).id);
    await client.query(
      `INSERT INTO class_representatives (institution_id, student_user_id, role, faculty_id, department_id, entry_year, appointed_by_user_id) VALUES ($1, $2, 'hoc', $3, $4, 2024, $5)`,
      [ids.institution, bayoId, ids.faculty, ids.department, ADMIN_ID],
    );
    const hocCookie = sessionCookie(bayo.headers);

    // Aisha tries Musa's number "to see", the code lands in her mailbox, and she opens it,
    // changes the password and registers her own face.
    later(61);
    expect(jsonBody(await post('/api/v1/students/open/code', { matricNumber: '240591021' }))).toMatchObject({ email: 'aisha.bello@st.lasu.edu.ng' });
    const aisha = await post('/api/v1/students/open', { matricNumber: '240591021', code: lastCode() });
    expect(aisha.statusCode).toBe(201);
    const aishaCookie = sessionCookie(aisha.headers);
    const musaUserId = String((jsonBody(aisha).student as { id: string }).id);
    expect((await post('/api/v1/auth/password', { currentPassword: 'LASU240591021MUSA', newPassword: 'aisha-own-passphrase' }, aishaCookie)).statusCode).toBe(200);
    const aishaNow = sessionCookie((await post('/api/v1/auth/login', { email: '240591021', password: 'aisha-own-passphrase' })).headers);
    expect((await post('/api/v1/students/me/face', { consent: true, frames: capture('aisha') }, aishaNow)).statusCode).toBe(201);
    // And she asks for a password-reset code she keeps for later.
    later(61);
    expect((await post('/api/v1/students/password/code', { matricNumber: '240591021' })).statusCode).toBe(200);
    const staleResetCode = lastCode();

    // The real Musa cannot get in: it is open and confirmed.
    expect(jsonBody(await post('/api/v1/students/lookup', { matricNumber: '240591021' }))).toMatchObject({ accountStatus: 'open' });
    const musa = entryOf('240591021');
    // The HOC cannot fix it with a setup code, and is pointed to an administrator…
    const hocCode = await post(`/api/v1/class-lists/entries/${musa.id}/setup-code`, {}, hocCookie);
    expect(hocCode.statusCode).toBe(409);
    expect(jsonBody(hocCode).detail).toMatch(/administrator can release/);
    // …nor release it.
    expect((await post(`/api/v1/class-lists/entries/${musa.id}/release`, { email: 'ibrahim.musa@st.lasu.edu.ng', reason: 'Wrong email on the list' }, hocCookie)).statusCode).toBe(403);
    // Students cannot either.
    expect((await post(`/api/v1/class-lists/entries/${musa.id}/release`, { email: 'ibrahim.musa@st.lasu.edu.ng', reason: 'Wrong email on the list' }, aishaNow)).statusCode).toBe(403);

    // The administrator checks: a LASU email and a reason are needed, not the same address.
    expect((await post(`/api/v1/class-lists/entries/${musa.id}/release`, { email: 'ibrahim@gmail.com', reason: 'Wrong email on the list' }, adminCookie)).statusCode).toBe(422);
    expect((await post(`/api/v1/class-lists/entries/${musa.id}/release`, { email: 'ibrahim.musa@st.lasu.edu.ng', reason: 'no' }, adminCookie)).statusCode).toBe(422);
    expect((await post(`/api/v1/class-lists/entries/${musa.id}/release`, { email: 'aisha.bello@st.lasu.edu.ng', reason: 'Wrong email on the list' }, adminCookie)).statusCode).toBe(422);
    expect((await post(`/api/v1/class-lists/entries/${musa.id}/release`, { email: 'bayo.ojo@st.lasu.edu.ng', reason: 'Wrong email on the list' }, adminCookie)).statusCode).toBe(409);
    // Nothing to release on an account that never confirmed an email (or no account).
    expect((await post(`/api/v1/class-lists/entries/${entryOf('240591022').id}/release`, { email: 'chika.eze@st.lasu.edu.ng', reason: 'Wrong email on the list' }, adminCookie)).statusCode).toBe(409);

    const released = await post(`/api/v1/class-lists/entries/${musa.id}/release`, { email: ' Ibrahim.Musa@st.lasu.edu.ng ', reason: 'HOC typed Aisha’s email on the list; Musa came with his ID card.' }, adminCookie);
    expect(released.statusCode).toBe(200);
    expect(jsonBody(released)).toMatchObject({
      status: 'released',
      matricNumber: '240591021',
      studentName: 'MUSA Ibrahim',
      previousEmail: 'aisha.bello@st.lasu.edu.ng',
      listedEmail: 'ibrahim.musa@st.lasu.edu.ng',
      faceDeleted: true,
    });
    expect(Number(jsonBody(released).signedOutSessions)).toBeGreaterThanOrEqual(1);
    // Aisha is told, at the address she had.
    expect(notices.at(-1)).toMatchObject({ to: 'aisha.bello@st.lasu.edu.ng', kind: 'account_released', matricNumber: '240591021' });

    // She is signed out and has no way back in: password, starting password, kept code, her email.
    expect((await get('/api/v1/auth/session', aishaNow)).statusCode).toBe(401);
    expect((await post('/api/v1/auth/login', { email: '240591021', password: 'aisha-own-passphrase' })).statusCode).toBe(401);
    expect((await post('/api/v1/auth/login', { email: '240591021', password: 'LASU240591021MUSA' })).statusCode).toBe(401);
    expect((await post('/api/v1/auth/login', { email: 'aisha.bello@st.lasu.edu.ng', password: 'aisha-own-passphrase' })).statusCode).toBe(401);
    expect((await post('/api/v1/students/password', { matricNumber: '240591021', code: staleResetCode, password: 'aisha-takes-it-back' })).statusCode).toBe(409);
    later(61);
    const aishaAgain = await post('/api/v1/students/open/code', { matricNumber: '240591021', email: 'aisha.bello@st.lasu.edu.ng' });
    expect(aishaAgain.statusCode).toBe(422);
    expect(jsonBody(aishaAgain).detail).toMatch(/ibrahim\.musa@st\.lasu\.edu\.ng/);

    // The list shows the corrected email; the account waits for the real student.
    const after = (jsonBody(await get(`/api/v1/class-lists?departmentId=${ids.department}&entryYear=2024`, adminCookie)).entries as typeof entries).find((entry) => entry.matricNumber === '240591021')!;
    expect(after).toMatchObject({ stage: 'joined', lasuEmail: 'ibrahim.musa@st.lasu.edu.ng' });
    expect(jsonBody(await post('/api/v1/students/lookup', { matricNumber: '240591021' }))).toMatchObject({ accountStatus: 'unconfirmed', hasAccount: false });
    const history = jsonBody(await get(`/api/v1/class-lists?departmentId=${ids.department}&entryYear=2024`, adminCookie)).history as Array<{ action: string; summary: string; details?: string }>;
    expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'account_released' })]));

    // Musa opens it with the code to his own LASU email: same account, now his.
    const musaCode = await post('/api/v1/students/open/code', { matricNumber: '240591021' });
    expect(jsonBody(musaCode)).toMatchObject({ email: 'ibrahim.musa@st.lasu.edu.ng' });
    const musaOpened = await post('/api/v1/students/open', { matricNumber: '240591021', code: lastCode() });
    expect(musaOpened.statusCode).toBe(201);
    expect(jsonBody(musaOpened)).toMatchObject({ takenOver: true, startingPassword: 'LASU240591021MUSA', student: { id: musaUserId, email: 'ibrahim.musa@st.lasu.edu.ng', displayName: 'Ibrahim Musa' } });
    const musaCookie = sessionCookie(musaOpened.headers);
    expect(jsonBody(await get('/api/v1/students/me/setup', musaCookie))).toMatchObject({ emailVerified: true, faceRegistered: false });
    expect((await post('/api/v1/students/me/face', { consent: true, frames: capture('musa') }, musaCookie)).statusCode).toBe(201);
    // The freed placeholder address never gets a takeover notice.
    expect(notices.filter((notice) => notice.to.endsWith('.invalid'))).toHaveLength(0);

    // A password reset with a code is followed by a notice to the account's email.
    later(61);
    expect((await post('/api/v1/students/password/code', { matricNumber: '240591021' })).statusCode).toBe(200);
    expect((await post('/api/v1/students/password', { matricNumber: '240591021', code: lastCode(), password: 'musa-new-passphrase' })).statusCode).toBe(200);
    expect(notices.at(-1)).toMatchObject({ to: 'ibrahim.musa@st.lasu.edu.ng', kind: 'password_reset' });

    // A takeover of an unconfirmed account tells the address the older account had.
    const chika = await auth.registerStudent({ displayName: 'Not Chika', email: 'someone@gmail.com', matricNumber: '240591022', password: 'not-chika-passphrase' });
    expect(chika.student.id).toBeTruthy();
    later(61);
    expect((await post('/api/v1/students/open/code', { matricNumber: '240591022', email: 'chika.eze@st.lasu.edu.ng' })).statusCode).toBe(200);
    expect(jsonBody(await post('/api/v1/students/open', { matricNumber: '240591022', code: lastCode() }))).toMatchObject({ takenOver: true });
    expect(notices.at(-1)).toMatchObject({ to: 'someone@gmail.com', kind: 'account_taken_over', matricNumber: '240591022' });
  } finally {
    await client.close();
  }
});
