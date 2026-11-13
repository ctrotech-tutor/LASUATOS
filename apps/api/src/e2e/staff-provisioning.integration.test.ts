import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { DatabaseClient } from '@lasuatos/database';
import { describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { StudentAuthService } from '../auth/service.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import type { StaffInvitationEmail } from '../email/transport.js';
import { PostgresStaffRepository } from '../staff/postgres-repository.js';
import { StaffService } from '../staff/service.js';
import { parseBootstrapArguments, runBootstrap } from '../staff/bootstrap.js';
import {
  INSTITUTION_SLUG,
  LECTURER_EMAIL,
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

  return { client, server, staff, repository, invitations, advance, tokenFor, accept, acceptAs, invite, sessionStatus, login };
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
