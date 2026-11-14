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
import { FaceVerifier, turnForTicket } from '../students/face.js';
import { PostgresStudentRepository } from '../students/postgres-repository.js';
import { StudentService } from '../students/service.js';
import type { StudentEmailCodeEmail } from '../email/transport.js';
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
import { capture, fakeEngine, photo } from './fake-face.js';

/**
 * Students open accounts from the class list their HOC uploaded: matric
 * number → code to the LASU email → account with the LASU-style starting
 * password → face registration; every check-in then confirms the face.
 *
 * The face models are replaced by a stand-in that reads what a "photo"
 * shows from the photo itself, so the rules around them (poses, liveness,
 * matching, duplicates) are tested without camera images.
 */

const ADMIN_ID = 'c7777777-7777-4777-8777-777777777777';
const ADMIN_EMAIL = 'admin@e2e.invalid';
const ADMIN_PASSWORD = 'e2e-admin-passphrase';

it('opens student accounts from the class list and checks their face at check-in', async () => {
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
    let clock = new Date();
    const now = () => clock;
    const auth = new StudentAuthService({ repository: new PostgresAuthRepository(database), institutionSlug: INSTITUTION_SLUG });
    const students = new StudentService({
      repository: new PostgresStudentRepository(database),
      institutionSlug: INSTITUTION_SLUG,
      emailSender: { sendStudentEmailCode: async (email) => { sent.push(email); } },
      faces: new FaceVerifier({ engine: async () => fakeEngine }),
      now,
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
        faces: students,
      }),
    });
    const post = (url: string, payload: unknown, cookie?: string) =>
      server.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, ...(cookie ? { headers: { cookie } } : {}) });
    const get = (url: string, cookie?: string) => server.inject({ method: 'GET', url, ...(cookie ? { headers: { cookie } } : {}) });
    const lastCode = () => {
      const last = sent.at(-1);
      if (!last) throw new Error('no code sent');
      return last.code;
    };

    // Typing your own details is retired: accounts come from the class list.
    const retired = await post('/api/v1/auth/register', { displayName: 'Self Typed', email: 'x@e2e.invalid', matricNumber: '240591009', password: 'self-typed-passphrase' });
    expect(retired.statusCode).toBe(410);

    const adminCookie = sessionCookie((await post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).headers);

    // A student who opened an account the old way, before the list existed.
    const legacy = await auth.registerStudent({ displayName: 'tunde bakare', email: 'tunde.personal@e2e.invalid', matricNumber: '240591003', password: 'tunde-old-passphrase' });

    // 1. The administrator uploads the 2024 set's list for the department (on the HOC's behalf).
    const lists = jsonBody(await get('/api/v1/class-lists', adminCookie));
    expect(lists.departments).toEqual([expect.objectContaining({ id: ids.department, name: 'Electronic and Computer Engineering' })]);
    const rows = [
      { matricNumber: '240591001', surname: 'ODEJOBI', firstName: 'abraham', middleName: 'oluwaseun', lasuEmail: 'abraham.odejobi@st.lasu.edu.ng' },
      { matricNumber: '240 591 002', surname: 'Okafor', firstName: 'Chioma', middleName: '' },
      { matricNumber: '240591003', surname: 'Bakare', firstName: 'Tunde', middleName: null },
      // Direct Entry: admitted in 2025 at 200 level into the 2024 set; the level is worked out.
      { matricNumber: '250591004', surname: 'Musa', firstName: 'Fatima', lasuEmail: 'fatima@gmail.com' },
    ];
    const withErrors = await post('/api/v1/class-lists/import', {
      departmentId: ids.department,
      entryYear: 2024,
      rows: [...rows, { matricNumber: '12345', surname: 'Bad', firstName: 'Row' }, { matricNumber: '240591001', surname: 'Dupe', firstName: 'Row' }],
      apply: true,
    }, adminCookie);
    expect(withErrors.statusCode).toBe(200);
    const errorResult = jsonBody(withErrors);
    expect(errorResult.applied).toBe(false);
    expect(errorResult.problems).toEqual(expect.arrayContaining([
      expect.objectContaining({ row: 5, kind: 'error' }),
      expect.objectContaining({ row: 6, kind: 'error', message: 'Duplicate: the same matric number is on row 1. Each student can be on the list only once.' }),
      expect.objectContaining({ row: 4, kind: 'warning' }),
    ]));

    const preview = jsonBody(await post('/api/v1/class-lists/import', { departmentId: ids.department, entryYear: 2024, rows, apply: false }, adminCookie));
    expect(preview).toMatchObject({ applied: false, added: 4, updated: 0 });
    const applied = jsonBody(await post('/api/v1/class-lists/import', { departmentId: ids.department, entryYear: 2024, rows, apply: true }, adminCookie));
    expect(applied).toMatchObject({ applied: true, added: 4, updated: 0, unchanged: 0, linked: 1 });
    const again = jsonBody(await post('/api/v1/class-lists/import', { departmentId: ids.department, entryYear: 2024, rows, apply: true }, adminCookie));
    expect(again).toMatchObject({ applied: true, added: 0, unchanged: 4 });

    const list = jsonBody(await get(`/api/v1/class-lists?departmentId=${ids.department}&entryYear=2024`, adminCookie));
    const entries = list.entries as Array<Record<string, unknown>>;
    expect(entries.map((entry) => entry.matricNumber)).toEqual(['240591003', '250591004', '240591001', '240591002']);
    expect(entries.find((entry) => entry.matricNumber === '240591001')).toMatchObject({ surname: 'Odejobi', firstName: 'Abraham', middleName: 'Oluwaseun', stage: 'not_joined' });
    expect(entries.find((entry) => entry.matricNumber === '250591004')).toMatchObject({ entryLevel: 200, lasuEmail: null });
    // The older account was matched by matric number and now carries the list's name.
    expect(entries.find((entry) => entry.matricNumber === '240591003')).toMatchObject({ stage: 'joined', userId: legacy.student.id });
    expect(jsonBody(await get('/api/v1/auth/session', `lasuatos_session=${legacy.token}`)).account).toMatchObject({ displayName: 'Tunde Bakare' });
    expect((list.history as Array<{ action: string }>).length).toBeGreaterThan(0);

    // 2. Abraham types only his matric number and sees who it belongs to (masked).
    const notListed = jsonBody(await post('/api/v1/students/lookup', { matricNumber: '240591099' }));
    expect(notListed).toEqual({ status: 'not_found', matricNumber: '240591099' });
    const found = jsonBody(await post('/api/v1/students/lookup', { matricNumber: '240 591 001' }));
    expect(found).toMatchObject({ status: 'found', fullName: 'ODEJOBI Abraham Oluwaseun', departmentName: 'Electronic and Computer Engineering', hasAccount: false });

    // The code goes to the LASU email the HOC listed; another address is refused.
    const otherEmail = await post('/api/v1/students/open/code', { matricNumber: '240591001', email: 'someone.else@st.lasu.edu.ng' });
    expect(otherEmail.statusCode).toBe(422);
    const codeSent = await post('/api/v1/students/open/code', { matricNumber: '240591001' });
    expect(codeSent.statusCode).toBe(200);
    expect(jsonBody(codeSent)).toMatchObject({ status: 'sent', email: 'ab••••••••@st.lasu.edu.ng' });
    expect(sent.at(-1)).toMatchObject({ to: 'abraham.odejobi@st.lasu.edu.ng', purpose: 'open' });
    expect((await post('/api/v1/students/open/code', { matricNumber: '240591001' })).statusCode).toBe(429);

    const wrongCode = lastCode() === '000000' ? '111111' : '000000';
    const wrong = await post('/api/v1/students/open', { matricNumber: '240591001', code: wrongCode });
    expect(wrong.statusCode).toBe(400);
    expect(jsonBody(wrong).detail).toBe('That code is not right. 4 tries left.');
    const opened = await post('/api/v1/students/open', { matricNumber: '240591001', code: lastCode() });
    expect(opened.statusCode).toBe(201);
    expect(jsonBody(opened)).toMatchObject({
      status: 'opened',
      startingPassword: 'LASU240591001ODEJOBI',
      student: { displayName: 'Abraham Oluwaseun Odejobi', email: 'abraham.odejobi@st.lasu.edu.ng', matricNumber: '240591001', matricNumberVerified: true },
    });
    const abrahamCookie = sessionCookie(opened.headers);
    expect((await post('/api/v1/students/open', { matricNumber: '240591001', code: lastCode() })).statusCode).toBe(409);

    // The starting password works however it is typed.
    const signIn = await post('/api/v1/auth/login', { email: '240591001', password: 'lasu 240591001 odejobi' });
    expect(signIn.statusCode).toBe(200);

    const setup = jsonBody(await get('/api/v1/students/me/setup', abrahamCookie));
    expect(setup).toMatchObject({ emailVerified: true, faceRequired: true, faceRegistered: false, defaultPassword: true, complete: false });
    expect(setup.classList).toMatchObject({ surname: 'Odejobi', levelLabel: expect.stringMatching(/Level/), setLabel: '2024/2025 set' });

    // 3. Face registration: three photos, one person, live.
    expect((await post('/api/v1/students/me/face', { consent: true, frames: capture('abraham', ['front', 'left']) }, abrahamCookie)).statusCode).toBe(422);
    const turnedWrongWay = await post('/api/v1/students/me/face', {
      consent: true,
      frames: [...capture('abraham', ['front', 'left']), { pose: 'right', image: photo({ person: 'abraham', yaw: -0.4 }) }],
    }, abrahamCookie);
    expect(turnedWrongWay.statusCode).toBe(422);
    expect(jsonBody(turnedWrongWay).detail).toMatch(/to your right/);
    const mixed = await post('/api/v1/students/me/face', { consent: true, frames: [...capture('abraham', ['front', 'left']), ...capture('someone', ['right'])] }, abrahamCookie);
    expect(jsonBody(mixed).detail).toMatch(/same person/);
    const screen = await post('/api/v1/students/me/face', { consent: true, frames: capture('abraham', undefined, { live: 0.1 }) }, abrahamCookie);
    expect(jsonBody(screen).detail).toMatch(/live face/);
    const enrolled = await post('/api/v1/students/me/face', { consent: true, frames: capture('abraham') }, abrahamCookie);
    expect(enrolled.statusCode).toBe(201);
    expect((await post('/api/v1/students/me/face', { consent: true, frames: capture('abraham') }, abrahamCookie)).statusCode).toBe(409);
    expect(jsonBody(await get('/api/v1/students/me/setup', abrahamCookie))).toMatchObject({ faceRegistered: true, complete: true });
    expect((await get('/api/v1/students/me/face/photo', abrahamCookie)).headers['content-type']).toBe('image/jpeg');

    // Chioma opens her account (typing her LASU email; the list had none) and
    // tries to register Abraham's face: refused as a duplicate.
    clock = new Date(clock.getTime() + 61_000);
    expect((await post('/api/v1/students/open/code', { matricNumber: '240591002' })).statusCode).toBe(422);
    expect((await post('/api/v1/students/open/code', { matricNumber: '240591002', email: 'abraham.odejobi@st.lasu.edu.ng' })).statusCode).toBe(409);
    expect((await post('/api/v1/students/open/code', { matricNumber: '240591002', email: 'Chioma.Okafor@st.lasu.edu.ng' })).statusCode).toBe(200);
    const chiomaOpened = await post('/api/v1/students/open', { matricNumber: '240591002', code: lastCode() });
    expect(chiomaOpened.statusCode).toBe(201);
    expect(jsonBody(chiomaOpened).startingPassword).toBe('LASU240591002OKAFOR');
    const chiomaCookie = sessionCookie(chiomaOpened.headers);
    const duplicate = await post('/api/v1/students/me/face', { consent: true, frames: capture('abraham', undefined, { jitter: 7 }) }, chiomaCookie);
    expect(duplicate.statusCode).toBe(409);
    expect(jsonBody(duplicate).detail).toMatch(/already registered to another student/);
    expect((await post('/api/v1/students/me/face', { consent: true, frames: capture('chioma') }, chiomaCookie)).statusCode).toBe(201);

    // 4. The older account confirms its LASU email from setup.
    const legacyCookie = `lasuatos_session=${legacy.token}`;
    expect(jsonBody(await get('/api/v1/students/me/setup', legacyCookie))).toMatchObject({ emailVerified: false, complete: false, classList: { surname: 'Bakare' } });
    expect((await post('/api/v1/students/me/email-code', { email: 'tunde@gmail.com' }, legacyCookie)).statusCode).toBe(422);
    expect((await post('/api/v1/students/me/email-code', { email: 'tunde.bakare@st.lasu.edu.ng' }, legacyCookie)).statusCode).toBe(200);
    expect(sent.at(-1)).toMatchObject({ purpose: 'move' });
    expect(jsonBody(await post('/api/v1/students/me/email-verify', { code: lastCode() }, legacyCookie))).toEqual({ status: 'verified', email: 'tunde.bakare@st.lasu.edu.ng' });
    expect(jsonBody(await get('/api/v1/students/me/setup', legacyCookie))).toMatchObject({ emailVerified: true, lasuEmail: 'tunde.bakare@st.lasu.edu.ng', defaultPassword: false });

    // 5. A HOC manages their own department and set only.
    await client.query(
      `INSERT INTO class_representatives (institution_id, student_user_id, role, faculty_id, department_id, entry_year, appointed_by_user_id) VALUES ($1, $2, 'hoc', $3, $4, 2024, $5)`,
      [ids.institution, jsonBody(chiomaOpened).student ? (jsonBody(chiomaOpened).student as { id: string }).id : '', ids.faculty, ids.department, ADMIN_ID],
    );
    const hocList = jsonBody(await get('/api/v1/class-lists', chiomaCookie));
    expect(hocList).toMatchObject({ fixedDepartmentId: ids.department, fixedEntryYear: 2024, canResetFaces: false, counts: { total: 4, ready: 2 } });
    expect((await post('/api/v1/class-lists/import', { departmentId: ids.department, entryYear: 2025, rows, apply: false }, chiomaCookie)).statusCode).toBe(403);
    const fatima = (hocList.entries as Array<{ id: string; matricNumber: string }>).find((entry) => entry.matricNumber === '250591004')!;
    const corrected = await post(`/api/v1/class-lists/entries/${fatima.id}`, { firstName: 'fatimah', middleName: 'zainab' }, chiomaCookie);
    expect(jsonBody(corrected)).toMatchObject({ firstName: 'Fatimah', middleName: 'Zainab' });
    const abrahamEntry = (hocList.entries as Array<{ id: string; matricNumber: string }>).find((entry) => entry.matricNumber === '240591001')!;
    expect((await post(`/api/v1/class-lists/entries/${abrahamEntry.id}/remove`, {}, chiomaCookie)).statusCode).toBe(409);
    expect((await post(`/api/v1/class-lists/entries/${abrahamEntry.id}/reset-face`, {}, chiomaCookie)).statusCode).toBe(403);
    expect((await get(`/api/v1/class-lists/entries/${abrahamEntry.id}/photo`, chiomaCookie)).statusCode).toBe(200);
    expect((await get('/api/v1/class-lists', abrahamCookie)).statusCode).toBe(403);

    // 6. Check-in confirms the face: look at the camera, then turn the way asked.
    const lecturerCookie = sessionCookie((await post('/api/v1/auth/login', { email: LECTURER_EMAIL, password: LECTURER_PASSWORD })).headers);
    expect((await post('/api/v1/lecture/course-catalog', { code: 'ECE 201', title: 'Circuit Theory', units: 3 }, lecturerCookie)).statusCode).toBe(201);
    const session = jsonBody(await post('/api/v1/lecture/sessions', { courseCode: 'ECE 201', courseTitle: 'Circuit Theory', durationMinutes: 60, qrMode: 'dynamic' }, lecturerCookie));
    const frame = jsonBody(await get(`/api/v1/lecture/sessions/${String(session.id)}/qr`, lecturerCookie));
    const challenge = String(frame.path).split('#')[1] ?? '';
    const resolved = jsonBody(await post('/api/v1/lecture/resolve', { challenge }, abrahamCookie));
    const ticket = String(resolved.ticket);
    const turn = turnForTicket(ticket);
    expect(resolved.face).toEqual({ required: true, turn, registered: true });
    const other = turn === 'left' ? 'right' : 'left';

    const noFace = await post('/api/v1/lecture/check-in', { ticket }, abrahamCookie);
    expect(noFace.statusCode).toBe(428);
    const wrongTurn = await post('/api/v1/lecture/check-in', { ticket, face: { frames: capture('abraham', ['front', other]) } }, abrahamCookie);
    expect(wrongTurn.statusCode).toBe(422);
    const impostor = await post('/api/v1/lecture/check-in', { ticket, face: { frames: capture('chioma', ['front', turn]) } }, abrahamCookie);
    expect(impostor.statusCode).toBe(403);
    expect(jsonBody(impostor).detail).toMatch(/does not match/);
    const checkedIn = await post('/api/v1/lecture/check-in', { ticket, face: { frames: capture('abraham', ['front', turn], { jitter: 3 }) } }, abrahamCookie);
    expect(checkedIn.statusCode).toBe(201);
    expect(jsonBody(checkedIn)).toMatchObject({ status: 'checked_in', fullName: 'Abraham Oluwaseun Odejobi', faceScore: expect.any(Number) });
    expect(jsonBody(checkedIn).faceScore as number).toBeGreaterThan(0.6);
    // Already present: no second face check needed.
    expect(jsonBody(await post('/api/v1/lecture/check-in', { ticket }, abrahamCookie)).status).toBe('already_checked_in');

    // Tunde has not registered a face yet: told to do so first.
    const tundeTicket = String(jsonBody(await post('/api/v1/lecture/resolve', { challenge }, legacyCookie)).ticket);
    const tunde = await post('/api/v1/lecture/check-in', { ticket: tundeTicket, face: { frames: capture('tunde', ['front', turnForTicket(tundeTicket)]) } }, legacyCookie);
    expect(tunde.statusCode).toBe(409);
    expect(jsonBody(tunde).detail).toMatch(/Register your face/);

    const register = jsonBody(await get(`/api/v1/lecture/sessions/${String(session.id)}`, lecturerCookie));
    const clearAttendee = (register.attendees as Array<Record<string, unknown>>)[0]!;
    expect(clearAttendee).toMatchObject({ fullName: 'Abraham Oluwaseun Odejobi', faceScore: expect.any(Number), faceNeedsReview: false });
    // A clear match keeps no photo.
    expect((await get(`/api/v1/lecture/sessions/${String(session.id)}/attendees/${String(clearAttendee.id)}/face-photo`, lecturerCookie)).statusCode).toBe(404);

    // A close match (0.52–0.60) still counts, but one photo is kept for the session taker to compare.
    const second = jsonBody(await post('/api/v1/lecture/sessions', { courseCode: 'ECE 201', courseTitle: 'Circuit Theory', durationMinutes: 60, qrMode: 'dynamic' }, lecturerCookie));
    const secondChallenge = String(jsonBody(await get(`/api/v1/lecture/sessions/${String(second.id)}/qr`, lecturerCookie)).path).split('#')[1] ?? '';
    const secondTicket = String(jsonBody(await post('/api/v1/lecture/resolve', { challenge: secondChallenge }, abrahamCookie)).ticket);
    const close = await post('/api/v1/lecture/check-in', {
      ticket: secondTicket,
      face: { frames: capture('abraham', ['front', turnForTicket(secondTicket)], { jitter: 5, blend: { person: 'chioma', weight: 0.57 } }) },
    }, abrahamCookie);
    expect(close.statusCode).toBe(201);
    expect(jsonBody(close).faceScore as number).toBeGreaterThanOrEqual(0.52);
    expect(jsonBody(close).faceScore as number).toBeLessThan(0.6);
    const secondRegister = jsonBody(await get(`/api/v1/lecture/sessions/${String(second.id)}`, lecturerCookie));
    const closeAttendee = (secondRegister.attendees as Array<Record<string, unknown>>)[0]!;
    expect(closeAttendee).toMatchObject({ faceNeedsReview: true });
    const photoUrl = `/api/v1/lecture/sessions/${String(second.id)}/attendees/${String(closeAttendee.id)}/face-photo`;
    const kept = await get(photoUrl, lecturerCookie);
    expect(kept.statusCode).toBe(200);
    expect(kept.headers['content-type']).toBe('image/jpeg');
    expect(kept.headers['cache-control']).toBe('private, no-store');
    expect(kept.body).toBe('portrait:abraham');
    // Only people who can open the session see it.
    expect((await get(photoUrl, abrahamCookie)).statusCode).toBe(404);
    expect((await get(photoUrl)).statusCode).toBe(401);

    // 7. Changing the starting password; an administrator can reset a face.
    const changed = await post('/api/v1/auth/password', { currentPassword: 'LASU240591001ODEJOBI', newPassword: 'a-new-strong-passphrase' }, abrahamCookie);
    expect(changed.statusCode).toBeLessThan(300);
    expect(jsonBody(await get('/api/v1/students/me/setup', abrahamCookie))).toMatchObject({ defaultPassword: false });
    expect((await post('/api/v1/auth/login', { email: '240591001', password: 'lasu240591001odejobi' })).statusCode).toBe(401);
    expect((await post(`/api/v1/class-lists/entries/${abrahamEntry.id}/reset-face`, {}, adminCookie)).statusCode).toBe(200);
    expect(jsonBody(await get('/api/v1/students/me/setup', abrahamCookie))).toMatchObject({ faceRegistered: false, complete: false });

    // Every change is in the append-only audit trail.
    const audit = await client.query<{ action: string }>('SELECT action FROM student_audit_events ORDER BY created_at');
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining([
      'class_list_imported', 'account_opened', 'face_registered', 'face_duplicate_refused', 'email_confirmed', 'class_list_entry_updated', 'face_check_failed', 'face_reset',
    ]));
    await expect(client.query('DELETE FROM student_audit_events')).rejects.toThrow(/append-only/);
    await server.close();
  } finally {
    await client.close();
  }
}, 60_000);
