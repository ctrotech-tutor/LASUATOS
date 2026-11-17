import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { hashPassword } from '@lasuatos/auth';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { StudentAuthService } from '../auth/service.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import { LectureService } from '../lecture/service.js';
import { PostgresLectureRepository } from '../lecture/postgres-repository.js';
import { PostgresStudentRepository } from '../students/postgres-repository.js';
import { StudentService } from '../students/service.js';
import type { SecurityNoticeEmail, StudentEmailCodeEmail } from '../email/transport.js';
import {
  INSTITUTION_SLUG,
  LECTURER_EMAIL,
  LECTURER_PASSWORD,
  applyMigrations,
  ids,
  jsonBody,
  seedLecturerFixture,
  sessionCookie,
} from './harness.js';

/**
 * Direct Entry students often start before LASU gives them a matric number
 * or a LASU email. The class list carries their JAMB registration number
 * instead; they open the account with a personal email, take part in
 * lectures, and later switch to the matric number and LASU email (themselves,
 * with a code, or through the HOC) without losing any attendance.
 */

const ADMIN_ID = 'c7777777-7777-4777-8777-777777777778';
const ADMIN_EMAIL = 'admin@e2e.invalid';
const ADMIN_PASSWORD = 'e2e-admin-passphrase';

const KUNLE_JAMB = '202530074987JA';
const NGOZI_JAMB = '12345678HC';
const BOLA_JAMB = '202530011122BD';

it('lists Direct Entry students by JAMB number and carries their attendance to the matric number', async () => {
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
    const sent: StudentEmailCodeEmail[] = [];
    const notices: SecurityNoticeEmail[] = [];
    let clock = new Date();
    /** Codes to one student have a one-minute cool-down. */
    const later = () => { clock = new Date(clock.getTime() + 2 * 60_000); };
    const auth = new StudentAuthService({ repository: new PostgresAuthRepository(database), institutionSlug: INSTITUTION_SLUG });
    const students = new StudentService({
      repository: new PostgresStudentRepository(database),
      institutionSlug: INSTITUTION_SLUG,
      now: () => clock,
      emailSender: {
        sendStudentEmailCode: async (email) => { sent.push(email); },
        sendSecurityNotice: async (email) => { notices.push(email); },
      },
    });
    const server = buildServer({
      logger: false,
      secureCookies: false,
      auth,
      students,
      openStudentSignUp: false,
      lecture: new LectureService({
        repository: new PostgresLectureRepository(database),
        credentials: { verifyStudent: (identifier, password) => auth.verifyStudentCredentials(identifier, password) },
      }),
    });
    const post = (url: string, payload: unknown, cookie?: string) =>
      server.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, ...(cookie ? { headers: { cookie } } : {}) });
    const get = (url: string, cookie?: string) => server.inject({ method: 'GET', url, ...(cookie ? { headers: { cookie } } : {}) });
    const lastCode = () => sent.at(-1)!.code;
    const admin = sessionCookie((await post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).headers);
    const listUrl = `/api/v1/class-lists?departmentId=${ids.department}&entryYear=2024`;
    const entries = async () => jsonBody(await get(listUrl, admin)).entries as Array<Record<string, unknown>>;
    const entryOf = async (number: string) => (await entries()).find((entry) => entry.matricNumber === number)!;

    // 1. The HOC's sheet mixes matric numbers and JAMB numbers. A JAMB number makes the row
    //    Direct Entry (200 level) when the sheet has no entry column, and allows a personal email.
    const rows = [
      { matricNumber: KUNLE_JAMB, surname: 'ADEYEMI', firstName: 'Kunle', lasuEmail: 'Kunle.Adeyemi@gmail.com' },
      { matricNumber: '1234 5678 hc', surname: 'Eze', firstName: 'Ngozi' },
      { matricNumber: BOLA_JAMB, surname: 'Ade', firstName: 'Bola' },
      { matricNumber: '240591010', surname: 'Okon', firstName: 'Emeka', lasuEmail: 'emeka@gmail.com' },
    ];
    const withError = jsonBody(await post('/api/v1/class-lists/import', {
      departmentId: ids.department,
      entryYear: 2024,
      rows: [...rows, { matricNumber: '20253007498JA', surname: 'Short', firstName: 'Number' }, { matricNumber: '202230000001AB', surname: 'Old', firstName: 'Exam' }],
      apply: false,
    }, admin));
    expect(withError.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 5, kind: 'error', message: expect.stringContaining('JAMB numbers have 12 digits and 2 letters') }),
      // The exam year is normally the year of admission (2025 for the 2024 set's 200-level entrants).
      expect.objectContaining({ row: 6, kind: 'warning', message: expect.stringContaining('The JAMB number is from 2022') }),
      expect.objectContaining({ row: 4, kind: 'warning', message: expect.stringContaining('Personal emails are kept only for students listed by JAMB number') }),
    ]));
    const preview = jsonBody(await post('/api/v1/class-lists/import', { departmentId: ids.department, entryYear: 2024, rows, apply: false }, admin));
    expect(preview).toMatchObject({ applied: false, added: 4, onJamb: 3, switched: 0 });
    expect(jsonBody(await post('/api/v1/class-lists/import', { departmentId: ids.department, entryYear: 2024, rows, apply: true }, admin)))
      .toMatchObject({ applied: true, added: 4, onJamb: 3 });
    expect(await entryOf(KUNLE_JAMB)).toMatchObject({
      numberKind: 'jamb', jambNumber: KUNLE_JAMB, entryLevel: 200, levelLabel: '300 Level', lasuEmail: 'kunle.adeyemi@gmail.com',
    });
    expect(await entryOf(NGOZI_JAMB)).toMatchObject({ numberKind: 'jamb', entryLevel: 200 });
    expect(await entryOf('240591010')).toMatchObject({ numberKind: 'matric', jambNumber: null, lasuEmail: null });

    // 2. Kunle signs up with his JAMB number; the code goes to the personal email on the list.
    expect(jsonBody(await post('/api/v1/students/lookup', { matricNumber: KUNLE_JAMB.toLowerCase() })))
      .toMatchObject({ status: 'found', numberKind: 'jamb', emailOnList: true, fullName: 'ADEYEMI Kunle' });
    expect((await post('/api/v1/students/open/code', { matricNumber: KUNLE_JAMB, email: 'other@gmail.com' })).statusCode).toBe(422);
    expect(jsonBody(await post('/api/v1/students/open/code', { matricNumber: KUNLE_JAMB }))).toMatchObject({ email: 'kunle.adeyemi@gmail.com' });
    expect(sent.at(-1)).toMatchObject({ to: 'kunle.adeyemi@gmail.com', purpose: 'open_jamb' });
    const opened = await post('/api/v1/students/open', { matricNumber: KUNLE_JAMB, code: lastCode() });
    expect(opened.statusCode).toBe(201);
    expect(jsonBody(opened)).toMatchObject({ startingPassword: `LASU${KUNLE_JAMB}ADEYEMI` });
    const kunle = sessionCookie(opened.headers);
    expect(jsonBody(await get('/api/v1/students/me/setup', kunle))).toMatchObject({
      numberKind: 'jamb', studentNumber: KUNLE_JAMB, jambNumber: KUNLE_JAMB, emailKind: 'personal', emailVerified: true, lasuEmail: 'kunle.adeyemi@gmail.com',
    });
    // The confirmed personal email counts like a LASU one: the account is open and cannot be taken over.
    expect(await entryOf(KUNLE_JAMB)).toMatchObject({ stage: 'ready' });
    expect(jsonBody(await post('/api/v1/students/lookup', { matricNumber: KUNLE_JAMB }))).toMatchObject({ hasAccount: true, accountStatus: 'open' });
    expect((await post('/api/v1/auth/login', { email: KUNLE_JAMB, password: `lasu ${KUNLE_JAMB} adeyemi` })).statusCode).toBe(200);

    // Ngozi has no email on the list: she types a personal one; a LASU-only rule would lock her out.
    const noEmail = await post('/api/v1/students/open/code', { matricNumber: NGOZI_JAMB });
    expect(noEmail.statusCode).toBe(422);
    expect(jsonBody(noEmail).detail).toContain('personal email stands in');
    expect((await post('/api/v1/students/open/code', { matricNumber: NGOZI_JAMB, email: 'not-an-email' })).statusCode).toBe(422);
    expect((await post('/api/v1/students/open/code', { matricNumber: NGOZI_JAMB, email: 'ngozi.eze@yahoo.com' })).statusCode).toBe(200);
    // A student on a matric number still needs the LASU email.
    expect((await post('/api/v1/students/open/code', { matricNumber: '240591010', email: 'emeka@gmail.com' })).statusCode).toBe(422);

    // 3. Lectures go on: the lecturer adds Kunle and Ngozi by hand with their JAMB numbers.
    const lecturer = sessionCookie((await post('/api/v1/auth/login', { email: LECTURER_EMAIL, password: LECTURER_PASSWORD })).headers);
    expect((await post('/api/v1/lecture/course-catalog', { code: 'CSC 301', title: 'Operating Systems', units: 3 }, lecturer)).statusCode).toBe(201);
    const created = await post('/api/v1/lecture/sessions', { courseCode: 'CSC 301', courseTitle: 'Operating Systems', durationMinutes: 60, qrMode: 'static' }, lecturer);
    expect(created.statusCode).toBe(201);
    const sessionId = String(jsonBody(created).id);
    expect((await post(`/api/v1/lecture/sessions/${sessionId}/attendees`, { fullName: 'Kunle Adeyemi', matricNumber: KUNLE_JAMB }, lecturer)).statusCode).toBe(201);
    expect((await post(`/api/v1/lecture/sessions/${sessionId}/attendees`, { fullName: 'Ngozi Eze', matricNumber: '12345678 hc' }, lecturer)).statusCode).toBe(201);
    const short = await post(`/api/v1/lecture/sessions/${sessionId}/attendees`, { fullName: 'Short Number', matricNumber: '2025300749JA' }, lecturer);
    expect(short.statusCode).toBe(422);
    const attendance = async (number: string) => Number((await client.query<{ count: number }>(
      'SELECT count(*)::int AS count FROM lecture_attendance WHERE matric_number = $1', [number],
    )).rows[0]!.count);
    expect(await attendance(KUNLE_JAMB)).toBe(1);

    // 4. Kunle's matric number and LASU email arrive: he adds them himself, with a code to the LASU email.
    const badYear = await post('/api/v1/students/me/matric/code', { matricNumber: '210591050', email: 'kunle.adeyemi@st.lasu.edu.ng' }, kunle);
    expect(badYear.statusCode).toBe(422);
    expect((await post('/api/v1/students/me/matric/code', { matricNumber: '250591050', email: 'kunle@gmail.com' }, kunle)).statusCode).toBe(422);
    // A classmate's matric number on the same list cannot be taken (the names differ).
    const classmate = await post('/api/v1/students/me/matric/code', { matricNumber: '240591010', email: 'kunle.adeyemi@st.lasu.edu.ng' }, kunle);
    expect(classmate.statusCode).toBe(409);
    expect(jsonBody(classmate).detail).toContain('for another student (Emeka Okon)');
    later();
    expect((await post('/api/v1/students/me/matric/code', { matricNumber: '250591050', email: 'kunle.adeyemi@st.lasu.edu.ng' }, kunle)).statusCode).toBe(200);
    expect(sent.at(-1)).toMatchObject({ to: 'kunle.adeyemi@st.lasu.edu.ng', purpose: 'matric' });
    // The code is bound to the matric number it was asked for.
    expect((await post('/api/v1/students/me/matric', { matricNumber: '250591051', email: 'kunle.adeyemi@st.lasu.edu.ng', code: lastCode() }, kunle)).statusCode).toBe(400);
    const switched = await post('/api/v1/students/me/matric', { matricNumber: '250591050', email: 'kunle.adeyemi@st.lasu.edu.ng', code: lastCode() }, kunle);
    expect(switched.statusCode).toBe(200);
    expect(jsonBody(switched)).toEqual({ status: 'switched', matricNumber: '250591050', previousNumber: KUNLE_JAMB, email: 'kunle.adeyemi@st.lasu.edu.ng', attendanceMoved: 1 });
    expect(notices.at(-1)).toMatchObject({ to: 'kunle.adeyemi@gmail.com', kind: 'matric_added' });
    expect(await attendance(KUNLE_JAMB)).toBe(0);
    expect(await attendance('250591050')).toBe(1);
    expect(jsonBody(await get('/api/v1/students/me/setup', kunle))).toMatchObject({
      numberKind: 'matric', studentNumber: '250591050', jambNumber: KUNLE_JAMB, emailKind: 'lasu', emailVerified: true,
    });
    expect(await entryOf('250591050')).toMatchObject({ numberKind: 'matric', jambNumber: KUNLE_JAMB, lasuEmail: 'kunle.adeyemi@st.lasu.edu.ng', stage: 'ready' });
    // The old JAMB number still signs in and is pointed to the matric number on the sign-up page.
    expect((await post('/api/v1/auth/login', { email: KUNLE_JAMB, password: `LASU${KUNLE_JAMB}ADEYEMI` })).statusCode).toBe(200);
    expect((await post('/api/v1/auth/login', { email: '250591050', password: `LASU${KUNLE_JAMB}ADEYEMI` })).statusCode).toBe(200);
    expect(jsonBody(await post('/api/v1/students/lookup', { matricNumber: KUNLE_JAMB }))).toEqual({ status: 'replaced', matricNumber: KUNLE_JAMB, replacedBy: '250591050' });
    expect((await post('/api/v1/students/me/matric/code', { matricNumber: '250591050', email: 'kunle.adeyemi@st.lasu.edu.ng' }, kunle)).statusCode).toBe(409);
    const history = jsonBody(await get(listUrl, admin)).history as Array<{ action: string }>;
    expect(history.map((item) => item.action)).toContain('student_number_switched');
    // A password reset cannot go back to the guessable starting password made from either number.
    later();
    expect((await post('/api/v1/students/password/code', { matricNumber: '250591050' })).statusCode).toBe(200);
    for (const number of [KUNLE_JAMB, '250591050']) {
      const guessable = await post('/api/v1/students/password', { matricNumber: '250591050', code: lastCode(), password: `lasu ${number} adeyemi` });
      expect(guessable.statusCode).toBe(422);
      expect(jsonBody(guessable).detail).toMatch(/not the starting one/);
    }

    // 5. The HOC uploads the official list with a JAMB column: Ngozi gets her matric number,
    //    and the lecturer's hand-typed record follows her even though she has no account yet.
    const official = [{ matricNumber: '250591060', jambNumber: NGOZI_JAMB, surname: 'Eze', firstName: 'Ngozi' }];
    const officialPreview = jsonBody(await post('/api/v1/class-lists/import', { departmentId: ids.department, entryYear: 2024, rows: official, apply: false }, admin));
    expect(officialPreview).toMatchObject({ added: 0, updated: 1, switched: 1 });
    expect(officialPreview.problems).toEqual([expect.objectContaining({ kind: 'warning', message: `Gets the matric number 250591060 in place of JAMB number ${NGOZI_JAMB}.` })]);
    expect(jsonBody(await post('/api/v1/class-lists/import', { departmentId: ids.department, entryYear: 2024, rows: official, apply: true }, admin)))
      .toMatchObject({ applied: true, switched: 1, updated: 1, added: 0 });
    expect(await entryOf('250591060')).toMatchObject({ numberKind: 'matric', jambNumber: NGOZI_JAMB });
    expect(await attendance('250591060')).toBe(1);
    // A JAMB column that disagrees with the list is refused.
    const clash = jsonBody(await post('/api/v1/class-lists/import', {
      departmentId: ids.department, entryYear: 2024, rows: [{ matricNumber: '250591061', jambNumber: NGOZI_JAMB, surname: 'Eze', firstName: 'Ngozi' }], apply: false,
    }, admin));
    expect(clash.problems).toEqual([expect.objectContaining({ kind: 'error', message: expect.stringContaining('whose matric number is 250591060') })]);

    // 6. Bola opens his account on his JAMB number with a setup code, then the HOC adds his matric
    //    number as a separate row (warned as a probable twin). Bola folds it in himself.
    const bolaEntry = await entryOf(BOLA_JAMB);
    const setup = jsonBody(await post(`/api/v1/class-lists/entries/${String(bolaEntry.id)}/setup-code`, {}, admin));
    const bolaOpened = await post('/api/v1/students/open/setup-code', { matricNumber: BOLA_JAMB, setupCode: setup.code, email: 'bola.ade@gmail.com' });
    expect(bolaOpened.statusCode).toBe(201);
    const bola = sessionCookie(bolaOpened.headers);
    expect(jsonBody(await get('/api/v1/students/me/setup', bola))).toMatchObject({ numberKind: 'jamb', vouched: true, emailVerified: false });
    const twin = jsonBody(await post('/api/v1/class-lists/import', {
      departmentId: ids.department, entryYear: 2024, rows: [{ matricNumber: '250591070', surname: 'Ade', firstName: 'Bola', lasuEmail: 'bola.ade@st.lasu.edu.ng' }], apply: true,
    }, admin));
    expect(twin.problems).toEqual([expect.objectContaining({ kind: 'warning', message: expect.stringContaining(`already on this list by JAMB number ${BOLA_JAMB}`) })]);
    const before = (await entries()).length;
    expect((await post('/api/v1/students/me/matric/code', { matricNumber: '250591070', email: 'bola@st.lasu.edu.ng' }, bola)).statusCode).toBe(422);
    later();
    expect((await post('/api/v1/students/me/matric/code', { matricNumber: '250591070', email: 'bola.ade@st.lasu.edu.ng' }, bola)).statusCode).toBe(200);
    expect(jsonBody(await post('/api/v1/students/me/matric', { matricNumber: '250591070', email: 'bola.ade@st.lasu.edu.ng', code: lastCode() }, bola)))
      .toMatchObject({ status: 'switched', matricNumber: '250591070', previousNumber: BOLA_JAMB });
    expect((await entries()).length).toBe(before - 1);
    expect(await entryOf('250591070')).toMatchObject({ jambNumber: BOLA_JAMB, userId: expect.any(String), stage: 'ready' });

    // 7. A HOC edit switches an unlinked JAMB entry, and a JAMB number already replaced cannot come back.
    const fresh = jsonBody(await post('/api/v1/class-lists/import', {
      departmentId: ids.department, entryYear: 2024, rows: [{ matricNumber: '202511122233CE', surname: 'Bello', firstName: 'Musa', lasuEmail: 'musa@gmail.com' }], apply: true,
    }, admin));
    expect(fresh).toMatchObject({ applied: true, added: 1 });
    const musa = await entryOf('202511122233CE');
    const edited = await post(`/api/v1/class-lists/entries/${String(musa.id)}`, { matricNumber: '250591080' }, admin);
    expect(edited.statusCode).toBe(200);
    // The personal email stood in for a LASU one, so it is cleared with the switch.
    expect(jsonBody(edited)).toMatchObject({ matricNumber: '250591080', numberKind: 'matric', jambNumber: '202511122233CE', lasuEmail: null });
    const reused = jsonBody(await post('/api/v1/class-lists/import', {
      departmentId: ids.department, entryYear: 2024, rows: [{ matricNumber: '202511122233CE', surname: 'Bello', firstName: 'Musa' }], apply: false,
    }, admin));
    expect(reused.problems).toEqual([expect.objectContaining({ kind: 'error', message: expect.stringContaining('Use 250591080') })]);
  } finally {
    await client.close();
  }
}, 120_000);
