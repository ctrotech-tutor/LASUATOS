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
import type { SecurityNoticeEmail, StudentEmailCodeEmail } from '../email/transport.js';
import { INSTITUTION_SLUG, applyMigrations, ids, jsonBody, seedLecturerFixture, sessionCookie } from './harness.js';
import { capture, fakeEngine } from './fake-face.js';
import { FAKE_GOOGLE_CLIENT_ID, fakeGoogle } from './fake-google.js';

/**
 * "Continue with Google" stands in for the emailed code everywhere one is
 * asked for (ADR 027): opening an account, forgot password, confirming the
 * email after a HOC's setup code, a Direct Entry student switching to their
 * matric number, and taking new face photos. LASU student emails are Google
 * Workspace accounts, so Google confirming the account proves the mailbox as
 * well as a code does, and no email has to arrive.
 *
 * Google is played by a key made in the test; the real verifier checks it.
 */

const ADMIN_ID = 'c7777777-7777-4777-8777-777777777779';
const ADMIN_EMAIL = 'admin@e2e.invalid';
const ADMIN_PASSWORD = 'e2e-admin-passphrase';

const ADA = '240591101';
const CHIDI = '240591102';
const FEMI = '240591103';
const KUNLE_JAMB = '202530074987JA';

it('confirms LASU emails with Google in place of every emailed code', async () => {
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
    const clock = new Date();
    const now = () => clock;
    const google = fakeGoogle(now);
    const sent: StudentEmailCodeEmail[] = [];
    const notices: SecurityNoticeEmail[] = [];
    const auth = new StudentAuthService({ repository: new PostgresAuthRepository(database), institutionSlug: INSTITUTION_SLUG });
    const repository = new PostgresStudentRepository(database);
    const emailSender = {
      sendStudentEmailCode: async (email: StudentEmailCodeEmail) => { sent.push(email); },
      sendSecurityNotice: async (email: SecurityNoticeEmail) => { notices.push(email); },
    };
    const students = new StudentService({
      repository,
      institutionSlug: INSTITUTION_SLUG,
      now,
      emailSender,
      faces: new FaceVerifier({ engine: async () => fakeEngine }),
      credentials: { verifyStudent: (identifier, password) => auth.verifyStudentCredentials(identifier, password) },
      google: google.signIn,
    });
    const server = buildServer({ logger: false, secureCookies: false, auth, students, openStudentSignUp: false });
    const post = (url: string, payload: unknown, cookie?: string) =>
      server.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, ...(cookie ? { headers: { cookie } } : {}) });
    const get = (url: string, cookie?: string) => server.inject({ method: 'GET', url, ...(cookie ? { headers: { cookie } } : {}) });
    const detail = (response: { body: string }) => String(jsonBody(response).detail ?? '');
    const audit = async (matric: string) => (await client.query<{ action: string; details: string }>(
      'SELECT action, details FROM student_audit_events WHERE matric_number = $1 ORDER BY created_at, action', [matric],
    )).rows;

    // The sign-up page asks whether the button shows, and where Google returns.
    const config = await get('/api/v1/students/google');
    expect(config.statusCode).toBe(200);
    expect(jsonBody(config)).toEqual({ clientId: FAKE_GOOGLE_CLIENT_ID, redirectUri: 'https://lasuatos.e2e.invalid/auth/google', hostedDomain: 'st.lasu.edu.ng' });

    const admin = sessionCookie((await post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).headers);
    const rows = [
      { matricNumber: ADA, surname: 'Obi', firstName: 'Ada', lasuEmail: 'ada.obi@st.lasu.edu.ng' },
      { matricNumber: CHIDI, surname: 'Eze', firstName: 'Chidi' },
      { matricNumber: FEMI, surname: 'Bello', firstName: 'Femi' },
      { matricNumber: KUNLE_JAMB, surname: 'Adeyemi', firstName: 'Kunle', lasuEmail: 'kunle.adeyemi@gmail.com' },
    ];
    expect(jsonBody(await post('/api/v1/class-lists/import', { departmentId: ids.department, entryYear: 2024, rows, apply: true }, admin))).toMatchObject({ applied: true, added: 4 });

    /* 1. Opening an account: Google confirms the listed LASU email; no code is sent. */
    const personalAccount = await post('/api/v1/students/open/google', { matricNumber: ADA, google: google.proof('ada.obi@st.lasu.edu.ng', 'open', { personal: true }) });
    // A personal Google account registered on a LASU address is not LASU's account.
    expect(personalAccount.statusCode).toBe(422);
    expect(detail(personalAccount)).toContain('is not an account in LASU’s Google');
    const classmate = await post('/api/v1/students/open/google', { matricNumber: ADA, google: google.proof('someone.else@st.lasu.edu.ng', 'open') });
    expect(classmate.statusCode).toBe(422);
    expect(detail(classmate)).toContain('your class list has ada.obi@st.lasu.edu.ng for you');
    // A proof made for another step (here: forgot password) does not open an account.
    const otherPurpose = await post('/api/v1/students/open/google', { matricNumber: ADA, google: google.proof('ada.obi@st.lasu.edu.ng', 'open', { noncePurpose: 'reset' }) });
    expect(otherPurpose.statusCode).toBe(400);
    expect((await post('/api/v1/students/open/google', { matricNumber: ADA, google: google.proof('ada.obi@st.lasu.edu.ng', 'open', { verified: false }) })).statusCode).toBe(400);
    expect((await post('/api/v1/students/open/google', { matricNumber: ADA, google: { credential: 'x', nonce: 'y' } })).statusCode).toBe(422);

    const adaOpened = await post('/api/v1/students/open/google', { matricNumber: ADA, google: google.proof('Ada.Obi@st.lasu.edu.ng', 'open') });
    expect(adaOpened.statusCode).toBe(201);
    expect(jsonBody(adaOpened)).toMatchObject({ status: 'opened', startingPassword: `LASU${ADA}OBI`, takenOver: false });
    const ada = sessionCookie(adaOpened.headers);
    expect(jsonBody(await get('/api/v1/students/me/setup', ada))).toMatchObject({ emailVerified: true, emailKind: 'lasu', lasuEmail: 'ada.obi@st.lasu.edu.ng' });
    expect(sent).toHaveLength(0);
    expect((await post('/api/v1/students/open/google', { matricNumber: ADA, google: google.proof('ada.obi@st.lasu.edu.ng', 'open') })).statusCode).toBe(409);
    expect(await audit(ADA)).toEqual([{ action: 'account_opened', details: 'opened with Google sign-in to the LASU email' }]);

    // No email on the list: the address Google confirms is the one used (nothing to type).
    const chidiOpened = await post('/api/v1/students/open/google', { matricNumber: CHIDI, google: google.proof('chidi.eze@st.lasu.edu.ng', 'open') });
    expect(chidiOpened.statusCode).toBe(201);
    expect(jsonBody(await get('/api/v1/students/me/setup', sessionCookie(chidiOpened.headers)))).toMatchObject({ emailVerified: true, lasuEmail: 'chidi.eze@st.lasu.edu.ng' });
    // Someone else's confirmed address cannot open another account.
    const femiWithChidis = await post('/api/v1/students/open/google', { matricNumber: FEMI, google: google.proof('chidi.eze@st.lasu.edu.ng', 'open') });
    expect(femiWithChidis.statusCode).toBe(409);

    /* 2. After a HOC's setup code, the email is confirmed with Google instead of a code. */
    const femiEntry = (jsonBody(await get(`/api/v1/class-lists?departmentId=${ids.department}&entryYear=2024`, admin)).entries as Array<Record<string, unknown>>)
      .find((entry) => entry.matricNumber === FEMI)!;
    const setupCode = jsonBody(await post(`/api/v1/class-lists/entries/${String(femiEntry.id)}/setup-code`, {}, admin)).code;
    const femiOpened = await post('/api/v1/students/open/setup-code', { matricNumber: FEMI, setupCode, email: 'femi.bello@st.lasu.edu.ng' });
    expect(femiOpened.statusCode).toBe(201);
    const femi = sessionCookie(femiOpened.headers);
    expect(jsonBody(await get('/api/v1/students/me/setup', femi))).toMatchObject({ emailVerified: false, vouched: true });
    // Not confirmed yet: Google does not sign anyone in to it (whoever typed the address might not own it).
    const femiUnconfirmed = await post('/api/v1/auth/google', { google: google.proof('femi.bello@st.lasu.edu.ng', 'signin') });
    expect(femiUnconfirmed.statusCode).toBe(409);
    expect(detail(femiUnconfirmed)).toContain('isn’t confirmed on your account yet');
    const femiGmail = await post('/api/v1/students/me/email-google', { google: google.proof('femi@gmail.com', 'email') }, femi);
    expect(femiGmail.statusCode).toBe(422);
    expect(detail(femiGmail)).toContain('Pick your LASU student account');
    expect((await post('/api/v1/students/me/email-google', { google: google.proof('femi.bello@st.lasu.edu.ng', 'email') })).statusCode).toBe(401);
    const femiConfirmed = await post('/api/v1/students/me/email-google', { google: google.proof('femi.bello@st.lasu.edu.ng', 'email') }, femi);
    expect(femiConfirmed.statusCode).toBe(200);
    expect(jsonBody(femiConfirmed)).toEqual({ status: 'verified', email: 'femi.bello@st.lasu.edu.ng' });
    expect(jsonBody(await get('/api/v1/students/me/setup', femi))).toMatchObject({ emailVerified: true, lasuEmail: 'femi.bello@st.lasu.edu.ng' });
    expect((await audit(FEMI)).find((event) => event.action === 'email_confirmed')?.details).toBe('existing account moved to its LASU email, confirmed with Google sign-in');

    /* 3. Forgot password: Google confirms the account's own email, then the new password. */
    const wrongAccount = await post('/api/v1/students/password/google', { matricNumber: ADA, password: 'ada-new-passphrase', google: google.proof('chidi.eze@st.lasu.edu.ng', 'reset') });
    expect(wrongAccount.statusCode).toBe(400);
    expect(detail(wrongAccount)).toContain('this account uses ada.obi@st.lasu.edu.ng');
    expect((await post('/api/v1/students/password/google', { matricNumber: ADA, password: `lasu${ADA}obi`, google: google.proof('ada.obi@st.lasu.edu.ng', 'reset') })).statusCode).toBe(422);
    expect((await post('/api/v1/students/password/google', { matricNumber: ADA, password: 'short', google: google.proof('ada.obi@st.lasu.edu.ng', 'reset') })).statusCode).toBe(422);
    const reset = await post('/api/v1/students/password/google', { matricNumber: ADA, password: 'ada-new-passphrase', google: google.proof('ada.obi@st.lasu.edu.ng', 'reset') });
    expect(reset.statusCode).toBe(200);
    expect(jsonBody(reset)).toMatchObject({ status: 'password_reset', signedOutSessions: 1 });
    expect((await get('/api/v1/students/me/setup', ada)).statusCode).toBe(401);
    const adaAgain = sessionCookie(reset.headers);
    expect((await post('/api/v1/auth/login', { email: ADA, password: 'ada-new-passphrase' })).statusCode).toBe(200);
    expect(notices.at(-1)).toMatchObject({ to: 'ada.obi@st.lasu.edu.ng', kind: 'password_reset' });
    expect((await audit(ADA)).find((event) => event.action === 'password_reset_with_code')?.details)
      .toBe('new password chosen after Google confirmed the account email; 1 session(s) signed out');

    /* 4. Direct Entry: opens with the personal Gmail on the list, then switches with the LASU account. */
    const kunleOutlook = await post('/api/v1/students/open/google', { matricNumber: KUNLE_JAMB, google: google.proof('kunle@outlook.com', 'open', { personal: true }) });
    expect(kunleOutlook.statusCode).toBe(422);
    expect(detail(kunleOutlook)).toContain('a LASU student email or a Gmail address');
    const kunleOpened = await post('/api/v1/students/open/google', { matricNumber: KUNLE_JAMB, google: google.proof('kunle.adeyemi@gmail.com', 'open', { personal: true }) });
    expect(kunleOpened.statusCode).toBe(201);
    const kunle = sessionCookie(kunleOpened.headers);
    expect(jsonBody(await get('/api/v1/students/me/setup', kunle))).toMatchObject({ numberKind: 'jamb', emailKind: 'personal', emailVerified: true });
    expect((await audit(KUNLE_JAMB)).at(0)?.details).toBe('opened with Google sign-in to the personal email (JAMB number)');
    // The matric number comes with a LASU email: the personal Gmail does not do here.
    expect((await post('/api/v1/students/me/matric/google', { matricNumber: '250591104', google: google.proof('kunle.adeyemi@gmail.com', 'matric', { personal: true }) }, kunle)).statusCode).toBe(422);
    expect((await post('/api/v1/students/me/matric/google', { matricNumber: '12', google: google.proof('kunle.adeyemi@st.lasu.edu.ng', 'matric') }, kunle)).statusCode).toBe(422);
    const switched = await post('/api/v1/students/me/matric/google', { matricNumber: '250591104', google: google.proof('kunle.adeyemi@st.lasu.edu.ng', 'matric') }, kunle);
    expect(switched.statusCode).toBe(200);
    expect(jsonBody(switched)).toMatchObject({ status: 'switched', matricNumber: '250591104', previousNumber: KUNLE_JAMB, email: 'kunle.adeyemi@st.lasu.edu.ng' });
    expect(notices.at(-1)).toMatchObject({ to: 'kunle.adeyemi@gmail.com', kind: 'matric_added' });
    expect((await audit('250591104')).find((event) => event.action === 'student_number_switched')?.details).toContain('lasu_email_confirmed via=google');

    /* 5. New face photos: the password and Google, in one step. */
    expect((await post('/api/v1/students/me/face', { consent: true, frames: capture('ada') }, adaAgain)).statusCode).toBe(201);
    expect((await post('/api/v1/students/me/face/replace/google', { password: 'not-her-password', google: google.proof('ada.obi@st.lasu.edu.ng', 'face') }, adaAgain)).statusCode).toBe(400);
    const faceOther = await post('/api/v1/students/me/face/replace/google', { password: 'ada-new-passphrase', google: google.proof('chidi.eze@st.lasu.edu.ng', 'face') }, adaAgain);
    expect(faceOther.statusCode).toBe(400);
    expect(detail(faceOther)).toContain('Pick that account');
    const faceOk = await post('/api/v1/students/me/face/replace/google', { password: 'ada-new-passphrase', google: google.proof('ada.obi@st.lasu.edu.ng', 'face') }, adaAgain);
    expect(faceOk.statusCode).toBe(200);
    expect(jsonBody(faceOk)).toMatchObject({ status: 'confirmed' });
    expect(jsonBody(await get('/api/v1/students/me/setup', adaAgain)).faceReplaceAllowedUntil).toBeTruthy();
    expect((await audit(ADA)).find((event) => event.action === 'face_replace_confirmed')?.details).toBe('password and Google sign-in confirmed');

    /* 6. Signing in with Google (ADR 028): the confirmed account that uses the address, any kind of account. */
    const signedIn = await post('/api/v1/auth/google', { google: google.proof('ada.obi@st.lasu.edu.ng', 'signin') });
    expect(signedIn.statusCode).toBe(200);
    expect(jsonBody(signedIn)).toMatchObject({ status: 'authenticated', account: { accountType: 'student', matricNumber: ADA } });
    expect((await get('/api/v1/students/me/setup', sessionCookie(signedIn.headers))).statusCode).toBe(200);
    // A proof made for another step, a personal account on a LASU address, an address nobody uses.
    expect((await post('/api/v1/auth/google', { google: google.proof('ada.obi@st.lasu.edu.ng', 'open', { noncePurpose: 'open' }) })).statusCode).toBe(400);
    expect((await post('/api/v1/auth/google', { google: google.proof('ada.obi@st.lasu.edu.ng', 'signin', { personal: true }) })).statusCode).toBe(422);
    const nobody = await post('/api/v1/auth/google', { google: google.proof('nobody@st.lasu.edu.ng', 'signin') });
    expect(nobody.statusCode).toBe(404);
    expect(detail(nobody)).toContain('No LASUATOS account uses nobody@st.lasu.edu.ng');
    // Google cannot vouch for an Outlook address registered as a Google account.
    const outlook = await post('/api/v1/auth/google', { google: google.proof('someone@outlook.com', 'signin', { personal: true }) });
    expect(outlook.statusCode).toBe(422);
    expect(detail(outlook)).toContain('Sign in with your password instead');
    // Staff too, when their account email is one Google runs; a suspended account never.
    await client.query(`UPDATE users SET email = 'e2e.lecturer@gmail.com', email_verified_at = now() WHERE id = $1`, [ids.lecturer]);
    const lecturer = await post('/api/v1/auth/google', { google: google.proof('e2e.lecturer@gmail.com', 'signin', { personal: true }) });
    expect(lecturer.statusCode).toBe(200);
    expect(jsonBody(lecturer)).toMatchObject({ account: { accountType: 'lecturer' } });
    await client.query(`UPDATE users SET status = 'suspended' WHERE id = $1`, [ids.lecturer]);
    expect((await post('/api/v1/auth/google', { google: google.proof('e2e.lecturer@gmail.com', 'signin', { personal: true }) })).statusCode).toBe(403);

    // Through all of it, not one code email was needed.
    expect(sent).toHaveLength(0);

    /* Not set up on a deployment: the button is hidden and the steps say so. */
    const codesOnly = new StudentService({ repository, institutionSlug: INSTITUTION_SLUG, now, emailSender });
    expect(codesOnly.googleSignIn()).toEqual({ clientId: null, redirectUri: null, hostedDomain: 'st.lasu.edu.ng' });
    await expect(codesOnly.openAccountWithGoogle({ matricNumber: CHIDI, google: google.proof('chidi.eze@st.lasu.edu.ng', 'open') }))
      .rejects.toMatchObject({ statusCode: 503 });
  } finally {
    await client.close();
  }
}, 60_000);
