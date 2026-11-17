import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { hashPassword } from '@lasuatos/auth';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { StudentAuthService } from '../auth/service.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import { CourseEnrollmentService } from '../enrollment/service.js';
import { PostgresCourseEnrollmentRepository } from '../enrollment/postgres-repository.js';
import { LectureService } from '../lecture/service.js';
import { PostgresLectureRepository } from '../lecture/postgres-repository.js';
import { PostgresStudentRepository } from '../students/postgres-repository.js';
import { StudentService } from '../students/service.js';
import type { StudentEmailCodeEmail } from '../email/transport.js';
import { INSTITUTION_SLUG, applyMigrations, ids, jsonBody, seedLecturerFixture, sessionCookie } from './harness.js';

/**
 * The class record belongs to the class list, kept by the HOC: students ask them to
 * correct their department or entry route instead of changing it themselves; a HOC moves
 * a student who is on the wrong department's list; HOCs and GHOCs choose up to two
 * assistants (AHOC, AGHOC) and what each may do.
 */

const ADMIN_ID = 'c7777777-7777-4777-8777-777777777777';
const ADMIN_EMAIL = 'admin@e2e.invalid';
const ADMIN_PASSWORD = 'e2e-admin-passphrase';
const CIVIL = 'c3333333-3333-4333-8333-333333333334';
const SCIENCE = 'c2222222-2222-4222-8222-222222222223';
const CHEMISTRY = 'c3333333-3333-4333-8333-333333333335';

it('keeps the class record with the HOC, moves misplaced students, and runs assistant reps', async () => {
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
    await client.query('INSERT INTO departments (id, institution_id, faculty_id, code, name) VALUES ($1, $2, $3, $4, $5)', [CIVIL, ids.institution, ids.faculty, 'CVE', 'Civil Engineering']);
    await client.query('INSERT INTO faculties (id, institution_id, code, name) VALUES ($1, $2, $3, $4)', [SCIENCE, ids.institution, 'SCI', 'Faculty of Science']);
    await client.query('INSERT INTO departments (id, institution_id, faculty_id, code, name) VALUES ($1, $2, $3, $4, $5)', [CHEMISTRY, ids.institution, SCIENCE, 'CHM', 'Chemistry']);

    const database = drizzle(client) as unknown as DatabaseClient;
    const sent: StudentEmailCodeEmail[] = [];
    const auth = new StudentAuthService({ repository: new PostgresAuthRepository(database), institutionSlug: INSTITUTION_SLUG });
    const students = new StudentService({
      repository: new PostgresStudentRepository(database),
      institutionSlug: INSTITUTION_SLUG,
      emailSender: { sendStudentEmailCode: async (email) => { sent.push(email); } },
    });
    const server = buildServer({
      logger: false,
      secureCookies: false,
      auth,
      students,
      openStudentSignUp: false,
      courseEnrollment: new CourseEnrollmentService({ repository: new PostgresCourseEnrollmentRepository(database) }),
      lecture: new LectureService({
        repository: new PostgresLectureRepository(database),
        credentials: { verifyStudent: (identifier, password) => auth.verifyStudentCredentials(identifier, password) },
      }),
    });
    const post = (url: string, payload: unknown, cookie?: string) =>
      server.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, ...(cookie ? { headers: { cookie } } : {}) });
    const get = (url: string, cookie?: string) => server.inject({ method: 'GET', url, ...(cookie ? { headers: { cookie } } : {}) });
    const adminCookie = sessionCookie((await post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).headers);

    // The 2024 set's lists: five in Electronic and Computer Engineering, one in Civil.
    const ece = [
      { matricNumber: '240591001', surname: 'Obi', firstName: 'Ada', lasuEmail: 'ada.obi@st.lasu.edu.ng' },
      { matricNumber: '240591002', surname: 'Bello', firstName: 'Bola', lasuEmail: 'bola.bello@st.lasu.edu.ng' },
      { matricNumber: '240591003', surname: 'Eze', firstName: 'Chidi', lasuEmail: 'chidi.eze@st.lasu.edu.ng' },
      { matricNumber: '240591004', surname: 'Ade', firstName: 'Dayo', lasuEmail: 'dayo.ade@st.lasu.edu.ng' },
      { matricNumber: '240591005', surname: 'Musa', firstName: 'Efe', lasuEmail: 'efe.musa@st.lasu.edu.ng' },
    ];
    expect(jsonBody(await post('/api/v1/class-lists/import', { departmentId: ids.department, entryYear: 2024, rows: ece, apply: true }, adminCookie))).toMatchObject({ applied: true, added: 5 });
    expect(jsonBody(await post('/api/v1/class-lists/import', { departmentId: CIVIL, entryYear: 2024, rows: [{ matricNumber: '240592001', surname: 'Ola', firstName: 'Femi', lasuEmail: 'femi.ola@st.lasu.edu.ng' }], apply: true }, adminCookie))).toMatchObject({ added: 1 });

    // Everyone opens their account with a setup code (the quickest way here).
    const entriesOf = async (departmentId: string) =>
      jsonBody(await get(`/api/v1/class-lists?departmentId=${departmentId}&entryYear=2024`, adminCookie)).entries as Array<{ id: string; matricNumber: string; userId: string | null; departmentName: string }>;
    const open = async (matricNumber: string, departmentId = ids.department) => {
      const entry = (await entriesOf(departmentId)).find((item) => item.matricNumber === matricNumber)!;
      const code = String(jsonBody(await post(`/api/v1/class-lists/entries/${entry.id}/setup-code`, {}, adminCookie)).code);
      const opened = await post('/api/v1/students/open/setup-code', { matricNumber, setupCode: code });
      expect(opened.statusCode).toBe(201);
      return { cookie: sessionCookie(opened.headers), id: (jsonBody(opened).student as { id: string }).id, entryId: entry.id };
    };
    const ada = await open('240591001');
    const bola = await open('240591002');
    const chidi = await open('240591003');
    const dayo = await open('240591004');
    const efe = await open('240591005');
    const femi = await open('240592001', CIVIL);

    // 1. Students can't change their department or entry route; their profile says who can.
    for (const [method, url] of [['POST', '/api/v1/student/profile/entry-level'], ['GET', '/api/v1/student/profile/departments'], ['POST', '/api/v1/student/profile/department']] as const) {
      expect((await server.inject({ method, url, headers: { cookie: dayo.cookie }, ...(method === 'POST' ? { payload: {} } : {}) })).statusCode).toBe(404);
    }
    expect(jsonBody(await get('/api/v1/student/profile', dayo.cookie))).toMatchObject({
      departmentName: 'Electronic and Computer Engineering', entryLevel: 100, onClassList: true, setLabel: '2024/2025 set', classReps: [],
    });

    // 2. Ada becomes HOC and chooses her assistants.
    expect((await post('/api/v1/class-reps', { studentUserId: ada.id, role: 'hoc', departmentId: ids.department, entryYear: 2024 }, adminCookie)).statusCode).toBe(201);
    expect(jsonBody(await get('/api/v1/lecture/capabilities', ada.cookie))).toMatchObject({ role: 'hoc', canManageAssistants: true, canKeepClassList: true, canManageClassReps: false });
    const empty = jsonBody(await get('/api/v1/class-reps/assistants', ada.cookie));
    expect(empty).toMatchObject({ principal: { studentUserId: ada.id, role: 'hoc' }, assistants: [], available: ['registers', 'class_list', 'setup_codes'], canManage: true });

    // An assistant helps their own class: someone on another list is refused, and so is Ada herself.
    const lookupFemi = await post('/api/v1/class-reps/assistants/lookup', { query: '240592001' }, ada.cookie);
    expect(lookupFemi.statusCode).toBe(422);
    expect(jsonBody(lookupFemi).detail).toMatch(/not on the Electronic and Computer Engineering class list/);
    expect((await post('/api/v1/class-reps/assistants/lookup', { query: '240591001' }, ada.cookie)).statusCode).toBe(422);
    expect(jsonBody(await post('/api/v1/class-reps/assistants/lookup', { query: 'bola.bello@st.lasu.edu.ng' }, ada.cookie))).toMatchObject({ userId: bola.id, fullName: 'Bola Bello' });

    const bolaAppointed = await post('/api/v1/class-reps/assistants', { studentUserId: bola.id, permissions: ['registers', 'class_list'] }, ada.cookie);
    expect(bolaAppointed.statusCode).toBe(201);
    expect(jsonBody(bolaAppointed)).toMatchObject({ role: 'hoc', departmentId: ids.department, entryYear: 2024, assistantOf: { name: 'Ada Obi' }, permissions: ['registers', 'class_list'] });
    const bolaRep = jsonBody(bolaAppointed) as { id: string };
    // A HOC's assistant can't be allowed to manage HOCs.
    expect((await post('/api/v1/class-reps/assistants', { studentUserId: chidi.id, permissions: ['hocs'] }, ada.cookie)).statusCode).toBe(422);
    const chidiRep = jsonBody(await post('/api/v1/class-reps/assistants', { studentUserId: chidi.id, permissions: [] }, ada.cookie)) as { id: string };
    const third = await post('/api/v1/class-reps/assistants', { studentUserId: dayo.id, permissions: [] }, ada.cookie);
    expect(third.statusCode).toBe(409);
    expect(jsonBody(third).detail).toBe('Ada Obi already has 2 assistants. Remove one first.');

    // 3. What each assistant can do.
    expect(jsonBody(await get('/api/v1/lecture/capabilities', bola.cookie))).toMatchObject({
      canTakeAttendance: true, role: 'ahoc', roleLabel: 'Assistant HOC · Electronic and Computer Engineering · 2024/2025 set',
      canManageAssistants: false, canKeepClassList: true, assistantOf: 'Ada Obi', attendanceScopeLabel: 'Electronic and Computer Engineering',
    });
    const bolaList = jsonBody(await get('/api/v1/class-lists', bola.cookie));
    expect(bolaList).toMatchObject({ fixedDepartmentId: ids.department, canGiveSetupCodes: false, counts: { total: 5 } });
    expect((await post(`/api/v1/class-lists/entries/${dayo.entryId}/setup-code`, {}, bola.cookie)).statusCode).toBe(403);
    expect(jsonBody(await get('/api/v1/lecture/capabilities', chidi.cookie))).toMatchObject({ role: 'ahoc', canKeepClassList: false, attendanceScopeLabel: null });
    expect((await get('/api/v1/class-lists', chidi.cookie)).statusCode).toBe(403);
    // Every assistant takes attendance, recorded as an assistant's session.
    const chidiSession = await post('/api/v1/lecture/sessions', { courseCode: 'GET 201', durationMinutes: 30, qrMode: 'static' }, chidi.cookie);
    expect(chidiSession.statusCode).toBe(201);
    expect(jsonBody(chidiSession)).toMatchObject({ creatorRole: 'ahoc' });
    // Assistants see their team but can't change it.
    expect(jsonBody(await get('/api/v1/class-reps/assistants', bola.cookie))).toMatchObject({ principal: { studentUserId: ada.id }, canManage: false, assistants: [{ id: bolaRep.id }, { id: chidiRep.id }] });
    expect((await post('/api/v1/class-reps/assistants', { studentUserId: dayo.id, permissions: [] }, bola.cookie)).statusCode).toBe(403);
    expect((await post(`/api/v1/class-reps/assistants/${chidiRep.id}`, { permissions: ['class_list'] }, bola.cookie)).statusCode).toBe(403);
    expect((await get('/api/v1/class-reps', bola.cookie)).statusCode).toBe(403);
    // Ada changes what Chidi can do.
    expect(jsonBody(await post(`/api/v1/class-reps/assistants/${chidiRep.id}`, { permissions: ['class_list', 'setup_codes'] }, ada.cookie))).toMatchObject({ permissions: ['class_list', 'setup_codes'] });
    expect(jsonBody(await get('/api/v1/class-lists', chidi.cookie))).toMatchObject({ canGiveSetupCodes: true });
    // Their classmates know who to ask.
    expect(jsonBody(await get('/api/v1/student/profile', dayo.cookie))).toMatchObject({
      classReps: [{ name: 'Ada Obi', role: 'hoc' }, { name: 'Bola Bello', role: 'ahoc' }, { name: 'Chidi Eze', role: 'ahoc' }],
    });

    // 4. A student on the wrong list is moved by the HOC, within the faculty; nothing is lost.
    const hocList = jsonBody(await get('/api/v1/class-lists', ada.cookie));
    expect((hocList.moveDepartments as Array<{ code: string }>).map((department) => department.code).sort()).toEqual(['CVE', 'ECE']);
    expect((await post(`/api/v1/class-lists/entries/${efe.entryId}/move`, { departmentId: CHEMISTRY }, ada.cookie)).statusCode).toBe(403);
    expect((await post(`/api/v1/class-lists/entries/${bola.entryId}/move`, { departmentId: CIVIL }, ada.cookie)).statusCode).toBe(409);
    expect((await post(`/api/v1/class-lists/entries/${efe.entryId}/move`, { departmentId: ids.department }, ada.cookie)).statusCode).toBe(409);
    const moved = await post(`/api/v1/class-lists/entries/${efe.entryId}/move`, { departmentId: CIVIL }, ada.cookie);
    expect(moved.statusCode).toBe(200);
    expect(jsonBody(moved)).toMatchObject({ departmentId: CIVIL, departmentName: 'Civil Engineering', userId: efe.id, stage: 'joined' });
    expect((await entriesOf(ids.department)).map((entry) => entry.matricNumber)).not.toContain('240591005');
    expect(jsonBody(await get('/api/v1/student/profile', efe.cookie))).toMatchObject({ departmentName: 'Civil Engineering', onClassList: true, classReps: [] });
    // Both lists' history records it.
    const civilHistory = jsonBody(await get(`/api/v1/class-lists?departmentId=${CIVIL}&entryYear=2024`, adminCookie)).history as Array<{ action: string; matricNumber: string | null }>;
    expect(civilHistory).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'class_list_entry_moved', matricNumber: '240591005' })]));
    const eceHistory = jsonBody(await get(`/api/v1/class-lists?departmentId=${ids.department}&entryYear=2024`, adminCookie)).history as Array<{ action: string }>;
    expect(eceHistory.map((event) => event.action)).toContain('class_list_entry_moved_out');
    // Across faculties takes an administrator.
    expect(jsonBody(await post(`/api/v1/class-lists/entries/${efe.entryId}/move`, { departmentId: CHEMISTRY }, adminCookie))).toMatchObject({ departmentName: 'Chemistry' });

    // 5. An administrator (or the faculty's GHOC) can add and remove a HOC's assistants too.
    expect(jsonBody(await get(`/api/v1/class-reps/assistants?principalId=${bolaRep.id}`, adminCookie)).detail).toBe('That HOC or GHOC was not found.');
    const adaRep = (jsonBody(await get('/api/v1/class-reps/assistants', ada.cookie)).principal as { id: string });
    expect(jsonBody(await get(`/api/v1/class-reps/assistants?principalId=${adaRep.id}`, adminCookie))).toMatchObject({ canManage: true, assistants: [{ id: bolaRep.id }, { id: chidiRep.id }] });
    expect((await get(`/api/v1/class-reps/assistants?principalId=${adaRep.id}`, femi.cookie)).statusCode).toBe(404);
    // Chidi steps down himself; Dayo takes the free place.
    expect((await post(`/api/v1/class-reps/assistants/${chidiRep.id}/remove`, {}, chidi.cookie)).statusCode).toBe(200);
    expect(jsonBody(await get('/api/v1/lecture/capabilities', chidi.cookie))).toMatchObject({ canTakeAttendance: false, role: null });
    expect((await post('/api/v1/class-reps/assistants', { principalId: adaRep.id, studentUserId: dayo.id, permissions: ['registers'] }, adminCookie)).statusCode).toBe(201);

    // 6. When the HOC's appointment ends, so do their assistants'.
    expect((await post(`/api/v1/class-reps/${adaRep.id}/revoke`, {}, adminCookie)).statusCode).toBe(200);
    for (const cookie of [ada.cookie, bola.cookie, dayo.cookie]) {
      expect(jsonBody(await get('/api/v1/lecture/capabilities', cookie))).toMatchObject({ canTakeAttendance: false, role: null });
    }
    expect(sent).toEqual([]);
  } finally {
    await client.close();
  }
});
