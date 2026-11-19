import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { hashPassword } from '@lasuatos/auth';
import { AdministratorOverviewSchema, UnlistedStudentsSchema } from '@lasuatos/contracts';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { AdministratorOverviewService } from '../admin/service.js';
import { PostgresAdministratorOverviewRepository } from '../admin/postgres-repository.js';
import { StudentAuthService } from '../auth/service.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import { PostgresStudentRepository } from '../students/postgres-repository.js';
import { StudentService } from '../students/service.js';
import type { EmailTransport, StudentEmailCodeEmail } from '../email/transport.js';
import { INSTITUTION_SLUG, LECTURER_EMAIL, LECTURER_PASSWORD, applyMigrations, ids, jsonBody, seedLecturerFixture, sessionCookie } from './harness.js';

/**
 * Student accounts linked to no class-list name. The Overview counts student accounts and,
 * separately, names on class lists, so the two numbers reconcile in plain sight; the accounts on
 * no list are flagged and listed with why they are probably there (a second account for a listed
 * number, a listed name not yet linked, or a number on no list). An administrator can suspend one
 * (it is signed out everywhere) or reactivate it, with a reason that goes to the audit log. Staff
 * accounts are left to the Staff page, and adding the number to a list links the account.
 */

const ADMIN_ID = 'c9999999-9999-4999-8999-999999999999';
const ADMIN_EMAIL = 'admin@e2e.invalid';
const ADMIN_PASSWORD = 'e2e-admin-passphrase';
const PASSWORD = 'e2e-student-passphrase';

const people = {
  tester: { id: 'd1111111-1111-4111-8111-111111111111', email: 'tester@e2e.invalid', name: 'Test Account', number: '240591033' },
  double: { id: 'd2222222-2222-4222-8222-222222222222', email: 'ade.double@e2e.invalid', name: 'Ade Again', number: '240591030' },
  early: { id: 'd3333333-3333-4333-8333-333333333333', email: 'bisi.early@e2e.invalid', name: 'Bisi Early', number: '240-591-031' },
  parked: { id: 'd4444444-4444-4444-8444-444444444444', email: 'parked@e2e.invalid', name: 'Parked Account', number: 'OLD0001' },
  closed: { id: 'd5555555-5555-4555-8555-555555555555', email: 'closed@e2e.invalid', name: 'Closed Account', number: 'OLD0002' },
} as const;

it('reconciles student accounts with class lists and lets an administrator sort out accounts on no list', async () => {
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
        sendSecurityNotice: async () => undefined,
      },
      now,
    });
    const administratorOverview = new AdministratorOverviewService({ repository: new PostgresAdministratorOverviewRepository(database), now });
    const server = buildServer({ logger: false, secureCookies: false, auth, students, administratorOverview, openStudentSignUp: false });
    const post = (url: string, payload: unknown, cookie?: string) =>
      server.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, ...(cookie ? { headers: { cookie } } : {}) });
    const get = (url: string, cookie?: string) => server.inject({ method: 'GET', url, ...(cookie ? { headers: { cookie } } : {}) });
    const lastCode = () => {
      const last = codes.at(-1);
      if (!last) throw new Error('no code sent');
      return last.code;
    };
    const login = (email: string) => post('/api/v1/auth/login', { email, password: PASSWORD });
    const overview = async (cookie: string) => AdministratorOverviewSchema.parse(jsonBody(await get('/api/v1/admin/overview', cookie)));
    const unlisted = async (cookie: string) => UnlistedStudentsSchema.parse(jsonBody(await get('/api/v1/class-lists/unlisted-accounts', cookie)));
    const change = (userId: string, action: 'suspend' | 'reactivate', reason: string, cookie: string) =>
      post(`/api/v1/class-lists/unlisted-accounts/${userId}/${action}`, { reason }, cookie);

    const adminCookie = sessionCookie((await post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).headers);
    expect(jsonBody(await post('/api/v1/class-lists/import', {
      departmentId: ids.department,
      entryYear: 2024,
      rows: [
        { matricNumber: '240591030', surname: 'Ade', firstName: 'Tunde', lasuEmail: 'tunde.ade@st.lasu.edu.ng' },
        { matricNumber: '240591031', surname: 'Bisi', firstName: 'Ola' },
        { matricNumber: '240591032', surname: 'Chidi', firstName: 'Obi' },
      ],
      apply: true,
    }, adminCookie))).toMatchObject({ applied: true, added: 3 });

    // Tunde opens his account from the list.
    expect((await post('/api/v1/students/open/code', { matricNumber: '240591030' })).statusCode).toBe(200);
    const tunde = await post('/api/v1/students/open', { matricNumber: '240591030', code: lastCode() });
    expect(tunde.statusCode).toBe(201);
    const tundeId = String((jsonBody(tunde).student as { id: string }).id);
    const tundeCookie = sessionCookie(tunde.headers);

    // Accounts on no list: a test account, a second account for Tunde's number, one opened with
    // Bisi's number after the list was uploaded, an old one already suspended, and a closed one.
    const hash = await hashPassword(PASSWORD);
    for (const [person, status] of [[people.tester, 'active'], [people.double, 'active'], [people.early, 'active'], [people.parked, 'suspended'], [people.closed, 'closed']] as const) {
      await client.query(
        `INSERT INTO users (id, institution_id, email, display_name, password_hash, status, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [person.id, ids.institution, person.email, person.name, hash, status, clock.toISOString()],
      );
      await client.query(
        `INSERT INTO student_profiles (user_id, institution_id, department_id, student_number) VALUES ($1, $2, $3, $4)`,
        [person.id, ids.institution, ids.department, person.number],
      );
      await client.query(
        `INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, 'student', 'institution', $2)`,
        [person.id, ids.institution],
      );
      later(60);
    }
    // The lecturer also has a student account (a postgraduate who lectures).
    await client.query(
      `INSERT INTO student_profiles (user_id, institution_id, department_id, student_number) VALUES ($1, $2, $3, 'PG0001')`,
      [ids.lecturer, ids.institution, ids.department],
    );
    await client.query(
      `INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, 'student', 'institution', $2)`,
      [ids.lecturer, ids.institution],
    );
    const testerCookie = sessionCookie((await login(people.tester.email)).headers);

    // The Overview: 5 accounts can sign in (Tunde, three unlisted, the lecturer's), 3 names are
    // on the lists and 1 has opened, and 4 accounts that can sign in are on no list.
    const first = await overview(adminCookie);
    expect(first.metrics).toMatchObject({ activeStudents: 5, onClassLists: 3, openedAccounts: 1, unlistedStudents: 4, unlistedSuspended: 1 });
    // Levels count the class-list names, so they add up to the lists.
    expect(first.studentLevels.reduce((sum, group) => sum + group.count, 0)).toBe(3);

    // Only administrators see or change them.
    expect((await get('/api/v1/class-lists/unlisted-accounts', tundeCookie)).statusCode).toBe(403);
    const lecturerCookie = sessionCookie((await post('/api/v1/auth/login', { email: LECTURER_EMAIL, password: LECTURER_PASSWORD })).headers);
    expect((await get('/api/v1/class-lists/unlisted-accounts', lecturerCookie)).statusCode).toBe(403);
    expect((await change(people.tester.id, 'suspend', 'Test or practice account', tundeCookie)).statusCode).toBe(403);
    expect((await get('/api/v1/class-lists/unlisted-accounts')).statusCode).toBe(401);

    const list = await unlisted(adminCookie);
    expect(list.total).toBe(5);
    const byId = new Map(list.accounts.map((account) => [account.userId, account]));
    expect([...byId.keys()]).not.toContain(people.closed.id);
    expect([...byId.keys()]).not.toContain(tundeId);
    expect(byId.get(people.tester.id)).toMatchObject({ name: 'Test Account', status: 'active', listed: null, isStaff: false, attendanceRecords: 0, faceRegistered: false, emailConfirmed: false });
    expect(byId.get(people.tester.id)?.lastSeenAt).not.toBeNull();
    expect(byId.get(people.double.id)?.listed).toEqual({ departmentCode: 'ECE', departmentName: 'Electronic and Computer Engineering', entryYear: 2024, linkedToAnother: true });
    // Matched the way an upload matches an account: punctuation in the number is ignored.
    expect(byId.get(people.early.id)?.listed).toMatchObject({ entryYear: 2024, linkedToAnother: false });
    expect(byId.get(people.parked.id)).toMatchObject({ status: 'suspended', lastSeenAt: null });
    expect(byId.get(ids.lecturer)).toMatchObject({ isStaff: true });

    // A reason is needed; staff accounts, listed accounts and unknown ones are refused.
    expect((await change(people.tester.id, 'suspend', 'no', adminCookie)).statusCode).toBe(422);
    const staff = await change(ids.lecturer, 'suspend', 'Test or practice account', adminCookie);
    expect(staff.statusCode).toBe(409);
    expect(jsonBody(staff).detail).toMatch(/Staff page/);
    const listed = await change(tundeId, 'suspend', 'Test or practice account', adminCookie);
    expect(listed.statusCode).toBe(409);
    expect(jsonBody(listed).detail).toMatch(/class list/);
    expect((await change(people.closed.id, 'suspend', 'Test or practice account', adminCookie)).statusCode).toBe(404);
    expect((await change('d9999999-9999-4999-8999-999999999999', 'suspend', 'Test or practice account', adminCookie)).statusCode).toBe(404);

    // Suspending signs the test account out everywhere and keeps it out.
    later(30);
    const suspended = await change(people.tester.id, 'suspend', '  Test or   practice account ', adminCookie);
    expect(suspended.statusCode).toBe(200);
    expect(jsonBody(suspended)).toEqual({ userId: people.tester.id, status: 'suspended' });
    expect((await get('/api/v1/auth/session', testerCookie)).statusCode).toBe(401);
    expect((await login(people.tester.email)).statusCode).toBe(401);
    // Doing it twice changes nothing and is not audited twice.
    expect((await change(people.tester.id, 'suspend', 'Test or practice account', adminCookie)).statusCode).toBe(200);
    const audits = await client.query<{ action: string; details: string; matric_number: string; actor_user_id: string }>(
      `SELECT action, details, matric_number, actor_user_id FROM student_audit_events WHERE subject_user_id = $1 ORDER BY created_at`,
      [people.tester.id],
    );
    expect(audits.rows).toEqual([{
      action: 'student_account_suspended',
      details: 'not on any class list; 1 session(s) signed out. Reason: Test or practice account',
      matric_number: '240591033',
      actor_user_id: ADMIN_ID,
    }]);

    // The Overview follows: one fewer account that can sign in, one more suspended.
    expect((await overview(adminCookie)).metrics).toMatchObject({ activeStudents: 4, unlistedStudents: 3, unlistedSuspended: 2 });

    // Reactivated (it was the student's after all): it can sign in again.
    later(30);
    expect((await change(people.tester.id, 'reactivate', 'Suspended by mistake', adminCookie)).statusCode).toBe(200);
    expect((await login(people.tester.email)).statusCode).toBe(200);

    // Adding its number to the class list links the account by itself, and it leaves the list
    // of accounts on no list.
    expect(jsonBody(await post('/api/v1/class-lists/import', {
      departmentId: ids.department,
      entryYear: 2024,
      rows: [{ matricNumber: '240591033', surname: 'Account', firstName: 'Test' }],
      apply: true,
    }, adminCookie))).toMatchObject({ applied: true });
    const after = await unlisted(adminCookie);
    expect(after.accounts.map((account) => account.userId)).not.toContain(people.tester.id);
    expect((await overview(adminCookie)).metrics).toMatchObject({ onClassLists: 4, openedAccounts: 2 });
  } finally {
    await client.close();
  }
});
