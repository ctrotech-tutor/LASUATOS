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
 * Lecture sessions over HTTP against embedded PostgreSQL: a lecturer opens a
 * session with only a course code and title, students without accounts check
 * in by scanning or typing the code, a signed-in student is recognised, the
 * list can be corrected, and an administrator → GHOC → HOC chain can take
 * attendance too.
 */

const ADMIN_ID = 'c7777777-7777-4777-8777-777777777777';
const ADMIN_EMAIL = 'admin@e2e.invalid';
const ADMIN_PASSWORD = 'e2e-admin-passphrase';

it('runs lecture sessions, guest check-in and class representatives over HTTP', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    await seedLecturerFixture(client);
    await client.query(
      `INSERT INTO users (id, institution_id, email, display_name, password_hash, status)
       VALUES ($1, $2, $3, 'E2E Admin', $4, 'active')`,
      [ADMIN_ID, ids.institution, ADMIN_EMAIL, await hashPassword(ADMIN_PASSWORD)],
    );
    await client.query(
      `INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, 'institution_administrator', 'institution', $2)`,
      [ADMIN_ID, ids.institution],
    );

    const database = drizzle(client) as unknown as DatabaseClient;
    const server = buildServer({
      logger: false,
      secureCookies: false,
      auth: new StudentAuthService({ repository: new PostgresAuthRepository(database), institutionSlug: INSTITUTION_SLUG }),
      lecture: new LectureService({ repository: new PostgresLectureRepository(database) }),
    });
    const post = (url: string, payload: unknown, cookie?: string) =>
      server.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, ...(cookie ? { headers: { cookie } } : {}) });
    const get = (url: string, cookie?: string) => server.inject({ method: 'GET', url, ...(cookie ? { headers: { cookie } } : {}) });

    const lecturerCookie = sessionCookie((await post('/api/v1/auth/login', { email: LECTURER_EMAIL, password: LECTURER_PASSWORD })).headers);
    expect(jsonBody(await get('/api/v1/lecture/capabilities', lecturerCookie))).toMatchObject({ canTakeAttendance: true, role: 'lecturer' });

    // 1. Course code and title only; today's date and the end time are set automatically.
    const created = await post('/api/v1/lecture/sessions', { courseCode: ' ece 201 ', courseTitle: 'Circuit  Theory', durationMinutes: 60, qrMode: 'dynamic' }, lecturerCookie);
    expect(created.statusCode).toBe(201);
    const session = jsonBody(created);
    expect(session).toMatchObject({ courseCode: 'ECE 201', courseTitle: 'Circuit Theory', status: 'open', lecturerName: 'E2E Lecturer', presentCount: 0 });
    const sessionId = String(session.id);

    // 2. A dynamic QR frame: a guest scans it and types a name and matric number.
    const frame = jsonBody(await get(`/api/v1/lecture/sessions/${sessionId}/qr`, lecturerCookie));
    expect(frame.mode).toBe('dynamic');
    const challenge = String(frame.path).split('#')[1] ?? '';
    expect(challenge).toMatch(/^lasu2\./);
    const resolved = await post('/api/v1/lecture/resolve', { challenge });
    expect(resolved.statusCode).toBe(200);
    const resolvedBody = jsonBody(resolved);
    expect(resolvedBody.student).toBeNull();
    expect(resolvedBody.session).toMatchObject({ courseCode: 'ECE 201', courseTitle: 'Circuit Theory' });
    const ticket = String(resolvedBody.ticket);

    const missingName = await post('/api/v1/lecture/check-in', { ticket, matricNumber: '220591001' });
    expect(missingName.statusCode).toBe(422);
    const guest = await post('/api/v1/lecture/check-in', { ticket, fullName: 'Ada  Obi', matricNumber: '220 591 001', deviceToken: 'device-token-aaaaaaaa' });
    expect(guest.statusCode).toBe(201);
    expect(jsonBody(guest)).toMatchObject({ status: 'checked_in', fullName: 'Ada Obi', matricNumber: '220591001' });
    const again = await post('/api/v1/lecture/check-in', { ticket, fullName: 'Ada Obi', matricNumber: '220591001' });
    expect(again.statusCode).toBe(200);
    expect(jsonBody(again).status).toBe('already_checked_in');

    // The 6-character code under the QR code works when the camera does not.
    const typed = await post('/api/v1/lecture/resolve', { code: String(frame.code).toLowerCase() });
    expect(typed.statusCode).toBe(200);
    const sameDevice = await post('/api/v1/lecture/check-in', {
      ticket: jsonBody(typed).ticket, fullName: 'Bayo Ade', matricNumber: '220591002', deviceToken: 'device-token-aaaaaaaa',
    });
    expect(sameDevice.statusCode).toBe(201);
    expect((await post('/api/v1/lecture/resolve', { code: 'ZZZZZZ' })).statusCode).toBe(404);

    // 3. Switch to a printable static QR: the fixed code works, the old rotating QR does not.
    const toStatic = await post(`/api/v1/lecture/sessions/${sessionId}`, { qrMode: 'static' }, lecturerCookie);
    expect(jsonBody(toStatic).qrMode).toBe('static');
    const poster = jsonBody(await get(`/api/v1/lecture/sessions/${sessionId}/qr`, lecturerCookie));
    expect(poster).toMatchObject({ mode: 'static', rotatesAt: null });
    expect(String(poster.path)).toBe(`/a/${String(poster.code)}`);
    expect((await post('/api/v1/lecture/resolve', { challenge })).statusCode).toBe(410);
    const scannedPoster = await post('/api/v1/lecture/resolve', { code: String(poster.code), scanned: true });
    expect(scannedPoster.statusCode).toBe(200);

    // 4. A student who signs up is recognised and marked with their account.
    const registration = await post('/api/v1/auth/register', {
      displayName: 'Chidi Okeke', email: 'chidi@e2e.invalid', matricNumber: '220591010', password: 'chidi-passphrase-1', entryLevel: 100,
    });
    expect(registration.statusCode).toBe(201);
    const studentCookie = sessionCookie(registration.headers);
    const studentResolve = jsonBody(await post('/api/v1/lecture/resolve', { code: String(poster.code), scanned: true }, studentCookie));
    expect(studentResolve.student).toMatchObject({ fullName: 'Chidi Okeke', matricNumber: '220591010' });
    const studentCheckIn = await post('/api/v1/lecture/check-in', { ticket: studentResolve.ticket }, studentCookie);
    expect(studentCheckIn.statusCode).toBe(201);
    expect(jsonBody(studentCheckIn)).toMatchObject({ fullName: 'Chidi Okeke', matricNumber: '220591010' });
    const history = jsonBody(await get('/api/v1/student/lecture-history', studentCookie));
    expect(history.entries).toHaveLength(1);

    // 5. The list shows who came, flags a shared phone, and can be corrected.
    const detail = jsonBody(await get(`/api/v1/lecture/sessions/${sessionId}`, lecturerCookie));
    const attendees = detail.attendees as Array<Record<string, unknown>>;
    expect(attendees.map((item) => item.matricNumber)).toEqual(['220591001', '220591002', '220591010']);
    expect(attendees[0]).toMatchObject({ hasAccount: false, method: 'qr', sharedDeviceCount: 1 });
    expect(attendees[1]).toMatchObject({ method: 'code', sharedDeviceCount: 1 });
    expect(attendees[2]).toMatchObject({ hasAccount: true, sharedDeviceCount: 0 });
    const removed = await post(`/api/v1/lecture/sessions/${sessionId}/attendees/${String(attendees[1]?.id)}`, { reason: 'Not in class' }, lecturerCookie);
    expect(removed.statusCode).toBe(200);
    const blocked = await post('/api/v1/lecture/check-in', { ticket: jsonBody(scannedPoster).ticket, fullName: 'Bayo Ade', matricNumber: '220591002' });
    expect(blocked.statusCode).toBe(409);
    expect(jsonBody(await get(`/api/v1/lecture/sessions/${sessionId}`, lecturerCookie)).session).toMatchObject({ presentCount: 2 });

    // Students cannot open sessions or read another person's list.
    expect((await post('/api/v1/lecture/sessions', { courseCode: 'ECE 201', courseTitle: 'Circuit Theory', durationMinutes: 30, qrMode: 'static' }, studentCookie)).statusCode).toBe(403);
    expect((await get(`/api/v1/lecture/sessions/${sessionId}`, studentCookie)).statusCode).toBe(404);

    // 6. Closing stops further check-ins, even with a code that was valid.
    expect(jsonBody(await post(`/api/v1/lecture/sessions/${sessionId}`, { close: true }, lecturerCookie)).status).toBe('closed');
    expect((await post('/api/v1/lecture/resolve', { code: String(poster.code), scanned: true })).statusCode).toBe(410);
    expect((await post('/api/v1/lecture/check-in', { ticket: jsonBody(scannedPoster).ticket, fullName: 'Late Comer', matricNumber: '220591099' })).statusCode).toBe(410);
    const reopened = jsonBody(await post(`/api/v1/lecture/sessions/${sessionId}`, { extendMinutes: 10 }, lecturerCookie));
    expect(reopened.status).toBe('open');

    // 7. Administrator appoints the student as GHOC of the faculty for the 2022/2023 set.
    const adminCookie = sessionCookie((await post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).headers);
    const lookup = jsonBody(await post('/api/v1/class-reps/lookup', { query: '220 591 010' }, adminCookie));
    expect(lookup).toMatchObject({ fullName: 'Chidi Okeke', entryYear: 2022, currentRole: null });
    const ghoc = await post('/api/v1/class-reps', { studentUserId: lookup.userId, role: 'ghoc', facultyId: ids.faculty, entryYear: 2022 }, adminCookie);
    expect(ghoc.statusCode).toBe(201);
    expect(jsonBody(ghoc)).toMatchObject({ role: 'ghoc', facultyName: 'Faculty of Engineering', setLabel: '2022/2023 set' });
    expect(jsonBody(await get('/api/v1/lecture/capabilities', studentCookie))).toMatchObject({ role: 'ghoc', canManageClassReps: true });

    // The GHOC takes attendance and appoints a HOC for a department, only for their own set.
    const ghocSession = await post('/api/v1/lecture/sessions', { courseCode: 'GNS 101', courseTitle: 'Use of English', durationMinutes: 30, qrMode: 'static' }, studentCookie);
    expect(ghocSession.statusCode).toBe(201);
    expect(jsonBody(ghocSession)).toMatchObject({ creatorRole: 'ghoc', lecturerName: null });
    const hocRegistration = await post('/api/v1/auth/register', {
      displayName: 'Ngozi Eze', email: 'ngozi@e2e.invalid', matricNumber: '220591011', password: 'ngozi-passphrase-1', entryLevel: 100,
    });
    const hocCookie = sessionCookie(hocRegistration.headers);
    const ghocView = jsonBody(await get('/api/v1/class-reps', studentCookie));
    expect(ghocView).toMatchObject({ fixedEntryYear: 2022, faculties: [] });
    const hocLookup = jsonBody(await post('/api/v1/class-reps/lookup', { query: 'ngozi@e2e.invalid' }, studentCookie));
    const hocAppointment = await post('/api/v1/class-reps', {
      studentUserId: hocLookup.userId, role: 'hoc', departmentId: ids.department, entryYear: 2030,
    }, studentCookie);
    expect(hocAppointment.statusCode).toBe(201);
    expect(jsonBody(hocAppointment)).toMatchObject({ role: 'hoc', entryYear: 2022, departmentName: 'Electronic and Computer Engineering' });
    expect((await post('/api/v1/class-reps', { studentUserId: hocLookup.userId, role: 'ghoc', facultyId: ids.faculty, entryYear: 2022 }, studentCookie)).statusCode).toBe(403);
    expect(jsonBody(await get('/api/v1/lecture/capabilities', hocCookie))).toMatchObject({ role: 'hoc', canManageClassReps: false });
    expect((await get('/api/v1/class-reps', hocCookie)).statusCode).toBe(403);

    // Revoking removes the right to take attendance.
    await post(`/api/v1/class-reps/${String(jsonBody(hocAppointment).id)}/revoke`, {}, studentCookie);
    expect(jsonBody(await get('/api/v1/lecture/capabilities', hocCookie))).toMatchObject({ canTakeAttendance: false });

    // The administrator sees every session in the institution.
    const adminList = jsonBody(await get('/api/v1/lecture/sessions', adminCookie));
    expect((adminList.sessions as unknown[]).length).toBe(2);

    // Course register: every student against every session of the course; removed entries do not count.
    const registers = jsonBody(await get('/api/v1/lecture/registers', lecturerCookie));
    expect(registers.courses).toEqual([expect.objectContaining({ courseCode: 'ECE 201', courseTitle: 'Circuit Theory', sessionCount: 1 })]);
    const register = jsonBody(await get('/api/v1/lecture/register?course=ece%20201', lecturerCookie));
    expect(register).toMatchObject({ courseCode: 'ECE 201', sessions: [expect.objectContaining({ presentCount: 2 })] });
    expect((register.students as Array<{ rate: number; present: boolean[] }>).every((row) => row.rate === 100 && row.present.length === 1)).toBe(true);
    expect((await get('/api/v1/lecture/register?course=GNS%20101', lecturerCookie)).statusCode).toBe(404);
    expect((await get('/api/v1/lecture/register?course=ECE%20201', hocCookie)).statusCode).toBe(403);
    expect((await get('/api/v1/lecture/register', lecturerCookie)).statusCode).toBe(400);
  } finally {
    await client.close();
  }
});
