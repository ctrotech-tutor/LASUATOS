import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { DatabaseClient } from '@lasuatos/database';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { StudentAuthService } from '../auth/service.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import type { StaffInvitationEmail, StaffRoleChangedEmail } from '../email/transport.js';
import { PostgresStaffRepository } from '../staff/postgres-repository.js';
import { StaffService } from '../staff/service.js';
import { parseBootstrapArguments, runBootstrap } from '../staff/bootstrap.js';
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
 * Staff provisioning end to end against embedded PostgreSQL: the bootstrap
 * command invites the first administrator, administrators invite staff within
 * their own area, invitees accept with a password and are signed in, and
 * suspension signs a person out everywhere. Every change is audited.
 */

const DAY = 24 * 60 * 60 * 1_000;
const APP_ORIGIN = 'https://attendance.example.edu';
const SCIENCE_FACULTY = 'c7777777-7777-4777-8777-777777777777';
const COMPUTER_SCIENCE = 'c8888888-8888-4888-8888-888888888888';

async function setup() {
  const client = new PGlite();
  await applyMigrations(client);
  await seedLecturerFixture(client);
  await client.query('INSERT INTO faculties (id, institution_id, code, name) VALUES ($1, $2, $3, $4)', [
    SCIENCE_FACULTY, ids.institution, 'SCI', 'Faculty of Science',
  ]);
  await client.query(
    'INSERT INTO departments (id, institution_id, faculty_id, code, name) VALUES ($1, $2, $3, $4, $5)',
    [COMPUTER_SCIENCE, ids.institution, SCIENCE_FACULTY, 'CSC', 'Computer Science'],
  );
  const database = drizzle(client) as unknown as DatabaseClient;

  let clock = new Date();
  const advance = (milliseconds: number) => { clock = new Date(clock.getTime() + milliseconds); };
  const invitations: StaffInvitationEmail[] = [];
  const roleChanges: StaffRoleChangedEmail[] = [];
  const authRepository = new PostgresAuthRepository(database);
  const repository = new PostgresStaffRepository(database);
  const staff = new StaffService({
    repository,
    authRepository,
    emailTransport: {
      sendVerification: async () => undefined,
      sendPasswordReset: async () => undefined,
      sendSecurityNotice: async () => undefined,
      sendStaffInvitation: async (email) => { invitations.push(email); },
      sendStaffRoleChanged: async (email) => { roleChanges.push(email); },
    },
    now: () => clock,
  });
  const server = buildServer({
    logger: false,
    trustedOrigins: [APP_ORIGIN],
    auth: new StudentAuthService({ repository: authRepository, institutionSlug: INSTITUTION_SLUG, now: () => clock }),
    staff,
  });

  const tokenFor = (email: string) => {
    const message = invitations.filter((item) => item.to === email).at(-1);
    if (!message) throw new Error(`No invitation email for ${email}`);
    return message.token;
  };
  const accept = async (token: string, password = 'a-strong-staff-passphrase') => server.inject({
    method: 'POST', url: '/api/v1/staff-invitations/accept', payload: { token, password },
  });
  const acceptAs = async (email: string, password?: string) => {
    const response = await accept(tokenFor(email), password);
    expect(response.statusCode).toBe(200);
    return { cookie: sessionCookie(response.headers), body: jsonBody(response) };
  };
  const invite = async (cookie: string, payload: Record<string, unknown>) => server.inject({
    method: 'POST', url: '/api/v1/admin/staff/invitations', headers: { cookie }, payload,
  });
  const sessionStatus = async (cookie: string) => (
    await server.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie } })
  ).statusCode;
  const login = async (email: string, password = 'a-strong-staff-passphrase') => server.inject({
    method: 'POST', url: '/api/v1/auth/login', payload: { email, password },
  });

  return { client, server, staff, repository, invitations, roleChanges, advance, now: () => clock, tokenFor, accept, acceptAs, invite, sessionStatus, login };
}

describe('staff provisioning over HTTP with PostgreSQL', () => {
  it('bootstraps an administrator, invites staff within scope, and suspends with session revocation', async () => {
    const t = await setup();
    try {
      // 1. Server-side bootstrap creates the first administrator invitation.
      const outcome = await runBootstrap(
        parseBootstrapArguments(['--', '--email', 'Head.Admin@E2E.invalid', '--name', 'Head Admin'], INSTITUTION_SLUG),
        { staff: t.staff, repository: t.repository, publicAppUrl: APP_ORIGIN },
      );
      expect(outcome).toMatchObject({ email: 'head.admin@e2e.invalid', roleLabel: 'Institution administrator', emailSent: true, link: null });
      const headToken = t.tokenFor('head.admin@e2e.invalid');
      expect(t.invitations[0]?.invitedByName).toBeNull();

      // 2. The invitee previews, then accepts, and is signed in as an administrator.
      const preview = await t.server.inject({ method: 'POST', url: '/api/v1/staff-invitations/preview', payload: { token: headToken } });
      expect(preview.statusCode).toBe(200);
      expect(jsonBody(preview)).toMatchObject({ role: 'institution_administrator', scopeLabel: 'E2E Demo Institution', invitedByName: null });
      expect((await t.accept(headToken, 'short')).statusCode).toBe(400);
      const head = await t.acceptAs('head.admin@e2e.invalid');
      expect(head.body.account).toMatchObject({ accountType: 'administrator', role: 'institution_administrator', emailVerified: true });
      expect(await t.sessionStatus(head.cookie)).toBe(200);
      // Links work once.
      expect((await t.accept(headToken)).statusCode).toBe(404);
      expect((await t.server.inject({ method: 'POST', url: '/api/v1/staff-invitations/preview', payload: { token: headToken } })).statusCode).toBe(404);

      // 3. The institution administrator may grant every staff role.
      const options = jsonBody(await t.server.inject({ method: 'GET', url: '/api/v1/admin/staff/options', headers: { cookie: head.cookie } }));
      expect(options.allowedRoles).toEqual(['lecturer', 'department_administrator', 'faculty_administrator', 'institution_administrator']);
      expect((options.departments as unknown[]).length).toBe(2);

      const facultyInvite = await t.invite(head.cookie, {
        email: 'eng.admin@e2e.invalid', displayName: 'Engineering Admin', role: 'faculty_administrator', facultyId: ids.faculty,
      });
      expect(facultyInvite.statusCode).toBe(201);
      expect(facultyInvite.body).not.toMatch(/[A-Za-z0-9_-]{43}/); // the token only travels by email
      expect(jsonBody(facultyInvite)).toMatchObject({ emailSent: true, invitation: { scopeLabel: 'Faculty of Engineering', invitedByName: 'Head Admin' } });
      const engineering = await t.acceptAs('eng.admin@e2e.invalid');

      // 4. A faculty administrator stays inside their own faculty and level.
      const facultyOptions = jsonBody(await t.server.inject({ method: 'GET', url: '/api/v1/admin/staff/options', headers: { cookie: engineering.cookie } }));
      expect(facultyOptions.allowedRoles).toEqual(['lecturer', 'department_administrator', 'faculty_administrator']);
      expect((facultyOptions.departments as Array<{ id: string }>).map((department) => department.id)).toEqual([ids.department]);
      const outside = await t.invite(engineering.cookie, {
        email: 'csc.lecturer@e2e.invalid', displayName: 'Science Lecturer', role: 'lecturer', departmentId: COMPUTER_SCIENCE, staffNumber: 'SCI-1',
      });
      expect(outside.statusCode).toBe(403);
      const higher = await t.invite(engineering.cookie, {
        email: 'another.head@e2e.invalid', displayName: 'Another Head', role: 'institution_administrator',
      });
      expect(higher.statusCode).toBe(403);
      const badStaffNumber = await t.invite(engineering.cookie, {
        email: 'new.lecturer@e2e.invalid', displayName: 'New Lecturer', role: 'lecturer', departmentId: ids.department, staffNumber: 'ENG#200',
      });
      expect(badStaffNumber.statusCode).toBe(400);

      const lecturerInvite = await t.invite(engineering.cookie, {
        email: 'new.lecturer@e2e.invalid', displayName: 'New Lecturer', role: 'lecturer', departmentId: ids.department, staffNumber: 'ENG-200',
      });
      expect(lecturerInvite.statusCode).toBe(201);
      // Duplicates, existing accounts and taken staff numbers are refused.
      expect(jsonBody(await t.invite(engineering.cookie, {
        email: 'NEW.lecturer@e2e.invalid', displayName: 'Again', role: 'lecturer', departmentId: ids.department, staffNumber: 'ENG-201',
      })).detail).toMatch(/pending invitation/);
      expect((await t.invite(engineering.cookie, {
        email: LECTURER_EMAIL, displayName: 'Existing', role: 'lecturer', departmentId: ids.department, staffNumber: 'ENG-202',
      })).statusCode).toBe(409);
      expect(jsonBody(await t.invite(engineering.cookie, {
        email: 'dup.number@e2e.invalid', displayName: 'Dup', role: 'lecturer', departmentId: ids.department, staffNumber: 'E2E-STAFF-1',
      })).detail).toMatch(/staff number/);
      // Cross-site requests are refused by the origin guard.
      expect((await t.server.inject({
        method: 'POST', url: '/api/v1/admin/staff/invitations',
        headers: { cookie: engineering.cookie, origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
        payload: { email: 'x@e2e.invalid', displayName: 'X', role: 'lecturer', departmentId: ids.department, staffNumber: 'X-1' },
      })).statusCode).toBe(403);

      // 5. Resend rotates the link; revoke kills it.
      const lecturerInvitationId = (jsonBody(lecturerInvite).invitation as { id: string }).id;
      const firstToken = t.tokenFor('new.lecturer@e2e.invalid');
      t.advance(DAY);
      const resent = await t.server.inject({
        method: 'POST', url: `/api/v1/admin/staff/invitations/${lecturerInvitationId}/resend`, headers: { cookie: engineering.cookie },
      });
      expect(resent.statusCode).toBe(200);
      expect((await t.accept(firstToken)).statusCode).toBe(404);

      const doomed = jsonBody(await t.invite(head.cookie, {
        email: 'doomed@e2e.invalid', displayName: 'Doomed', role: 'department_administrator', departmentId: COMPUTER_SCIENCE,
      })).invitation as { id: string };
      // The Engineering admin cannot see or revoke an invitation for Science.
      expect((await t.server.inject({
        method: 'POST', url: `/api/v1/admin/staff/invitations/${doomed.id}/revoke`, headers: { cookie: engineering.cookie },
      })).statusCode).toBe(404);
      expect((await t.server.inject({
        method: 'POST', url: `/api/v1/admin/staff/invitations/${doomed.id}/revoke`, headers: { cookie: head.cookie },
      })).statusCode).toBe(204);
      expect((await t.accept(t.tokenFor('doomed@e2e.invalid'))).statusCode).toBe(404);

      // 6. The lecturer accepts and lands in the lecturer workspace, then signs in normally.
      const lecturer = await t.acceptAs('new.lecturer@e2e.invalid', 'lecturer-chosen-passphrase');
      expect(lecturer.body.account).toMatchObject({ accountType: 'lecturer', email: 'new.lecturer@e2e.invalid' });
      expect((await t.login('new.lecturer@e2e.invalid', 'lecturer-chosen-passphrase')).statusCode).toBe(200);
      const lecturerProfile = await t.client.query<{ staff_number: string; department_id: string }>(
        'SELECT staff_number, department_id FROM lecturer_profiles lp JOIN users u ON u.id = lp.user_id WHERE u.email = $1',
        ['new.lecturer@e2e.invalid'],
      );
      expect(lecturerProfile.rows[0]).toEqual({ staff_number: 'ENG-200', department_id: ids.department });
      // Lecturers cannot use the staff tools.
      expect((await t.server.inject({ method: 'GET', url: '/api/v1/admin/staff', headers: { cookie: lecturer.cookie } })).statusCode).toBe(403);
      expect((await t.server.inject({ method: 'GET', url: '/api/v1/admin/staff' })).statusCode).toBe(401);

      // 7. The directory only shows people the administrator could manage (plus themselves).
      const directory = jsonBody(await t.server.inject({ method: 'GET', url: '/api/v1/admin/staff', headers: { cookie: engineering.cookie } }));
      const members = directory.members as Array<{ userId: string; email: string; manageable: boolean; isSelf: boolean }>;
      expect(members.map((member) => member.email).sort()).toEqual(['eng.admin@e2e.invalid', LECTURER_EMAIL, 'new.lecturer@e2e.invalid'].sort());
      expect(members.find((member) => member.isSelf)?.manageable).toBe(false);
      const target = members.find((member) => member.email === 'new.lecturer@e2e.invalid')!;
      expect(target.manageable).toBe(true);

      // Activity: when they last used the app, and the sessions they started lately.
      type Activity = { email: string; lastActiveAt: string | null; recentSessions: number; lastSessionAt: string | null };
      const activityOf = (body: Record<string, unknown>) => (body.members as Activity[]).find((member) => member.email === 'new.lecturer@e2e.invalid')!;
      expect(activityOf(directory)).toMatchObject({ recentSessions: 0, lastSessionAt: null });
      expect(activityOf(directory).lastActiveAt).not.toBeNull();
      const startedAt = (daysAgo: number) => new Date(t.now().getTime() - daysAgo * DAY);
      for (const [index, daysAgo] of [2, 9, 45].entries()) {
        await t.client.query(
          `INSERT INTO lecture_sessions (institution_id, created_by_user_id, creator_role, course_code, course_title, qr_mode, secret, public_code, starts_at, ends_at)
           VALUES ($1, $2, 'lecturer', 'ENG 101', 'Engineering', 'dynamic', $3, $4, $5, $6)`,
          [ids.institution, target.userId, `secret-${index}`, `90000${index}`, startedAt(daysAgo), new Date(startedAt(daysAgo).getTime() + 3_600_000)],
        );
      }
      const active = jsonBody(await t.server.inject({ method: 'GET', url: '/api/v1/admin/staff', headers: { cookie: engineering.cookie } }));
      expect(activityOf(active).recentSessions).toBe(2);
      expect(Date.parse(activityOf(active).lastSessionAt!)).toBe(startedAt(2).getTime());
      const headDirectory = jsonBody(await t.server.inject({ method: 'GET', url: '/api/v1/admin/staff', headers: { cookie: head.cookie } }));
      const headId = (headDirectory.members as Array<{ userId: string; isSelf: boolean }>).find((member) => member.isSelf)!.userId;

      // 8. Suspension needs a reason, signs the person out everywhere and blocks sign-in.
      const suspendUrl = `/api/v1/admin/staff/members/${target.userId}/suspend`;
      expect((await t.server.inject({ method: 'POST', url: suspendUrl, headers: { cookie: engineering.cookie }, payload: { reason: 'short' } })).statusCode).toBe(400);
      expect((await t.server.inject({
        method: 'POST', url: `/api/v1/admin/staff/members/${headId}/suspend`, headers: { cookie: engineering.cookie },
        payload: { reason: 'Trying to suspend a more senior administrator.' },
      })).statusCode).toBe(404);
      expect((await t.server.inject({
        method: 'POST', url: `/api/v1/admin/staff/members/${headId}/suspend`, headers: { cookie: head.cookie },
        payload: { reason: 'Trying to suspend my own account by mistake.' },
      })).statusCode).toBe(403);
      const suspended = await t.server.inject({
        method: 'POST', url: suspendUrl, headers: { cookie: engineering.cookie }, payload: { reason: 'Left the department at the end of session.' },
      });
      expect(suspended.statusCode).toBe(204);
      expect(await t.sessionStatus(lecturer.cookie)).toBe(401);
      expect((await t.login('new.lecturer@e2e.invalid', 'lecturer-chosen-passphrase')).statusCode).toBe(401);
      expect((await t.server.inject({
        method: 'POST', url: suspendUrl, headers: { cookie: engineering.cookie }, payload: { reason: 'Suspending the same person twice.' },
      })).statusCode).toBe(409);

      const reactivated = await t.server.inject({
        method: 'POST', url: `/api/v1/admin/staff/members/${target.userId}/reactivate`, headers: { cookie: engineering.cookie },
        payload: { reason: 'Returned for the second semester.' },
      });
      expect(reactivated.statusCode).toBe(204);
      expect((await t.login('new.lecturer@e2e.invalid', 'lecturer-chosen-passphrase')).statusCode).toBe(200);

      // 9. Every change is in the append-only staff audit trail with actor and reason.
      const audit = await t.client.query<{ action: string; reason: string | null; actor_user_id: string | null }>(
        'SELECT action, reason, actor_user_id FROM staff_audit_events ORDER BY created_at, action',
      );
      const actions = audit.rows.map((row) => row.action);
      for (const action of ['invitation_created', 'invitation_accepted', 'invitation_resent', 'invitation_revoked', 'staff_suspended', 'staff_reactivated']) {
        expect(actions).toContain(action);
      }
      expect(audit.rows.find((row) => row.action === 'staff_suspended')?.reason).toBe('Left the department at the end of session.');
      const created = audit.rows.filter((row) => row.action === 'invitation_created');
      expect(created.filter((row) => row.actor_user_id === null)).toHaveLength(1); // only the bootstrap invitation
      await expect(t.client.query("UPDATE staff_audit_events SET reason = 'edited'")).rejects.toThrow();
      await expect(t.client.query('DELETE FROM staff_audit_events')).rejects.toThrow();

      // 10. Staff numbers are LASU's own and optional: the administrator may leave it out,
      // the lecturer can give it on accepting, or add it once later from their account.
      const staffNumberOf = async (email: string) => (await t.client.query<{ staff_number: string | null }>(
        'SELECT staff_number FROM lecturer_profiles lp JOIN users u ON u.id = lp.user_id WHERE u.email = $1', [email],
      )).rows[0]?.staff_number;
      for (const email of ['own.number@e2e.invalid', 'later.number@e2e.invalid']) {
        expect((await t.invite(engineering.cookie, { email, displayName: 'Number Test', role: 'lecturer', departmentId: ids.department })).statusCode).toBe(201);
      }
      const numberPreview = await t.server.inject({ method: 'POST', url: '/api/v1/staff-invitations/preview', payload: { token: t.tokenFor('own.number@e2e.invalid') } });
      expect(jsonBody(numberPreview)).toMatchObject({ role: 'lecturer', staffNumber: null });
      const taken = await t.server.inject({
        method: 'POST', url: '/api/v1/staff-invitations/accept',
        payload: { token: t.tokenFor('own.number@e2e.invalid'), password: 'a-strong-staff-passphrase', staffNumber: 'eng-200' },
      });
      expect(taken.statusCode).toBe(409);
      const own = await t.server.inject({
        method: 'POST', url: '/api/v1/staff-invitations/accept',
        payload: { token: t.tokenFor('own.number@e2e.invalid'), password: 'a-strong-staff-passphrase', staffNumber: ' eng  300 ' },
      });
      expect(own.statusCode).toBe(200);
      expect(await staffNumberOf('own.number@e2e.invalid')).toBe('ENG 300');
      const ownCookie = sessionCookie(own.headers);
      const ownChange = await t.server.inject({ method: 'POST', url: '/api/v1/auth/profile', headers: { cookie: ownCookie }, payload: { staffNumber: 'ENG 301' } });
      expect(ownChange.statusCode).toBe(409);

      const later = await t.acceptAs('later.number@e2e.invalid');
      expect(await staffNumberOf('later.number@e2e.invalid')).toBeNull();
      expect(later.body.account).toMatchObject({ accountType: 'lecturer', staffNumber: null });
      const clash = await t.server.inject({ method: 'POST', url: '/api/v1/auth/profile', headers: { cookie: later.cookie }, payload: { staffNumber: 'ENG 300' } });
      expect(clash.statusCode).toBe(409);
      const added = await t.server.inject({ method: 'POST', url: '/api/v1/auth/profile', headers: { cookie: later.cookie }, payload: { staffNumber: 'eng-400' } });
      expect(jsonBody(added)).toMatchObject({ status: 'profile_updated', staffNumber: 'ENG-400' });
      expect(jsonBody(await t.server.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: later.cookie } })).account).toMatchObject({ staffNumber: 'ENG-400' });
      // An administrator can still correct or clear it.
      const laterId = (await t.client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', ['later.number@e2e.invalid'])).rows[0]!.id;
      const cleared = await t.server.inject({ method: 'POST', url: `/api/v1/admin/staff/members/${laterId}`, headers: { cookie: engineering.cookie }, payload: { staffNumber: null } });
      expect(cleared.statusCode).toBe(204);
      expect(await staffNumberOf('later.number@e2e.invalid')).toBeNull();
    } finally {
      await t.client.close();
    }
  });

  it('moves a staff member to another role or area without a new invitation', async () => {
    const t = await setup();
    try {
      await runBootstrap(
        parseBootstrapArguments(['--email', 'head@e2e.invalid', '--name', 'Head Admin'], INSTITUTION_SLUG),
        { staff: t.staff, repository: t.repository, publicAppUrl: APP_ORIGIN },
      );
      const head = await t.acceptAs('head@e2e.invalid');
      expect((await t.invite(head.cookie, { email: 'eng@e2e.invalid', displayName: 'Engineering Admin', role: 'faculty_administrator', facultyId: ids.faculty })).statusCode).toBe(201);
      const engineering = await t.acceptAs('eng@e2e.invalid');

      // The fixture lecturer teaches ENG 301 this semester (with a colleague) and ENG 201 alone;
      // ENG 101 was last session's and must stay in the record.
      await t.client.query(
        `INSERT INTO academic_sessions (id, institution_id, code, starts_at, ends_at)
         VALUES ('c9999999-9999-4999-8999-999999999999', $1, '2025/26', CURRENT_TIMESTAMP - interval '400 days', CURRENT_TIMESTAMP - interval '61 days')`,
        [ids.institution],
      );
      await t.client.query(
        `INSERT INTO semesters (id, institution_id, academic_session_id, name, starts_at, ends_at)
         VALUES ('ca999999-9999-4999-8999-999999999999', $1, 'c9999999-9999-4999-8999-999999999999', 'First Semester', CURRENT_TIMESTAMP - interval '400 days', CURRENT_TIMESTAMP - interval '300 days')`,
        [ids.institution],
      );
      const colleague = 'cb999999-9999-4999-8999-999999999999';
      await t.client.query(
        `INSERT INTO users (id, institution_id, email, display_name, password_hash, status, email_verified_at)
         VALUES ($1, $2, 'colleague@e2e.invalid', 'Colleague', 'x', 'active', CURRENT_TIMESTAMP)`,
        [colleague, ids.institution],
      );
      await t.client.query('INSERT INTO lecturer_profiles (user_id, institution_id, department_id) VALUES ($1, $2, $3)', [colleague, ids.institution, ids.department]);
      const offering = async (code: string, semester: string, lecturers: string[]) => {
        const course = await t.client.query<{ id: string }>(
          'INSERT INTO courses (institution_id, code, title, credit_units) VALUES ($1, $2, $3, 3) RETURNING id', [ids.institution, code, `${code} title`],
        );
        const row = await t.client.query<{ id: string }>(
          'INSERT INTO course_offerings (institution_id, course_id, department_id, semester_id, level) VALUES ($1, $2, $3, $4, $5) RETURNING id',
          [ids.institution, course.rows[0]!.id, ids.department, semester, '300'],
        );
        for (const lecturer of lecturers) {
          await t.client.query('INSERT INTO course_assignments (institution_id, course_offering_id, lecturer_user_id) VALUES ($1, $2, $3)', [ids.institution, row.rows[0]!.id, lecturer]);
        }
        return row.rows[0]!.id;
      };
      await offering('ENG 301', ids.semester, [ids.lecturer, colleague]);
      await offering('ENG 201', ids.semester, [ids.lecturer]);
      await offering('ENG 101', 'ca999999-9999-4999-8999-999999999999', [ids.lecturer]);
      const assignmentsOf = async (userId: string) => (await t.client.query<{ code: string }>(
        `SELECT c.code FROM course_assignments ca JOIN course_offerings o ON o.id = ca.course_offering_id JOIN courses c ON c.id = o.course_id
         WHERE ca.lecturer_user_id = $1 ORDER BY c.code`, [userId],
      )).rows.map((row) => row.code);

      const lecturerLogin = await t.login(LECTURER_EMAIL, LECTURER_PASSWORD);
      expect(lecturerLogin.statusCode).toBe(200);
      const lecturerCookie = sessionCookie(lecturerLogin.headers);
      const position = (cookie: string, userId: string, payload: Record<string, unknown>) => t.server.inject({
        method: 'POST', url: `/api/v1/admin/staff/members/${userId}/position`, headers: { cookie }, payload,
      });
      const toHod = { role: 'department_administrator', departmentId: ids.department, reason: 'Appointed acting HOD from 1 December.' };

      // 1. The directory says where each person sits, so the form can start from it.
      const directory = jsonBody(await t.server.inject({ method: 'GET', url: '/api/v1/admin/staff', headers: { cookie: engineering.cookie } }));
      const members = directory.members as Array<{ userId: string; email: string; role: string; facultyId: string | null; departmentId: string | null }>;
      expect(members.find((member) => member.userId === ids.lecturer)).toMatchObject({ role: 'lecturer', facultyId: null, departmentId: ids.department });
      expect(members.find((member) => member.email === 'eng@e2e.invalid')).toMatchObject({ role: 'faculty_administrator', facultyId: ids.faculty, departmentId: null });

      // 2. A preview says what would happen and changes nothing.
      const preview = await position(engineering.cookie, ids.lecturer, { ...toHod, apply: false });
      expect(preview.statusCode).toBe(200);
      expect(jsonBody(preview)).toMatchObject({
        applied: false,
        emailSent: false,
        workspaceChanges: true,
        teachingNow: false,
        openDisputes: 0,
        from: { role: 'lecturer' },
        to: { role: 'department_administrator' },
        coursesLeaving: [
          { courseCode: 'ENG 201', otherLecturers: 0 },
          { courseCode: 'ENG 301', otherLecturers: 1 },
        ],
      });
      expect(await assignmentsOf(ids.lecturer)).toEqual(['ENG 101', 'ENG 201', 'ENG 301']);

      // 3. Guards: reasons, their own role, unknown or outside places, no-op moves, people outside the area.
      expect((await position(engineering.cookie, ids.lecturer, { ...toHod, reason: 'no', apply: true })).statusCode).toBe(400);
      expect((await position(engineering.cookie, ids.lecturer, { role: 'lecturer', reason: 'Missing department', apply: true })).statusCode).toBe(400);
      const engineeringId = members.find((member) => member.email === 'eng@e2e.invalid')!.userId;
      const own = await position(engineering.cookie, engineeringId, { ...toHod, apply: true });
      expect(own.statusCode).toBe(403);
      expect(jsonBody(own).detail).toMatch(/your own role/);
      expect((await position(engineering.cookie, ids.lecturer, { ...toHod, departmentId: COMPUTER_SCIENCE, apply: true })).statusCode).toBe(403);
      expect((await position(engineering.cookie, ids.lecturer, { ...toHod, departmentId: 'cfffffff-ffff-4fff-8fff-ffffffffffff', apply: true })).statusCode).toBe(403);
      expect((await position(engineering.cookie, ids.lecturer, { role: 'institution_administrator', reason: 'Trying to grant more than I hold.', apply: true })).statusCode).toBe(403);
      const unchanged = await position(engineering.cookie, ids.lecturer, { role: 'lecturer', departmentId: ids.department, reason: 'Nothing actually changes here.', apply: true });
      expect(unchanged.statusCode).toBe(409);
      expect(jsonBody(unchanged).detail).toMatch(/already have that role/);
      const headId = (await t.client.query<{ id: string }>('SELECT id FROM users WHERE email = $1', ['head@e2e.invalid'])).rows[0]!.id;
      expect((await position(engineering.cookie, headId, { ...toHod, apply: true })).statusCode).toBe(404);

      // 4. Not while they are taking attendance: the register stays theirs to finish.
      const lecture = await t.client.query<{ id: string }>(
        `INSERT INTO lecture_sessions (institution_id, created_by_user_id, creator_role, course_code, course_title, qr_mode, secret, public_code, starts_at, ends_at)
         VALUES ($1, $2, 'lecturer', 'ENG 301', 'Engineering', 'dynamic', 'secret-live', '700001', $3, $4) RETURNING id`,
        [ids.institution, ids.lecturer, new Date(t.now().getTime() - 600_000), new Date(t.now().getTime() + 3_000_000)],
      );
      expect(jsonBody(await position(engineering.cookie, ids.lecturer, { ...toHod, apply: false })).teachingNow).toBe(true);
      const busy = await position(engineering.cookie, ids.lecturer, { ...toHod, apply: true });
      expect(busy.statusCode).toBe(409);
      expect(jsonBody(busy).detail).toMatch(/taking attendance right now/);
      await t.client.query('UPDATE lecture_sessions SET closed_at = $2 WHERE id = $1', [lecture.rows[0]!.id, t.now()]);

      // 5. The change: same account and password, new workspace on the very next request.
      const applied = await position(engineering.cookie, ids.lecturer, { ...toHod, apply: true });
      expect(applied.statusCode).toBe(200);
      expect(jsonBody(applied)).toMatchObject({ applied: true, emailSent: true, coursesLeaving: [{ courseCode: 'ENG 201' }, { courseCode: 'ENG 301' }] });
      const session = jsonBody(await t.server.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: lecturerCookie } }));
      expect(session.account).toMatchObject({ accountType: 'administrator', role: 'department_administrator', scope: { type: 'department' } });
      // This semester's courses are handed back; the colleague carries on; last session's stays.
      expect(await assignmentsOf(ids.lecturer)).toEqual(['ENG 101']);
      expect(await assignmentsOf(colleague)).toEqual(['ENG 301']);
      const profile = await t.client.query<{ staff_number: string | null; department_id: string }>('SELECT staff_number, department_id FROM lecturer_profiles WHERE user_id = $1', [ids.lecturer]);
      expect(profile.rows[0]).toEqual({ staff_number: 'E2E-STAFF-1', department_id: ids.department });
      expect(t.roleChanges.at(-1)).toMatchObject({
        to: LECTURER_EMAIL, fromRoleLabel: 'Lecturer', toRoleLabel: 'Department administrator', changedByName: 'Engineering Admin', coursesLeft: ['ENG 201', 'ENG 301'],
      });

      // 6. A request built on what the screen showed before is refused, not applied twice.
      const fromLecturer = { role: 'lecturer' as const, facultyId: ids.faculty, departmentId: ids.department };
      await expect(t.repository.changeMemberPosition({
        institutionId: ids.institution, userId: ids.lecturer, actorUserId: engineeringId,
        from: fromLecturer, to: { role: 'department_administrator', facultyId: ids.faculty, departmentId: ids.department },
        fromLabel: 'a', toLabel: 'b', reason: 'Replaying an old screen.', now: t.now(),
      })).resolves.toEqual({ kind: 'stale' });

      // 7. Back to teaching, in another faculty: only the head can reach Science. The profile
      // (and staff number) is reused.
      expect((await position(engineering.cookie, ids.lecturer, { role: 'lecturer', departmentId: COMPUTER_SCIENCE, reason: 'Moving to Computer Science.', apply: true })).statusCode).toBe(403);
      const back = await position(head.cookie, ids.lecturer, { role: 'lecturer', departmentId: COMPUTER_SCIENCE, reason: 'Moving to Computer Science.', apply: true });
      expect(jsonBody(back)).toMatchObject({ applied: true, workspaceChanges: true, coursesLeaving: [], to: { role: 'lecturer', scopeLabel: 'Computer Science, Faculty of Science' } });
      expect((await t.client.query('SELECT staff_number, department_id FROM lecturer_profiles WHERE user_id = $1', [ids.lecturer])).rows[0])
        .toEqual({ staff_number: 'E2E-STAFF-1', department_id: COMPUTER_SCIENCE });
      expect(jsonBody(await t.server.inject({ method: 'GET', url: '/api/v1/auth/session', headers: { cookie: lecturerCookie } })).account)
        .toMatchObject({ accountType: 'lecturer' });
      // The Engineering admin no longer manages them.
      expect((await position(engineering.cookie, ids.lecturer, { ...toHod, apply: false })).statusCode).toBe(404);

      // 8. Each change is one audit record that reads as before → after.
      const audit = await t.client.query<{ reason: string; actor_user_id: string }>(
        "SELECT reason, actor_user_id FROM staff_audit_events WHERE action = 'staff_role_changed' ORDER BY created_at",
      );
      expect(audit.rows.map((row) => row.reason)).toEqual([
        'Role: Lecturer → Department administrator; Courses handed back: ENG 201, ENG 301; Why: Appointed acting HOD from 1 December.',
        'Role: Department administrator → Lecturer; Area: Electronic and Computer Engineering, Faculty of Engineering → Computer Science, Faculty of Science; Why: Moving to Computer Science.',
      ]);
      expect(audit.rows[0]!.actor_user_id).toBe(engineeringId);
    } finally {
      await t.client.close();
    }
  });

  it('expires invitations after seven days and lets a fresh one be sent', async () => {
    const t = await setup();
    try {
      await runBootstrap(
        parseBootstrapArguments(['--email', 'dept.admin@e2e.invalid', '--name', 'Dept Admin', '--scope', 'department', '--department', 'ece', '--print-link'], INSTITUTION_SLUG),
        { staff: t.staff, repository: t.repository, publicAppUrl: APP_ORIGIN },
      ).then((outcome) => {
        expect(outcome.scopeLabel).toBe('Electronic and Computer Engineering, Faculty of Engineering');
        expect(outcome.link).toMatch(new RegExp(`^${APP_ORIGIN}/accept-invitation#token=[A-Za-z0-9_-]{43}$`));
      });
      const stale = t.tokenFor('dept.admin@e2e.invalid');
      t.advance(7 * DAY + 1);
      expect((await t.accept(stale)).statusCode).toBe(404);

      // A pending (unexpired) invitation blocks a second one; an expired one is replaced.
      await runBootstrap(
        parseBootstrapArguments(['--email', 'dept.admin@e2e.invalid', '--name', 'Dept Admin', '--scope', 'department', '--department', 'ECE'], INSTITUTION_SLUG),
        { staff: t.staff, repository: t.repository, publicAppUrl: APP_ORIGIN },
      );
      await expect(runBootstrap(
        parseBootstrapArguments(['--email', 'dept.admin@e2e.invalid', '--name', 'Dept Admin', '--scope', 'department', '--department', 'ECE'], INSTITUTION_SLUG),
        { staff: t.staff, repository: t.repository, publicAppUrl: APP_ORIGIN },
      )).rejects.toMatchObject({ statusCode: 409 });
      const department = await t.acceptAs('dept.admin@e2e.invalid');
      expect(department.body.account).toMatchObject({ role: 'department_administrator', scope: { type: 'department' } });

      // A department administrator can only invite into their own department.
      const departmentOptions = jsonBody(await t.server.inject({ method: 'GET', url: '/api/v1/admin/staff/options', headers: { cookie: department.cookie } }));
      expect(departmentOptions).toMatchObject({ allowedRoles: ['lecturer', 'department_administrator'], faculties: [] });
      expect((await t.invite(department.cookie, {
        email: 'fac@e2e.invalid', displayName: 'Faculty', role: 'faculty_administrator', facultyId: ids.faculty,
      })).statusCode).toBe(403);
      expect((await t.invite(department.cookie, {
        email: 'peer@e2e.invalid', displayName: 'Peer', role: 'department_administrator', departmentId: ids.department,
      })).statusCode).toBe(201);

      // The bootstrap command refuses lecturers and unknown codes.
      expect(() => parseBootstrapArguments(['--email', 'a@b.c'], INSTITUTION_SLUG)).toThrow(/--name/);
      expect(() => parseBootstrapArguments(['--email', 'a@b.c', '--name', 'A', '--scope', 'faculty'], INSTITUTION_SLUG)).toThrow(/--faculty/);
      await expect(runBootstrap(
        parseBootstrapArguments(['--email', 'z@e2e.invalid', '--name', 'Z', '--scope', 'faculty', '--faculty', 'NOPE'], INSTITUTION_SLUG),
        { staff: t.staff, repository: t.repository, publicAppUrl: APP_ORIGIN },
      )).rejects.toMatchObject({ statusCode: 404 });
    } finally {
      await t.client.close();
    }
  });
});
