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
    // One phone, one student: Ada's phone cannot mark Bayo present too.
    const sameDevice = await post('/api/v1/lecture/check-in', {
      ticket: jsonBody(typed).ticket, fullName: 'Bayo Ade', matricNumber: '220591002', deviceToken: 'device-token-aaaaaaaa',
    });
    expect(sameDevice.statusCode).toBe(409);
    expect(String(jsonBody(sameDevice).detail)).toContain('their own phone');
    const ownPhone = await post('/api/v1/lecture/check-in', {
      ticket: jsonBody(typed).ticket, fullName: 'Bayo Ade', matricNumber: '220591002', deviceToken: 'device-token-bbbbbbbb',
    });
    expect(ownPhone.statusCode).toBe(201);
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
    expect(history.courses).toEqual([{ courseCode: 'ECE 201', courseTitle: 'Circuit Theory', held: 1, attended: 1, rate: 100 }]);

    // 5. The list shows who came, flags a shared phone, and can be corrected.
    const detail = jsonBody(await get(`/api/v1/lecture/sessions/${sessionId}`, lecturerCookie));
    const attendees = detail.attendees as Array<Record<string, unknown>>;
    expect(attendees.map((item) => item.matricNumber)).toEqual(['220591001', '220591002', '220591010']);
    expect(attendees[0]).toMatchObject({ hasAccount: false, method: 'qr', sharedDeviceCount: 0 });
    expect(attendees[1]).toMatchObject({ method: 'code', sharedDeviceCount: 0 });
    expect(attendees[2]).toMatchObject({ hasAccount: true, sharedDeviceCount: 0 });
    const removed = await post(`/api/v1/lecture/sessions/${sessionId}/attendees/${String(attendees[1]?.id)}`, { reason: 'Not in class' }, lecturerCookie);
    expect(removed.statusCode).toBe(200);
    const blocked = await post('/api/v1/lecture/check-in', { ticket: jsonBody(scannedPoster).ticket, fullName: 'Bayo Ade', matricNumber: '220591002' });
    expect(blocked.statusCode).toBe(409);
    expect(jsonBody(await get(`/api/v1/lecture/sessions/${sessionId}`, lecturerCookie)).session).toMatchObject({ presentCount: 2 });

    // The session taker can add a student by hand (dead phone); it is marked and attributed.
    const added = await post(`/api/v1/lecture/sessions/${sessionId}/attendees`, { fullName: 'Funke  Bello', matricNumber: '220 591 050' }, lecturerCookie);
    expect(added.statusCode).toBe(201);
    expect(jsonBody(added)).toEqual({ status: 'added', fullName: 'Funke Bello', matricNumber: '220591050' });
    expect((await post(`/api/v1/lecture/sessions/${sessionId}/attendees`, { fullName: 'Funke Bello', matricNumber: '220591050' }, lecturerCookie)).statusCode).toBe(409);
    expect((await post(`/api/v1/lecture/sessions/${sessionId}/attendees`, { fullName: 'Fu', matricNumber: '220591051' }, lecturerCookie)).statusCode).toBe(422);
    expect((await post(`/api/v1/lecture/sessions/${sessionId}/attendees`, { fullName: 'Funke Bello', matricNumber: '220591050' }, studentCookie)).statusCode).toBe(404);
    // Adding someone who was removed puts them back.
    expect(jsonBody(await post(`/api/v1/lecture/sessions/${sessionId}/attendees`, { fullName: 'Bayo Ade', matricNumber: '220591002' }, lecturerCookie))).toMatchObject({ status: 'restored' });
    const withManual = jsonBody(await get(`/api/v1/lecture/sessions/${sessionId}`, lecturerCookie));
    expect(withManual.session).toMatchObject({ presentCount: 4 });
    expect((withManual.attendees as Array<Record<string, unknown>>).find((item) => item.matricNumber === '220591050'))
      .toMatchObject({ method: 'manual', addedByName: expect.any(String), hasAccount: false, removed: false });

    // Students cannot open sessions or read another person's list.
    expect((await post('/api/v1/lecture/sessions', { courseCode: 'ECE 201', courseTitle: 'Circuit Theory', durationMinutes: 30, qrMode: 'static' }, studentCookie)).statusCode).toBe(403);
    expect((await get(`/api/v1/lecture/sessions/${sessionId}`, studentCookie)).statusCode).toBe(404);

    // 6. Closing stops further check-ins, even with a code that was valid.
    expect(jsonBody(await post(`/api/v1/lecture/sessions/${sessionId}`, { close: true }, lecturerCookie)).status).toBe('closed');
    expect((await post('/api/v1/lecture/resolve', { code: String(poster.code), scanned: true })).statusCode).toBe(410);
    expect((await post('/api/v1/lecture/check-in', { ticket: jsonBody(scannedPoster).ticket, fullName: 'Late Comer', matricNumber: '220591099' })).statusCode).toBe(410);
    const reopened = jsonBody(await post(`/api/v1/lecture/sessions/${sessionId}`, { extendMinutes: 10 }, lecturerCookie));
    expect(reopened.status).toBe('open');

    // The details typed when opening can be corrected afterwards.
    const corrected = await post(`/api/v1/lecture/sessions/${sessionId}`, { courseCode: 'ece210', courseTitle: 'Circuit  Analysis', lecturerName: '' }, lecturerCookie);
    expect(corrected.statusCode).toBe(200);
    expect(jsonBody(corrected)).toMatchObject({ courseCode: 'ECE 210', courseTitle: 'Circuit Analysis', lecturerName: null, venueId: null, presentCount: 4 });
    expect((await post(`/api/v1/lecture/sessions/${sessionId}`, { requireVenue: true }, lecturerCookie)).statusCode).toBe(422);
    expect((await post(`/api/v1/lecture/sessions/${sessionId}`, { venueId: '0b5c3f6e-2d4a-4c1e-9f7a-1a2b3c4d5e6f' }, lecturerCookie)).statusCode).toBe(422);
    expect((await post(`/api/v1/lecture/sessions/${sessionId}`, { courseTitle: 'Hijacked' }, studentCookie)).statusCode).toBe(404);
    expect((await post(`/api/v1/lecture/sessions/${sessionId}`, {}, lecturerCookie)).statusCode).toBe(400);
    const restored = jsonBody(await post(`/api/v1/lecture/sessions/${sessionId}`, { courseCode: 'ECE 201', courseTitle: 'Circuit Theory', lecturerName: 'E2E Lecturer' }, lecturerCookie));
    expect(restored).toMatchObject({ courseCode: 'ECE 201', courseTitle: 'Circuit Theory', lecturerName: 'E2E Lecturer', status: 'open' });

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

    // A HOC sees their department's attendance — the lecturer's session and their GHOC's
    // session for the same set — but can only view it.
    expect(jsonBody(await get('/api/v1/lecture/capabilities', hocCookie))).toMatchObject({ attendanceScopeLabel: 'Electronic and Computer Engineering' });
    expect(jsonBody(await get('/api/v1/lecture/capabilities', studentCookie))).toMatchObject({ attendanceScopeLabel: 'Faculty of Engineering' });
    expect(jsonBody(await get('/api/v1/lecture/capabilities', lecturerCookie))).toMatchObject({ attendanceScopeLabel: null });
    const hocList = jsonBody(await get('/api/v1/lecture/sessions', hocCookie)).sessions as Array<{ courseCode: string; canManage: boolean }>;
    expect(hocList.map((item) => [item.courseCode, item.canManage]).sort()).toEqual([['ECE 201', false], ['GNS 101', false]]);
    const hocDetail = await get(`/api/v1/lecture/sessions/${sessionId}`, hocCookie);
    expect(hocDetail.statusCode).toBe(200);
    expect(jsonBody(hocDetail)).toMatchObject({ canManage: false, session: { canManage: false, courseCode: 'ECE 201', presentCount: 4 } });
    expect((await post(`/api/v1/lecture/sessions/${sessionId}`, { courseTitle: 'Changed by HOC' }, hocCookie)).statusCode).toBe(404);
    const someone = (jsonBody(hocDetail).attendees as Array<{ id: string }>)[0]!;
    expect((await post(`/api/v1/lecture/sessions/${sessionId}/attendees/${someone.id}`, { reason: "x" }, hocCookie)).statusCode).toBe(404);
    expect((await post(`/api/v1/lecture/sessions/${sessionId}/attendees`, { fullName: 'Planted Name', matricNumber: '220591099' }, hocCookie)).statusCode).toBe(404);
    // A typo in a guest entry can be corrected by whoever took the session — not by viewers.
    const listed = jsonBody(hocDetail).attendees as Array<{ id: string; fullName: string; matricNumber: string }>;
    const funke = listed.find((item) => item.matricNumber === '220591050')!;
    const ada = listed.find((item) => item.matricNumber === '220591001')!;
    const chidi = listed.find((item) => item.matricNumber === '220591010')!;
    const details = (attendeeId: string, payload: unknown, cookie: string) =>
      post(`/api/v1/lecture/sessions/${sessionId}/attendees/${attendeeId}/details`, payload, cookie);
    expect((await details(funke.id, { fullName: 'Funmilayo Bello' }, hocCookie)).statusCode).toBe(404);
    expect(jsonBody(await details(funke.id, { fullName: ' Funmilayo   Bello ' }, lecturerCookie))).toEqual({
      status: 'corrected', fullName: 'Funmilayo Bello', matricNumber: '220591050', linked: false,
    });
    expect((await details(ada.id, { matricNumber: '220 591 002' }, lecturerCookie)).statusCode).toBe(409);
    expect((await details(chidi.id, { fullName: 'Someone Else' }, lecturerCookie)).statusCode).toBe(409);
    expect((await details(ada.id, {}, lecturerCookie)).statusCode).toBe(400);
    // The corrected number belongs to an account, which now owns the entry.
    expect(jsonBody(await details(funke.id, { matricNumber: '220591011' }, lecturerCookie))).toEqual({
      status: 'corrected', fullName: 'Ngozi Eze', matricNumber: '220591011', linked: true,
    });
    expect((await details(funke.id, { fullName: 'Back Again' }, lecturerCookie)).statusCode).toBe(409);

    const hocRegisters = jsonBody(await get('/api/v1/lecture/registers', hocCookie)).courses as Array<{ courseCode: string }>;
    expect(hocRegisters.map((item) => item.courseCode).sort()).toEqual(['ECE 201', 'GNS 101']);
    expect(jsonBody(await get('/api/v1/lecture/register?course=ece201', hocCookie))).toMatchObject({ courseCode: 'ECE 201' });
    // The GHOC sees the whole faculty and keeps control of their own session only.
    const ghocList = jsonBody(await get('/api/v1/lecture/sessions', studentCookie)).sessions as Array<{ courseCode: string; canManage: boolean }>;
    expect(ghocList.map((item) => [item.courseCode, item.canManage]).sort()).toEqual([['ECE 201', false], ['GNS 101', true]]);
    // A lecturer still sees only the sessions they took.
    expect((jsonBody(await get('/api/v1/lecture/sessions', lecturerCookie)).sessions as unknown[]).length).toBe(1);

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
    expect(register).toMatchObject({ courseCode: 'ECE 201', sessions: [expect.objectContaining({ presentCount: 4 })] });
    expect((register.students as Array<{ rate: number; present: boolean[] }>).every((row) => row.rate === 100 && row.present.length === 1)).toBe(true);
    expect(jsonBody(await get('/api/v1/lecture/register?course=ece201', lecturerCookie))).toMatchObject({ courseCode: 'ECE 201' });
    expect((await get('/api/v1/lecture/register?course=GNS%20101', lecturerCookie)).statusCode).toBe(404);
    expect((await get('/api/v1/lecture/register?course=ECE%20201', hocCookie)).statusCode).toBe(403);
    expect((await get('/api/v1/lecture/register', lecturerCookie)).statusCode).toBe(400);

    // Anyone can correct their own name; a student can fix a mistyped matric number with their password.
    const renamed = await post('/api/v1/auth/profile', { displayName: ' Chidi   Okeke-Obi ' }, studentCookie);
    expect(renamed.statusCode).toBe(200);
    expect(jsonBody(renamed)).toEqual({ status: 'profile_updated', displayName: 'Chidi Okeke-Obi', matricNumber: '220591010' });
    expect((await post('/api/v1/auth/profile', { matricNumber: '230591010' }, studentCookie)).statusCode).toBe(400);
    expect((await post('/api/v1/auth/profile', { matricNumber: '230591010', currentPassword: 'wrong-password' }, studentCookie)).statusCode).toBe(400);
    expect((await post('/api/v1/auth/profile', { matricNumber: '220 591 011', currentPassword: 'chidi-passphrase-1' }, studentCookie)).statusCode).toBe(409);
    const newMatric = await post('/api/v1/auth/profile', { matricNumber: '230 591 010', currentPassword: 'chidi-passphrase-1' }, studentCookie);
    expect(jsonBody(newMatric)).toMatchObject({ matricNumber: '230591010' });
    expect(jsonBody(await get('/api/v1/auth/session', studentCookie)).account).toMatchObject({ displayName: 'Chidi Okeke-Obi', matricNumber: '230591010' });
    expect((await post('/api/v1/auth/profile', { matricNumber: '230591099' }, lecturerCookie)).statusCode).toBe(400);
    expect(jsonBody(await post('/api/v1/auth/profile', { displayName: 'Dr. E2E Lecturer' }, lecturerCookie))).toMatchObject({ displayName: 'Dr. E2E Lecturer', matricNumber: null });
    expect((await post('/api/v1/auth/profile', { displayName: 'Nobody' })).statusCode).toBe(401);

    // Sessions can be searched by course code or title, and are paged.
    const search = async (q: string) => jsonBody(await get(`/api/v1/lecture/sessions?q=${encodeURIComponent(q)}`, lecturerCookie));
    expect((await search('ece201')).sessions).toEqual([expect.objectContaining({ courseCode: 'ECE 201' })]);
    expect((await search('circuit')).sessions).toHaveLength(1);
    expect(await search('zzz')).toEqual({ sessions: [], hasMore: false });
    expect(jsonBody(await get(`/api/v1/lecture/sessions?before=${encodeURIComponent('2000-01-01T00:00:00.000Z')}`, adminCookie))).toEqual({ sessions: [], hasMore: false });
    expect((await get('/api/v1/lecture/sessions?before=yesterday', adminCookie)).statusCode).toBe(400);

    // A summary of attendance across what the person can see.
    const summary = jsonBody(await get('/api/v1/lecture/summary?days=30', adminCookie));
    expect(summary).toMatchObject({
      days: 30,
      totals: { sessions: 2, checkIns: 4, uniqueStudents: 4, courses: 2, openNow: expect.any(Number) },
      takers: { lecturer: 1, ghoc: 1, hoc: 0, administrator: 0 },
    });
    expect(summary.daily).toHaveLength(30);
    expect((summary.daily as Array<{ checkIns: number }>).reduce((sum, day) => sum + day.checkIns, 0)).toBe(4);
    expect(summary.courses).toEqual(expect.arrayContaining([expect.objectContaining({ courseCode: 'ECE 201', sessions: 1, checkIns: 4, averagePresent: 4 })]));
    expect(summary.departments).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Electronic and Computer Engineering', checkIns: 4 })]));
    expect(jsonBody(await get('/api/v1/lecture/summary?days=7', lecturerCookie)).totals).toMatchObject({ sessions: 1, checkIns: 4 });
    expect((await get('/api/v1/lecture/summary?days=5', adminCookie)).statusCode).toBe(400);
    expect((await get('/api/v1/lecture/summary', hocCookie)).statusCode).toBe(403);

    // A session opened by mistake can be deleted; with students on it, the course code must be typed.
    const mistake = jsonBody(await post('/api/v1/lecture/sessions', { courseCode: 'TMP 101', courseTitle: 'Wrong course', durationMinutes: 15, qrMode: 'static' }, lecturerCookie));
    expect((await post(`/api/v1/lecture/sessions/${String(mistake.id)}/delete`, {}, lecturerCookie)).statusCode).toBe(204);
    expect((await get(`/api/v1/lecture/sessions/${String(mistake.id)}`, lecturerCookie)).statusCode).toBe(404);
    expect((await post(`/api/v1/lecture/sessions/${sessionId}/delete`, {}, studentCookie)).statusCode).toBe(404);
    const unconfirmed = await post(`/api/v1/lecture/sessions/${sessionId}/delete`, { confirmCourseCode: 'ECE 999' }, lecturerCookie);
    expect(unconfirmed.statusCode).toBe(422);
    expect(String(jsonBody(unconfirmed).detail ?? jsonBody(unconfirmed).title)).toContain('Type ECE 201');
    expect((await post(`/api/v1/lecture/sessions/${sessionId}/delete`, { confirmCourseCode: 'ece201' }, lecturerCookie)).statusCode).toBe(204);
    expect(jsonBody(await get('/api/v1/lecture/registers', lecturerCookie)).courses).toEqual([]);
    expect(jsonBody(await get('/api/v1/lecture/summary?days=7', adminCookie)).totals).toMatchObject({ sessions: 1, checkIns: 0 });
  } finally {
    await client.close();
  }
});
