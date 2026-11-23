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
import type { EmailTransport, PasswordResetEmail, StudentEmailCodeEmail } from '../email/transport.js';
import { INSTITUTION_SLUG, applyMigrations, ids, jsonBody, seedLecturerFixture, sessionCookie } from './harness.js';
import { capture, fakeEngine } from './fake-face.js';

/**
 * Getting into a student account when the usual way does not work:
 *  - an older account someone opened with a student's matric number (and
 *    never confirmed a LASU email for) is taken over by the student who
 *    confirms the LASU email: new email, starting password, everyone else
 *    signed out, any face they registered deleted, attendance kept;
 *  - a forgotten password is reset with a code to the confirmed LASU email;
 *  - Forgot password also takes a matric number;
 *  - a HOC gives a one-time setup code to a student who cannot get the email;
 *  - names on registers stay full names.
 */

const ADMIN_ID = 'c8888888-8888-4888-8888-888888888888';
const ADMIN_EMAIL = 'admin@e2e.invalid';
const ADMIN_PASSWORD = 'e2e-admin-passphrase';

it('takes over unconfirmed accounts, resets passwords with codes and honours HOC setup codes', async () => {
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
    const resets: PasswordResetEmail[] = [];
    const transport: EmailTransport = {
      sendVerification: async () => undefined,
      sendPasswordReset: async (email) => { resets.push(email); },
      sendSecurityNotice: async () => undefined,
      sendStaffInvitation: async () => undefined,
    };
    let clock = new Date();
    const now = () => clock;
    const auth = new StudentAuthService({ repository: new PostgresAuthRepository(database), institutionSlug: INSTITUTION_SLUG, emailTransport: transport, now });
    const students = new StudentService({
      repository: new PostgresStudentRepository(database),
      institutionSlug: INSTITUTION_SLUG,
      emailSender: { sendStudentEmailCode: async (email) => { codes.push(email); } },
      faces: new FaceVerifier({ engine: async () => fakeEngine }),
      now,
      // As in production (app.ts): linking a personal email re-checks the password.
      credentials: { verifyStudent: (identifier: string, password: string) => auth.verifyStudentCredentials(identifier, password) },
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
    const later = (seconds: number) => { clock = new Date(clock.getTime() + seconds * 1000); };

    // Someone opened an account the old way with Kola's matric number, confirmed their own
    // Gmail and registered their own face.
    const impostor = await auth.registerStudent({ displayName: 'Kola Fake', email: 'someone.else@gmail.com', matricNumber: '240591011', password: 'impostor-passphrase' });
    await client.query('UPDATE users SET email_verified_at = CURRENT_TIMESTAMP WHERE id = $1', [impostor.student.id]);
    const impostorCookie = `lasuatos_session=${impostor.token}`;
    // …and asked for a password-reset link to their Gmail, kept for later.
    expect((await post('/api/v1/auth/password-reset/request', { email: 'someone.else@gmail.com' })).statusCode).toBe(202);
    const staleResetToken = resets.at(-1)?.token;
    expect(staleResetToken).toBeTruthy();

    // A student outside any list, with a self-typed name.
    const zainab = await auth.registerStudent({ displayName: 'zainab', email: 'zainab@gmail.com', matricNumber: '240591099', password: 'zainab-passphrase' });

    const adminCookie = sessionCookie((await post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).headers);
    const imported = jsonBody(await post('/api/v1/class-lists/import', {
      departmentId: ids.department,
      entryYear: 2024,
      rows: [
        { matricNumber: '240591011', surname: 'ADE', firstName: 'Kola', lasuEmail: 'kola.ade@st.lasu.edu.ng' },
        { matricNumber: '240591012', surname: 'Bello', firstName: 'Bisi' },
        { matricNumber: '240591013', surname: 'Femi', firstName: 'Ojo', lasuEmail: 'ojo.femi@st.lasu.edu.ng' },
      ],
      apply: true,
    }, adminCookie));
    expect(imported).toMatchObject({ applied: true, added: 3, linked: 1 });
    // Linked, but the impostor's account does not get Kola's name.
    expect(jsonBody(await get('/api/v1/auth/session', impostorCookie)).account).toMatchObject({ displayName: 'Kola Fake', matricNumberVerified: false });
    // Without a confirmed LASU email it cannot register a face either.
    expect((await post('/api/v1/students/me/face', { consent: true, frames: capture('impostor') }, impostorCookie)).statusCode).toBe(409);

    // 1. Kola is told an unconfirmed account uses his number, and takes it over with his LASU email.
    expect(jsonBody(await post('/api/v1/students/lookup', { matricNumber: '240591011' }))).toMatchObject({ hasAccount: false, accountStatus: 'unconfirmed', emailOnList: true });
    // No password-reset code for an account without a confirmed LASU email.
    expect((await post('/api/v1/students/password/code', { matricNumber: '240591011' })).statusCode).toBe(409);
    const kolaCode = await post('/api/v1/students/open/code', { matricNumber: '240591011' });
    expect(kolaCode.statusCode).toBe(200);
    expect(jsonBody(kolaCode)).toMatchObject({ email: 'kola.ade@st.lasu.edu.ng' });
    expect(codes.at(-1)).toMatchObject({ to: 'kola.ade@st.lasu.edu.ng', purpose: 'open' });
    const takenOver = await post('/api/v1/students/open', { matricNumber: '240591011', code: lastCode() });
    expect(takenOver.statusCode).toBe(201);
    expect(jsonBody(takenOver)).toMatchObject({
      status: 'opened',
      takenOver: true,
      startingPassword: 'LASU240591011ADE',
      student: { id: impostor.student.id, displayName: 'Kola Ade', email: 'kola.ade@st.lasu.edu.ng', matricNumber: '240591011', matricNumberVerified: true },
    });
    const kolaCookie = sessionCookie(takenOver.headers);

    // The impostor is signed out, cannot sign in, and their old reset link is dead.
    expect((await get('/api/v1/auth/session', impostorCookie)).statusCode).toBe(401);
    expect((await post('/api/v1/auth/login', { email: 'someone.else@gmail.com', password: 'impostor-passphrase' })).statusCode).toBe(401);
    expect((await post('/api/v1/auth/login', { email: '240591011', password: 'impostor-passphrase' })).statusCode).toBe(401);
    expect((await post('/api/v1/auth/password-reset/complete', { token: staleResetToken, password: 'impostor-new-pass' })).statusCode).toBe(400);
    // Kola signs in with the starting password and registers his face.
    expect((await post('/api/v1/auth/login', { email: '240591011', password: 'LASU240591011ADE' })).statusCode).toBe(200);
    expect(jsonBody(await get('/api/v1/students/me/setup', kolaCookie))).toMatchObject({ emailVerified: true, faceRegistered: false, defaultPassword: true });
    expect((await post('/api/v1/students/me/face', { consent: true, frames: capture('kola') }, kolaCookie)).statusCode).toBe(201);
    const history = jsonBody(await get(`/api/v1/class-lists?departmentId=${ids.department}&entryYear=2024`, adminCookie)).history as Array<{ action: string; summary: string }>;
    expect(history).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'account_taken_over', summary: 'Took over an older, unconfirmed account' })]));

    // Now it is open: no second opening, no takeover, no setup code.
    expect(jsonBody(await post('/api/v1/students/lookup', { matricNumber: '240591011' }))).toMatchObject({ hasAccount: true, accountStatus: 'open' });
    later(61);
    const again = await post('/api/v1/students/open/code', { matricNumber: '240591011' });
    expect(again.statusCode).toBe(409);
    expect(jsonBody(again).detail).toMatch(/Reset it with a code sent to kola\.ade@st\.lasu\.edu\.ng/);
    const kolaEntry = (jsonBody(await get(`/api/v1/class-lists?departmentId=${ids.department}&entryYear=2024`, adminCookie)).entries as Array<{ id: string; matricNumber: string }>)
      .find((entry) => entry.matricNumber === '240591011')!;
    expect((await post(`/api/v1/class-lists/entries/${kolaEntry.id}/setup-code`, {}, adminCookie)).statusCode).toBe(409);

    // 2. Kola forgets his password: a code to his LASU email, then a new password.
    later(61);
    const resetCode = await post('/api/v1/students/password/code', { matricNumber: '240 591 011' });
    expect(resetCode.statusCode).toBe(200);
    expect(jsonBody(resetCode)).toMatchObject({ status: 'sent', email: 'kola.ade@st.lasu.edu.ng' });
    expect(codes.at(-1)).toMatchObject({ to: 'kola.ade@st.lasu.edu.ng', purpose: 'reset' });
    // A reset code only resets passwords: it does not confirm an email.
    expect((await post('/api/v1/students/me/email-verify', { code: lastCode() }, kolaCookie)).statusCode).toBe(400);
    const weak = await post('/api/v1/students/password', { matricNumber: '240591011', code: lastCode(), password: 'short' });
    expect(weak.statusCode).toBe(422);
    const backToStart = await post('/api/v1/students/password', { matricNumber: '240591011', code: lastCode(), password: 'lasu-240591011-ade' });
    expect(backToStart.statusCode).toBe(422);
    expect(jsonBody(backToStart).detail).toMatch(/not the starting one/);
    const wrongCode = lastCode() === '000000' ? '111111' : '000000';
    expect(jsonBody(await post('/api/v1/students/password', { matricNumber: '240591011', code: wrongCode, password: 'kola-new-passphrase' })).detail).toBe('That code is not right. 3 tries left.');
    const reset = await post('/api/v1/students/password', { matricNumber: '240591011', code: lastCode(), password: 'kola-new-passphrase' });
    expect(reset.statusCode).toBe(200);
    expect(jsonBody(reset)).toMatchObject({ status: 'password_reset', student: { id: impostor.student.id }, signedOutSessions: 2 });
    expect((await get('/api/v1/auth/session', kolaCookie)).statusCode).toBe(401);
    expect((await get('/api/v1/auth/session', sessionCookie(reset.headers))).statusCode).toBe(200);
    expect((await post('/api/v1/auth/login', { email: '240591011', password: 'LASU240591011ADE' })).statusCode).toBe(401);
    expect((await post('/api/v1/auth/login', { email: '240591011', password: 'kola-new-passphrase' })).statusCode).toBe(200);
    expect((await post('/api/v1/students/password', { matricNumber: '240591011', code: lastCode(), password: 'kola-third-passphrase' })).statusCode).toBe(400);

    // 3. Forgot password with a matric number: the link goes to the account's email.
    later(16 * 60);
    resets.length = 0;
    expect((await post('/api/v1/auth/password-reset/request', { email: '240591011' })).statusCode).toBe(202);
    expect(resets).toEqual([expect.objectContaining({ to: 'kola.ade@st.lasu.edu.ng' })]);
    // Unknown numbers get the same answer and nothing is sent.
    expect((await post('/api/v1/auth/password-reset/request', { email: '240591077' })).statusCode).toBe(202);
    expect(resets).toHaveLength(1);

    // 4. Bisi has no LASU email on the list and cannot get into her mailbox: her HOC gives her a setup code.
    const entries = jsonBody(await get(`/api/v1/class-lists?departmentId=${ids.department}&entryYear=2024`, adminCookie)).entries as Array<{ id: string; matricNumber: string }>;
    const bisiEntry = entries.find((entry) => entry.matricNumber === '240591012')!;
    // Only people who manage the list can give one.
    const zainabCookie = `lasuatos_session=${zainab.token}`;
    expect((await post(`/api/v1/class-lists/entries/${bisiEntry.id}/setup-code`, {}, zainabCookie)).statusCode).toBe(403);
    const issued = await post(`/api/v1/class-lists/entries/${bisiEntry.id}/setup-code`, {}, adminCookie);
    expect(issued.statusCode).toBe(200);
    const setup = jsonBody(issued);
    expect(setup).toMatchObject({ status: 'issued', matricNumber: '240591012', studentName: 'BELLO Bisi', takesOver: false });
    expect(String(setup.code)).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(new Date(String(setup.expiresAt)).getTime() - clock.getTime()).toBe(30 * 60 * 1000);
    const typed = String(setup.code).replace('-', ' ').toLowerCase();
    // Her LASU email is still needed (the list has none); a wrong one does not spend the code.
    expect((await post('/api/v1/students/open/setup-code', { matricNumber: '240591012', setupCode: typed })).statusCode).toBe(422);
    expect((await post('/api/v1/students/open/setup-code', { matricNumber: '240591012', setupCode: typed, email: 'kola.ade@st.lasu.edu.ng' })).statusCode).toBe(409);
    const wrongSetup = String(setup.code).startsWith('A') ? 'BBBB-BBBB' : 'AAAA-AAAA';
    expect(jsonBody(await post('/api/v1/students/open/setup-code', { matricNumber: '240591012', setupCode: wrongSetup, email: 'bisi.bello@st.lasu.edu.ng' })).detail).toBe('That setup code is not right. 4 tries left.');
    const bisiOpened = await post('/api/v1/students/open/setup-code', { matricNumber: '240591012', setupCode: typed, email: 'bisi.bello' + '@st.lasu.edu.ng' });
    expect(bisiOpened.statusCode).toBe(201);
    expect(jsonBody(bisiOpened)).toMatchObject({ status: 'opened', takenOver: false, startingPassword: 'LASU240591012BELLO', student: { displayName: 'Bisi Bello', email: 'bisi.bello@st.lasu.edu.ng', matricNumberVerified: true } });
    const bisiCookie = sessionCookie(bisiOpened.headers);
    // Works once.
    expect(jsonBody(await post('/api/v1/students/open/setup-code', { matricNumber: '240591012', setupCode: typed, email: 'bisi.bello@st.lasu.edu.ng' })).detail).toMatch(/already used/);
    // Her email is not confirmed yet: setup asks for it, and the account is not "open" for a password-reset code.
    expect(jsonBody(await get('/api/v1/students/me/setup', bisiCookie))).toMatchObject({ emailVerified: false, vouched: true, classList: { listedEmail: 'bisi.bello@st.lasu.edu.ng' } });
    expect(jsonBody(await post('/api/v1/students/lookup', { matricNumber: '240591012' }))).toMatchObject({ accountStatus: 'unconfirmed' });
    // The class list marks her row, so the HOC knows the email is still owed.
    const listed = (jsonBody(await get(`/api/v1/class-lists?departmentId=${ids.department}&entryYear=2024`, adminCookie)).entries as Array<{ matricNumber: string; setupCodeUsed: boolean; stage: string }>)
      .find((entry) => entry.matricNumber === '240591012');
    expect(listed).toMatchObject({ stage: 'joined', setupCodeUsed: true });
    // The HOC vouched for her, so she can register her face (and check in) before confirming the email.
    expect((await post('/api/v1/students/me/face', { consent: true, frames: capture('bisi') }, bisiCookie)).statusCode).toBe(201);
    // Locked to the list's name like every confirmed student.
    expect((await post('/api/v1/auth/profile', { displayName: 'B. Bello' }, bisiCookie)).statusCode).toBe(409);
    // Once she can, she confirms it from her account and the name and matric become hers for good.
    // But she cannot open her LASU mailbox at all: she links the personal email she can open.
    // Her password is still the starting one — the session the setup code opened is trusted.
    later(61);
    expect((await post('/api/v1/students/me/secondary-email/code', { password: 'LASU240591012BELLO', email: 'bisi.bello@gmail.com' }, bisiCookie)).statusCode).toBe(200);
    expect(codes.at(-1)).toMatchObject({ to: 'bisi.bello@gmail.com', purpose: 'secondary' });
    expect(jsonBody(await post('/api/v1/students/me/secondary-email', { code: lastCode() }, bisiCookie))).toMatchObject({ status: 'verified', email: 'bisi.bello@gmail.com' });
    // Linking flips delivery: her account's mail now goes to the personal email.
    expect(jsonBody(await get('/api/v1/students/me/setup', bisiCookie))).toMatchObject({ emailVerified: false, secondaryEmailVerified: true, mailDelivery: 'secondary' });
    // So the confirmation code for her LASU email reaches her there — still bound to the LASU address it confirms.
    later(61);
    const confirmSent = await post('/api/v1/students/me/email-code', {}, bisiCookie);
    expect(confirmSent.statusCode).toBe(200);
    expect(jsonBody(confirmSent)).toMatchObject({ status: 'sent', email: 'bisi.bello@gmail.com', confirmEmail: 'bisi.bello@st.lasu.edu.ng' });
    expect(codes.at(-1)).toMatchObject({ to: 'bisi.bello@gmail.com', purpose: 'move', forEmail: 'bisi.bello@st.lasu.edu.ng' });
    expect(jsonBody(await post('/api/v1/students/me/email-verify', { code: lastCode() }, bisiCookie))).toMatchObject({ status: 'verified', email: 'bisi.bello@st.lasu.edu.ng' });
    expect(jsonBody(await post('/api/v1/students/lookup', { matricNumber: '240591012' }))).toMatchObject({ hasAccount: true, accountStatus: 'open' });
    expect(jsonBody(await get('/api/v1/students/me/setup', bisiCookie))).toMatchObject({ emailVerified: true, vouched: false, faceRegistered: true, complete: true });

    // A setup code expires after 30 minutes.
    const femiEntry = entries.find((entry) => entry.matricNumber === '240591013')!;
    const femiCode = String(jsonBody(await post(`/api/v1/class-lists/entries/${femiEntry.id}/setup-code`, {}, adminCookie)).code);
    later(31 * 60);
    expect(jsonBody(await post('/api/v1/students/open/setup-code', { matricNumber: '240591013', setupCode: femiCode })).detail).toMatch(/expired/);

    // A HOC's code given to the wrong person: whoever confirms the LASU email still wins,
    // and the face the wrong person registered goes with them.
    const wrongPersonCode = String(jsonBody(await post(`/api/v1/class-lists/entries/${femiEntry.id}/setup-code`, {}, adminCookie)).code);
    const wrongPerson = await post('/api/v1/students/open/setup-code', { matricNumber: '240591013', setupCode: wrongPersonCode });
    expect(wrongPerson.statusCode).toBe(201);
    const wrongCookie = sessionCookie(wrongPerson.headers);
    expect((await post('/api/v1/students/me/face', { consent: true, frames: capture('not-femi') }, wrongCookie)).statusCode).toBe(201);
    expect(jsonBody(await post('/api/v1/students/lookup', { matricNumber: '240591013' }))).toMatchObject({ accountStatus: 'unconfirmed' });
    expect((await post('/api/v1/students/open/code', { matricNumber: '240591013' })).statusCode).toBe(200);
    const realFemi = await post('/api/v1/students/open', { matricNumber: '240591013', code: lastCode() });
    expect(jsonBody(realFemi)).toMatchObject({ takenOver: true, student: { email: 'ojo.femi@st.lasu.edu.ng' } });
    expect((await get('/api/v1/auth/session', wrongCookie)).statusCode).toBe(401);
    const femiCookie = sessionCookie(realFemi.headers);
    expect(jsonBody(await get('/api/v1/students/me/setup', femiCookie))).toMatchObject({ emailVerified: true, faceRegistered: false });
    expect((await post('/api/v1/students/me/face', { consent: true, frames: capture('femi') }, femiCookie)).statusCode).toBe(201);

    // 5. Names stay full names. A student confirmed by the list cannot rename themselves…
    const kolaNow = sessionCookie((await post('/api/v1/auth/login', { email: '240591011', password: 'kola-new-passphrase' })).headers);
    const rename = await post('/api/v1/auth/profile', { displayName: 'K. O. Ade' }, kolaNow);
    expect(rename.statusCode).toBe(409);
    expect(jsonBody(rename).detail).toMatch(/class list/);
    // …and anyone else writes a first name and surname, without initials.
    expect(jsonBody(await post('/api/v1/auth/profile', { displayName: 'Zainab' }, zainabCookie)).detail).toMatch(/first name and surname/);
    expect(jsonBody(await post('/api/v1/auth/profile', { displayName: 'Zainab A.' }, zainabCookie)).detail).toMatch(/not an initial/);
    const renamed = await post('/api/v1/auth/profile', { displayName: 'Zainab  Aliyu' }, zainabCookie);
    expect(renamed.statusCode).toBe(200);
    expect(jsonBody(renamed)).toMatchObject({ displayName: 'Zainab Aliyu' });
  } finally {
    await client.close();
  }
});
