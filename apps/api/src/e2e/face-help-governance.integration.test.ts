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
import { GovernanceService } from '../governance/service.js';
import { PostgresGovernanceRepository } from '../governance/postgres-repository.js';
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
import { capture, fakeEngine } from './fake-face.js';

/**
 * What happens around the face check: a student whose check keeps failing
 * asks the lecturer to add them; close matches are reviewed; a student takes
 * new face photos; administrators read the audit log and delete the face
 * data of sets that have graduated.
 */

const ADMIN_ID = 'c7777777-7777-4777-8777-777777777777';
const ADMIN_EMAIL = 'admin@e2e.invalid';
const ADMIN_PASSWORD = 'e2e-admin-passphrase';
const CRON_SECRET = 'e2e-cron-secret-value';

it('help requests, face reviews, new face photos, the audit log and data retention', async () => {
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
      credentials: { verifyStudent: (identifier, password) => auth.verifyStudentCredentials(identifier, password) },
      now,
    });
    const governance = new GovernanceService({
      repository: new PostgresGovernanceRepository(database),
      policy: { graceMonths: 12, activeWithinDays: 180, checkPhotoDays: 90 },
      scheduled: true,
      now,
    });
    const server = buildServer({
      logger: false,
      secureCookies: false,
      auth,
      students,
      governance,
      cronSecret: CRON_SECRET,
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
    const lastCode = () => sent.at(-1)!.code;

    const adminCookie = sessionCookie((await post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).headers);
    const lecturerCookie = sessionCookie((await post('/api/v1/auth/login', { email: LECTURER_EMAIL, password: LECTURER_PASSWORD })).headers);

    // Class list rules: digits-only matric numbers of 9 digits, letters-only names, no duplicates.
    const bad = jsonBody(await post('/api/v1/class-lists/import', {
      departmentId: ids.department,
      entryYear: 2024,
      rows: [
        { matricNumber: '2405910O1', surname: 'Odejobi', firstName: 'Abraham' },
        { matricNumber: '2.40591E+08', surname: 'Okafor', firstName: 'Chioma' },
        { matricNumber: '240591003', surname: 'Bak4re', firstName: 'T.' },
        { matricNumber: '240591004', surname: 'Musa', firstName: 'Fatima', lasuEmail: 'same@st.lasu.edu.ng' },
        { matricNumber: '240591005', surname: 'Bello', firstName: 'Funke', lasuEmail: 'same@st.lasu.edu.ng' },
        { matricNumber: '2405910060', surname: 'Ade', firstName: 'Bayo' },
      ],
      apply: true,
    }, adminCookie));
    expect(bad.applied).toBe(false);
    const messages = (bad.problems as Array<{ row: number; kind: string; message: string }>).filter((problem) => problem.kind === 'error');
    expect(messages.find((problem) => problem.row === 1)?.message).toMatch(/digits only.*letter O looks like 0/);
    expect(messages.find((problem) => problem.row === 2)?.message).toMatch(/shortened by the spreadsheet/);
    expect(messages.filter((problem) => problem.row === 3).map((problem) => problem.message).join(' ')).toMatch(/letters only[^]*(initial|letters only)/);
    expect(messages.find((problem) => problem.row === 5)?.message).toMatch(/email/i);
    expect(messages.find((problem) => problem.row === 6)?.message).toMatch(/10 digits/);

    const rows = [
      { matricNumber: '240591001', surname: 'Odejobi', firstName: 'Abraham', lasuEmail: 'abraham.odejobi@st.lasu.edu.ng' },
      { matricNumber: '240591002', surname: 'Okafor', firstName: 'Chioma', lasuEmail: 'chioma.okafor@st.lasu.edu.ng' },
    ];
    expect(jsonBody(await post('/api/v1/class-lists/import', { departmentId: ids.department, entryYear: 2024, rows, apply: true }, adminCookie))).toMatchObject({ applied: true, added: 2 });

    async function openAccount(matric: string, person: string): Promise<string> {
      clock = new Date(clock.getTime() + 61_000);
      expect((await post('/api/v1/students/open/code', { matricNumber: matric })).statusCode).toBe(200);
      const opened = await post('/api/v1/students/open', { matricNumber: matric, code: lastCode() });
      expect(opened.statusCode).toBe(201);
      const cookie = sessionCookie(opened.headers);
      expect((await post('/api/v1/students/me/face', { consent: true, frames: capture(person) }, cookie)).statusCode).toBe(201);
      return cookie;
    }
    const abrahamCookie = await openAccount('240591001', 'abraham');
    const chiomaCookie = await openAccount('240591002', 'chioma');
    // The starting password is never forced: the account works and setup only reminds.
    expect(jsonBody(await get('/api/v1/students/me/setup', abrahamCookie))).toMatchObject({ complete: true, defaultPassword: true, faceEnrolledAt: expect.any(String), faceReplaceAllowedUntil: null });

    // 1. The face check keeps failing: after two tries the student can ask to be added.
    expect((await post('/api/v1/lecture/course-catalog', { code: 'ECE 201', title: 'Circuit Theory', units: 3 }, lecturerCookie)).statusCode).toBe(201);
    const session = jsonBody(await post('/api/v1/lecture/sessions', { courseCode: 'ECE 201', courseTitle: 'Circuit Theory', durationMinutes: 60, qrMode: 'dynamic' }, lecturerCookie));
    const sessionId = String(session.id);
    const challenge = String(jsonBody(await get(`/api/v1/lecture/sessions/${sessionId}/qr`, lecturerCookie)).path).split('#')[1] ?? '';
    const ticket = String(jsonBody(await post('/api/v1/lecture/resolve', { challenge }, abrahamCookie)).ticket);
    const turn = turnForTicket(ticket);

    expect((await post('/api/v1/lecture/help-requests', { ticket }, abrahamCookie)).statusCode).toBe(409);
    expect((await post('/api/v1/lecture/check-in', { ticket, face: { frames: capture('chioma', ['front', turn]) } }, abrahamCookie)).statusCode).toBe(403);
    const tooEarly = await post('/api/v1/lecture/help-requests', { ticket }, abrahamCookie);
    expect(tooEarly.statusCode).toBe(409);
    expect(jsonBody(tooEarly).detail).toMatch(/Try the face check again first/);
    expect((await post('/api/v1/lecture/check-in', { ticket, face: { frames: capture('chioma', ['front', turn], { jitter: 9 }) } }, abrahamCookie)).statusCode).toBe(403);
    // Not signed in: no request.
    expect((await post('/api/v1/lecture/help-requests', { ticket })).statusCode).toBe(401);
    const asked = await post('/api/v1/lecture/help-requests', { ticket }, abrahamCookie);
    expect(asked.statusCode).toBe(201);
    expect(jsonBody(asked)).toMatchObject({ status: 'pending', courseCode: 'ECE 201', fullName: 'Abraham Odejobi', matricNumber: '240591001' });
    // Asking twice keeps one request.
    expect(jsonBody(await post('/api/v1/lecture/help-requests', { ticket }, abrahamCookie)).id).toBe(jsonBody(asked).id);
    expect(jsonBody(await get(`/api/v1/lecture/sessions/${sessionId}/help-request`, abrahamCookie))).toMatchObject({ status: 'pending' });
    expect((await get(`/api/v1/lecture/sessions/${sessionId}/help-request`, chiomaCookie)).statusCode).toBe(404);

    const detail = jsonBody(await get(`/api/v1/lecture/sessions/${sessionId}`, lecturerCookie));
    const requests = detail.helpRequests as Array<Record<string, unknown>>;
    expect(requests).toEqual([expect.objectContaining({
      fullName: 'Abraham Odejobi', matricNumber: '240591001', status: 'pending', failures: 2, hasPhoto: true,
      reasonLabel: 'Face did not match the registered face',
    })]);
    const requestId = String(requests[0]!.id);
    const portrait = await get(`/api/v1/lecture/sessions/${sessionId}/help-requests/${requestId}/photo`, lecturerCookie);
    expect(portrait.statusCode).toBe(200);
    expect(portrait.headers['cache-control']).toBe('private, no-store');
    expect((await get(`/api/v1/lecture/sessions/${sessionId}/help-requests/${requestId}/photo`, abrahamCookie)).statusCode).toBe(404);
    expect((await post(`/api/v1/lecture/sessions/${sessionId}/help-requests/${requestId}`, { decision: 'add' }, abrahamCookie)).statusCode).toBe(404);

    const added = await post(`/api/v1/lecture/sessions/${sessionId}/help-requests/${requestId}`, { decision: 'add' }, lecturerCookie);
    expect(added.statusCode).toBe(200);
    expect(jsonBody(added)).toMatchObject({ status: 'added', matricNumber: '240591001' });
    expect((await post(`/api/v1/lecture/sessions/${sessionId}/help-requests/${requestId}`, { decision: 'decline' }, lecturerCookie)).statusCode).toBe(409);
    expect(jsonBody(await get(`/api/v1/lecture/sessions/${sessionId}/help-request`, abrahamCookie))).toMatchObject({ status: 'added', decidedAt: expect.any(String) });
    const afterAdd = jsonBody(await get(`/api/v1/lecture/sessions/${sessionId}`, lecturerCookie));
    expect(afterAdd.attendees).toEqual([expect.objectContaining({ matricNumber: '240591001', method: 'manual' })]);
    // Already on the list: no new request.
    expect((await post('/api/v1/lecture/help-requests', { ticket }, abrahamCookie)).statusCode).toBe(409);

    // Chioma's request is declined.
    const chiomaTicket = String(jsonBody(await post('/api/v1/lecture/resolve', { challenge }, chiomaCookie)).ticket);
    for (const jitter of [1, 2]) {
      await post('/api/v1/lecture/check-in', { ticket: chiomaTicket, face: { frames: capture('abraham', ['front', turnForTicket(chiomaTicket)], { jitter }) } }, chiomaCookie);
    }
    const chiomaRequest = jsonBody(await post('/api/v1/lecture/help-requests', { ticket: chiomaTicket }, chiomaCookie));
    expect(jsonBody(await post(`/api/v1/lecture/sessions/${sessionId}/help-requests/${String(chiomaRequest.id)}`, { decision: 'decline' }, lecturerCookie))).toMatchObject({ status: 'declined' });
    expect(jsonBody(await get(`/api/v1/lecture/sessions/${sessionId}/help-request`, chiomaCookie))).toMatchObject({ status: 'declined' });

    // 2. A close match is listed for review across sessions.
    const second = jsonBody(await post('/api/v1/lecture/sessions', { courseCode: 'ECE 201', courseTitle: 'Circuit Theory', durationMinutes: 60, qrMode: 'dynamic' }, lecturerCookie));
    const secondChallenge = String(jsonBody(await get(`/api/v1/lecture/sessions/${String(second.id)}/qr`, lecturerCookie)).path).split('#')[1] ?? '';
    const secondTicket = String(jsonBody(await post('/api/v1/lecture/resolve', { challenge: secondChallenge }, abrahamCookie)).ticket);
    const close = await post('/api/v1/lecture/check-in', {
      ticket: secondTicket,
      face: { frames: capture('abraham', ['front', turnForTicket(secondTicket)], { jitter: 5, blend: { person: 'chioma', weight: 0.57 } }) },
    }, abrahamCookie);
    expect(close.statusCode).toBe(201);

    const reviews = jsonBody(await get('/api/v1/lecture/face-reviews', lecturerCookie));
    expect(reviews).toMatchObject({ pendingCount: 1, nextCursor: null });
    const item = (reviews.items as Array<Record<string, unknown>>)[0]!;
    expect(item).toMatchObject({ status: 'pending', studentName: 'Abraham Odejobi', matricNumber: '240591001', courseCode: 'ECE 201', hasCheckPhoto: true, hasRegisteredPhoto: true });
    const checkId = String(item.id);
    expect((await get(`/api/v1/lecture/face-reviews/${checkId}/photo/check`, lecturerCookie)).body).toBe('portrait:abraham');
    expect((await get(`/api/v1/lecture/face-reviews/${checkId}/photo/registered`, lecturerCookie)).statusCode).toBe(200);
    expect((await get('/api/v1/lecture/face-reviews', abrahamCookie)).statusCode).toBe(403);
    expect((await get(`/api/v1/lecture/face-reviews/${checkId}/photo/check`, chiomaCookie)).statusCode).toBe(403);
    // The administrator sees it too (their scope covers the session).
    expect(jsonBody(await get('/api/v1/lecture/face-reviews', adminCookie))).toMatchObject({ pendingCount: 1 });

    expect((await post(`/api/v1/lecture/face-reviews/${checkId}`, { decision: 'reject' }, lecturerCookie)).statusCode).toBe(422);
    const rejected = await post(`/api/v1/lecture/face-reviews/${checkId}`, { decision: 'reject', note: 'Not the same person' }, lecturerCookie);
    expect(rejected.statusCode).toBe(200);
    expect(jsonBody(rejected)).toMatchObject({ status: 'rejected', reviewNote: 'Not the same person', reviewedByName: expect.any(String) });
    expect((await post(`/api/v1/lecture/face-reviews/${checkId}`, { decision: 'approve' }, adminCookie)).statusCode).toBe(409);
    const secondDetail = jsonBody(await get(`/api/v1/lecture/sessions/${String(second.id)}`, lecturerCookie));
    expect(secondDetail.attendees).toEqual([expect.objectContaining({ matricNumber: '240591001', faceReview: 'rejected', removed: true, removedReason: 'Face check rejected: Not the same person' })]);
    expect(jsonBody(await get('/api/v1/lecture/face-reviews', lecturerCookie))).toMatchObject({ pendingCount: 0, items: [] });
    expect((jsonBody(await get('/api/v1/lecture/face-reviews?status=reviewed', lecturerCookie)).items as unknown[]).length).toBe(1);
    // Removed after a rejected review: no help request either.
    expect((await post('/api/v1/lecture/help-requests', { ticket: secondTicket }, abrahamCookie)).statusCode).toBe(409);

    // 3. Taking new face photos: password, then the emailed code, then photos that match the old face.
    expect((await post('/api/v1/students/me/face/replace', { consent: true, frames: capture('abraham') }, abrahamCookie)).statusCode).toBe(403);
    expect((await post('/api/v1/students/me/face/replace/code', { password: 'wrong password here' }, abrahamCookie)).statusCode).toBe(400);
    clock = new Date(clock.getTime() + 61_000);
    expect((await post('/api/v1/students/me/face/replace/code', { password: 'LASU240591001ODEJOBI' }, abrahamCookie)).statusCode).toBe(200);
    expect(sent.at(-1)).toMatchObject({ to: 'abraham.odejobi@st.lasu.edu.ng', purpose: 'face' });
    const confirmed = jsonBody(await post('/api/v1/students/me/face/replace/confirm', { code: lastCode() }, abrahamCookie));
    expect(confirmed).toMatchObject({ status: 'confirmed', allowedUntil: expect.any(String) });
    expect(jsonBody(await get('/api/v1/students/me/setup', abrahamCookie)).faceReplaceAllowedUntil).toBe(confirmed.allowedUntil);
    const someoneElse = await post('/api/v1/students/me/face/replace', { consent: true, frames: capture('chioma', undefined, { jitter: 11 }) }, abrahamCookie);
    expect(someoneElse.statusCode).toBe(403);
    expect(jsonBody(someoneElse).detail).toMatch(/do not look like the face registered/);
    const replaced = await post('/api/v1/students/me/face/replace', { consent: true, frames: capture('abraham', undefined, { jitter: 21 }) }, abrahamCookie);
    expect(replaced.statusCode).toBe(200);
    expect(jsonBody(replaced)).toMatchObject({ status: 'replaced' });
    // The confirmation is used up.
    expect((await post('/api/v1/students/me/face/replace', { consent: true, frames: capture('abraham', undefined, { jitter: 22 }) }, abrahamCookie)).statusCode).toBe(403);

    // 4. The audit log: every trail in one list, newest first, filterable.
    expect((await get('/api/v1/admin/audit', lecturerCookie)).statusCode).toBe(403);
    const log = jsonBody(await get('/api/v1/admin/audit', adminCookie));
    expect(log).toMatchObject({ limitedToScope: false });
    const actions = (log.entries as Array<{ action: string }>).map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining([
      'class_list_imported', 'account_opened', 'face_registered', 'face_check_failed', 'help_request_created', 'help_request_added',
      'help_request_declined', 'attendee_added_by_hand', 'face_review_rejected', 'attendee_removed', 'face_replace_confirmed',
      'face_replace_refused', 'face_replaced',
    ]));
    const times = (log.entries as Array<{ at: string }>).map((entry) => entry.at);
    expect([...times].sort().reverse()).toEqual(times);
    const faces = jsonBody(await get('/api/v1/admin/audit?category=faces', adminCookie));
    expect((faces.entries as Array<{ category: string }>).every((entry) => entry.category === 'faces')).toBe(true);
    const search = jsonBody(await get('/api/v1/admin/audit?category=attendance&q=240591002', adminCookie));
    expect((search.entries as Array<{ action: string; subject: string }>).map((entry) => entry.action)).toEqual(expect.arrayContaining(['help_request_created', 'help_request_declined']));
    expect((search.entries as Array<{ subject: string | null }>).every((entry) => entry.subject?.includes('240591002'))).toBe(true);
    const removal = (log.entries as Array<{ action: string; summary: string; actorName: string; subject: string; details: string }>).find((entry) => entry.action === 'attendee_removed')!;
    expect(removal).toMatchObject({ summary: 'Removed a student from a lecture', subject: expect.stringContaining('ECE 201'), details: expect.stringContaining('Face check rejected') });
    expect((await get('/api/v1/admin/audit?from=2026-02-10&to=2026-01-01', adminCookie)).statusCode).toBe(400);
    expect((await get('/api/v1/admin/audit?cursor=bogus', adminCookie)).statusCode).toBe(400);

    // 5. Data retention: the 2016 set (4-year programme) finished on 1 Sep 2020; due a year later.
    await client.query(`UPDATE class_list_entries SET entry_year = 2016 WHERE institution_id = $1`, [ids.institution]);
    clock = new Date(clock.getTime() + 100 * 86_400_000);
    expect((await get('/api/v1/admin/retention', lecturerCookie)).statusCode).toBe(403);
    const preview = jsonBody(await get('/api/v1/admin/retention', adminCookie));
    expect(preview).toMatchObject({
      policy: { graceMonths: 12, activeWithinDays: 180, checkPhotoDays: 90 },
      scheduled: true,
      canRun: true,
      lastRun: null,
      sets: [expect.objectContaining({ setLabel: '2016/2017 set', finishedOn: '2020-09-01', dueOn: '2021-09-01', students: 2, faces: 2, dueFaces: 1, keptActive: 1 })],
      due: { faces: 1, checkPhotos: expect.any(Number) },
    });
    expect((preview.due as { checkPhotos: number }).checkPhotos).toBeGreaterThanOrEqual(1);
    expect((await post('/api/v1/admin/retention/run', {}, adminCookie)).statusCode).toBe(400);
    const ran = jsonBody(await post('/api/v1/admin/retention/run', { confirm: true }, adminCookie));
    expect(ran).toMatchObject({ facesDeleted: 1, checkPhotosDeleted: (preview.due as { checkPhotos: number }).checkPhotos });
    // Chioma (no recent lecture) loses her face; Abraham (checked in recently) keeps his. Accounts stay.
    expect(jsonBody(await get('/api/v1/students/me/setup', chiomaCookie))).toMatchObject({ faceRegistered: false });
    expect(jsonBody(await get('/api/v1/students/me/setup', abrahamCookie))).toMatchObject({ faceRegistered: true });
    expect((await get(`/api/v1/lecture/face-reviews/${checkId}/photo/check`, lecturerCookie)).statusCode).toBe(404);
    const after = jsonBody(await get('/api/v1/admin/retention', adminCookie));
    expect(after).toMatchObject({ due: { faces: 0, checkPhotos: 0 }, lastRun: { facesDeleted: 1, scheduled: false, actorName: 'E2E Admin' } });
    const retentionLog = jsonBody(await get('/api/v1/admin/audit?category=retention', adminCookie));
    expect((retentionLog.entries as Array<{ summary: string }>).map((entry) => entry.summary).sort()).toEqual(['Deleted face data after graduation', 'Ran data retention']);

    // The daily run needs the cron secret.
    expect((await get('/api/v1/cron/retention')).statusCode).toBe(401);
    expect((await server.inject({ method: 'GET', url: '/api/v1/cron/retention', headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    const cron = await server.inject({ method: 'GET', url: '/api/v1/cron/retention', headers: { authorization: `Bearer ${CRON_SECRET}` } });
    expect(cron.statusCode).toBe(200);
    expect(jsonBody(cron)).toMatchObject({ status: 'ok', facesDeleted: 0 });
    expect(jsonBody(await get('/api/v1/admin/retention', adminCookie))).toMatchObject({ lastRun: { scheduled: true, actorName: null } });

    // A department administrator sees their department's student events, and cannot run retention.
    const DEPT_ADMIN = 'c8888888-8888-4888-8888-888888888888';
    await client.query(
      `INSERT INTO users (id, institution_id, email, display_name, password_hash, status) VALUES ($1, $2, 'dept@e2e.invalid', 'Dept Admin', $3, 'active')`,
      [DEPT_ADMIN, ids.institution, await hashPassword(ADMIN_PASSWORD)],
    );
    await client.query(
      `INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id, department_id) VALUES ($1, 'department_administrator', 'department', $2, $3)`,
      [DEPT_ADMIN, ids.institution, ids.department],
    );
    const deptCookie = sessionCookie((await post('/api/v1/auth/login', { email: 'dept@e2e.invalid', password: ADMIN_PASSWORD })).headers);
    const deptLog = jsonBody(await get('/api/v1/admin/audit', deptCookie));
    expect(deptLog).toMatchObject({ limitedToScope: true });
    const deptActions = (deptLog.entries as Array<{ action: string; category: string }>);
    expect(deptActions.map((entry) => entry.action)).toEqual(expect.arrayContaining(['account_opened', 'face_review_rejected']));
    expect(deptActions.some((entry) => entry.category === 'retention')).toBe(false);
    expect(jsonBody(await get('/api/v1/admin/retention', deptCookie))).toMatchObject({ canRun: false });
    expect((await post('/api/v1/admin/retention/run', { confirm: true }, deptCookie)).statusCode).toBe(403);

    await expect(client.query('DELETE FROM student_audit_events')).rejects.toThrow(/append-only/);
    await server.close();
  } finally {
    await client.close();
  }
}, 90_000);
