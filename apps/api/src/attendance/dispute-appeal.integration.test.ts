import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import type { AppealDecidedNoticeEmail, AppealSubmittedNoticeEmail } from '../email/transport.js';
import { PostgresGovernanceRepository } from '../governance/postgres-repository.js';
import { GovernanceService } from '../governance/service.js';
import { PostgresAttendanceDisputeRepository } from './dispute-postgres-repository.js';
import { AttendanceDisputeService } from './dispute-service.js';
import { applyMigrations, ids, seedAttendanceFixture } from './integration-fixture.js';
import { PostgresAttendanceRepository } from './postgres-repository.js';
import { AttendanceService } from './service.js';

const statement = 'I was in the lecture hall but my phone could not load the page.';
const appealStatement = 'The venue check shows I was inside LT2 and two classmates sat next to me.';
const DAY = 86_400_000;

const hod = '12121212-1212-4121-8121-121212121212';
const dean = '13131313-1313-4131-8131-131313131313';
const otherHod = '14141414-1414-4141-8141-141414141414';
const otherDepartment = '15151515-1515-4151-8151-151515151515';

function admin(id: string, scope: AdministratorSessionAccount['scope'], role: AdministratorSessionAccount['role'], displayName: string): AdministratorSessionAccount {
  return {
    accountType: 'administrator',
    id,
    email: `${id.slice(0, 4)}@test.invalid`,
    displayName,
    emailVerified: true,
    institutionId: ids.institution,
    institutionName: 'Demo Test',
    role,
    scope,
    sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
  };
}

it('takes a rejected dispute to the department and lets its administrators decide, against embedded PostgreSQL', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    let clock = new Date('2026-11-03T10:00:00.000Z');
    await seedAttendanceFixture(client, clock);
    await client.query("UPDATE course_enrollments SET enrolled_at = '2026-09-01T00:00:00Z' WHERE student_user_id = $1", [ids.student]);
    await client.query(
      'INSERT INTO departments (id, institution_id, faculty_id, code, name) VALUES ($1, $2, $3, $4, $5)',
      [otherDepartment, ids.institution, ids.faculty, 'D2', 'Other Department'],
    );
    await client.query(
      `INSERT INTO users (id, institution_id, email, display_name, status, email_verified_at)
       VALUES ($1, $4, 'hod@test.invalid', 'Prof HOD', 'active', $5), ($2, $4, 'dean@test.invalid', 'Dean', 'active', $5),
              ($3, $4, 'otherhod@test.invalid', 'Other HOD', 'active', $5)`,
      [hod, dean, otherHod, ids.institution, clock],
    );
    await client.query(
      `INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id, faculty_id, department_id) VALUES
        ($1, 'department_administrator', 'department', $4, NULL, $5),
        ($2, 'faculty_administrator', 'faculty', $4, $6, NULL),
        ($3, 'department_administrator', 'department', $4, NULL, $7)`,
      [hod, dean, otherHod, ids.institution, ids.department, ids.faculty, otherDepartment],
    );
    const hodAccount = admin(hod, { type: 'department', id: ids.department, label: 'Department', facultyName: 'Faculty', institutionId: ids.institution }, 'department_administrator', 'Prof HOD');
    const deanAccount = admin(dean, { type: 'faculty', id: ids.faculty, label: 'Faculty', institutionId: ids.institution }, 'faculty_administrator', 'Dean');
    const otherHodAccount = admin(otherHod, { type: 'department', id: otherDepartment, label: 'Other Department', facultyName: 'Faculty', institutionId: ids.institution }, 'department_administrator', 'Other HOD');
    // The lecturer who rejected the dispute, were they also an administrator for the department.
    const lecturerAsAdmin = admin(ids.lecturer, hodAccount.scope, 'department_administrator', 'Test Lecturer');

    const database = drizzle(client) as unknown as DatabaseClient;
    const attendance = new AttendanceService({ repository: new PostgresAttendanceRepository(database), now: () => clock });
    const repository = new PostgresAttendanceDisputeRepository(database);
    const submittedNotices: AppealSubmittedNoticeEmail[] = [];
    const decidedNotices: AppealDecidedNoticeEmail[] = [];
    const disputes = new AttendanceDisputeService({
      repository,
      now: () => clock,
      notifier: {
        sendDisputeSubmittedNotice: async () => undefined,
        sendDisputeResolvedNotice: async () => undefined,
        sendAppealSubmittedNotice: async (email) => { submittedNotices.push(email); },
        sendAppealDecidedNotice: async (email) => { decidedNotices.push(email); },
      },
    });

    // Week 1: the student misses check-in, disputes it, and the lecturer turns it down.
    const sessionA = await attendance.createSession(ids.lecturer, { courseOfferingId: ids.offering, title: 'Week 1 Lecture', durationMinutes: 60 });
    clock = new Date('2026-11-03T11:30:00.000Z');
    const dispute = await disputes.submitDispute(ids.student, { attendanceSessionId: sessionA.session.id, statement });
    expect(dispute.appealDeadline).toBeNull();
    // Still with the lecturer: nothing to appeal yet.
    await expect(disputes.appealDispute(ids.student, dispute.id, { statement: appealStatement }))
      .rejects.toMatchObject({ statusCode: 409, name: 'AppealNotRejectedError' });
    // A dispute that is not rejected cannot be appealed even by writing to the table directly.
    await expect(client.query(
      `INSERT INTO attendance_dispute_appeals (institution_id, dispute_id, course_offering_id, attendance_session_id, student_user_id, department_id, statement)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [ids.institution, dispute.id, ids.offering, sessionA.session.id, ids.student, ids.department, appealStatement],
    )).rejects.toThrow(/only a rejected dispute/);

    const rejectedAt = new Date('2026-11-04T09:00:00.000Z');
    clock = rejectedAt;
    await disputes.resolveDispute(ids.lecturer, dispute.id, { decision: 'reject', note: 'Nobody saw you in the hall that morning.' });

    const listed = (await disputes.getStudentDisputes(ids.student)).disputes[0]!;
    expect(listed).toMatchObject({ status: 'rejected', appeal: null, appealDeadline: new Date(rejectedAt.getTime() + 7 * DAY) });
    // Someone else's dispute is invisible.
    await expect(disputes.appealDispute(ids.notEnrolled, dispute.id, { statement: appealStatement }))
      .rejects.toMatchObject({ statusCode: 404 });

    // The student takes it to the department.
    clock = new Date('2026-11-05T08:00:00.000Z');
    const appealed = await disputes.appealDispute(ids.student, dispute.id, { statement: `  ${appealStatement}  ` });
    expect(appealed).toMatchObject({
      status: 'rejected',
      appealDeadline: null,
      appeal: { status: 'open', statement: appealStatement, departmentName: 'Department', decidedAt: null, createdAt: clock },
    });
    // Only the department's own administrator hears about it (the dean is one level up).
    expect(submittedNotices).toEqual([expect.objectContaining({ to: 'hod@test.invalid', studentName: 'Test Student', departmentName: 'Department', courseCode: 'DEMO-101' })]);
    await expect(disputes.appealDispute(ids.student, dispute.id, { statement: appealStatement }))
      .rejects.toMatchObject({ statusCode: 409, name: 'AppealAlreadySentError' });
    const appealId = appealed.appeal!.id;
    // Submission fields are immutable.
    await expect(client.query("UPDATE attendance_dispute_appeals SET statement = 'Rewritten later by someone else entirely.' WHERE id = $1", [appealId]))
      .rejects.toThrow(/immutable/);

    // Queues: the department and its faculty see it; another department does not.
    const queue = await disputes.listAdministratorAppeals(hodAccount);
    expect(queue.openCount).toBe(1);
    expect(queue.appeals).toEqual([expect.objectContaining({
      id: appealId,
      status: 'open',
      conflict: false,
      dispute: expect.objectContaining({
        id: dispute.id,
        status: 'rejected',
        resolutionNote: 'Nobody saw you in the hall that morning.',
        resolvedByName: 'Test Lecturer',
        statement,
        record: null,
        student: expect.objectContaining({ displayName: 'Test Student', enrollmentStatus: 'active' }),
      }),
    })]);
    expect((await disputes.listAdministratorAppeals(deanAccount)).appeals.map((appeal) => appeal.id)).toEqual([appealId]);
    expect(await disputes.countOpenAdministratorAppeals(deanAccount)).toBe(1);
    expect(await disputes.listAdministratorAppeals(otherHodAccount)).toEqual({ appeals: [], openCount: 0 });
    await expect(disputes.decideAppeal(otherHodAccount, appealId, { decision: 'uphold', note: 'Not my department at all.' }))
      .rejects.toMatchObject({ statusCode: 404 });
    // The lecturer who turned it down does not judge the appeal against their own decision.
    expect((await disputes.listAdministratorAppeals(lecturerAsAdmin)).appeals[0]?.conflict).toBe(true);
    await expect(disputes.decideAppeal(lecturerAsAdmin, appealId, { decision: 'reject', note: 'I stand by my own decision.' }))
      .rejects.toMatchObject({ statusCode: 409, name: 'AppealConflictError' });
    // The lecturer sees that their decision was appealed.
    expect((await disputes.listLecturerDisputes(ids.lecturer, { status: 'resolved' })).disputes[0]?.appeal).toMatchObject({ status: 'open', id: appealId });

    // The HOD upholds it: the student is marked present through an audited correction.
    clock = new Date('2026-11-06T10:00:00.000Z');
    const decided = await disputes.decideAppeal(hodAccount, appealId, {
      decision: 'uphold',
      note: 'The venue check places you inside LT2 at 10:04. Marked present.',
    });
    expect(decided.correction).toBe('applied');
    expect(decided.appeal).toMatchObject({
      status: 'upheld',
      decidedByName: 'Prof HOD',
      decidedAt: clock,
      dispute: expect.objectContaining({
        status: 'rejected',
        record: expect.objectContaining({ status: 'present', method: 'manual' }),
        lastCorrection: expect.objectContaining({ action: 'mark_present', actorName: 'Prof HOD' }),
      }),
    });
    const corrections = await client.query<{ actor_user_id: string; appeal_id: string; dispute_id: string; reason: string }>(
      'SELECT actor_user_id, appeal_id, dispute_id, reason FROM attendance_corrections WHERE attendance_session_id = $1',
      [sessionA.session.id],
    );
    expect(corrections.rows).toEqual([{ actor_user_id: hod, appeal_id: appealId, dispute_id: dispute.id, reason: 'The venue check places you inside LT2 at 10:04. Marked present.' }]);
    expect(await attendance.listCorrections(ids.lecturer, sessionA.session.id)).toEqual([expect.objectContaining({ viaDispute: true })]);
    expect(decidedNotices.map((notice) => [notice.audience, notice.to, notice.decision, notice.deciderName])).toEqual([
      ['student', 'student@test.invalid', 'upheld', 'Prof HOD'],
      ['lecturer', 'lecturer@test.invalid', 'upheld', 'Prof HOD'],
    ]);
    expect((await disputes.getStudentDisputes(ids.student)).disputes[0]).toMatchObject({
      appeal: { status: 'upheld', decidedByName: 'Prof HOD' },
      appealDeadline: null,
    });
    expect(await disputes.countOpenAdministratorAppeals(hodAccount)).toBe(0);
    expect((await disputes.listAdministratorAppeals(hodAccount, { status: 'decided' })).appeals.map((appeal) => appeal.id)).toEqual([appealId]);

    // Final: no second decision, no edits, no deletes.
    await expect(disputes.decideAppeal(deanAccount, appealId, { decision: 'reject', note: 'Changing the decision later.' }))
      .rejects.toMatchObject({ statusCode: 409, name: 'AppealNotOpenError' });
    await expect(client.query("UPDATE attendance_dispute_appeals SET status = 'rejected' WHERE id = $1", [appealId])).rejects.toThrow(/final/);
    await expect(client.query('DELETE FROM attendance_dispute_appeals WHERE id = $1', [appealId])).rejects.toThrow(/cannot be deleted/);

    // Week 2: rejected, appealed, then withdrawn; the one chance is used up.
    clock = new Date('2026-11-10T12:00:00.000Z');
    const sessionB = await attendance.createSession(ids.lecturer, { courseOfferingId: ids.offering, title: 'Week 2 Lecture', durationMinutes: 60 });
    clock = new Date('2026-11-10T13:30:00.000Z');
    const second = await disputes.submitDispute(ids.student, { attendanceSessionId: sessionB.session.id, statement });
    await disputes.resolveDispute(ids.lecturer, second.id, { decision: 'reject', note: 'The register shows you were not there.' });
    await disputes.appealDispute(ids.student, second.id, { statement: appealStatement });
    // Week 1 was decided, so the department's list was empty again: this one sends an email too.
    expect(submittedNotices).toHaveLength(2);
    expect((await disputes.withdrawAppeal(ids.student, second.id)).appeal).toMatchObject({ status: 'withdrawn' });
    await expect(disputes.withdrawAppeal(ids.student, second.id)).rejects.toMatchObject({ statusCode: 409, name: 'AppealNotOpenError' });
    await expect(disputes.withdrawAppeal(ids.notEnrolled, second.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(disputes.appealDispute(ids.student, second.id, { statement: appealStatement }))
      .rejects.toMatchObject({ statusCode: 409, name: 'AppealAlreadySentError' });

    // Week 3: rejected, but the student waits too long.
    clock = new Date('2026-11-11T12:00:00.000Z');
    const sessionC = await attendance.createSession(ids.lecturer, { courseOfferingId: ids.offering, title: 'Week 3 Lecture', durationMinutes: 60 });
    clock = new Date('2026-11-11T13:30:00.000Z');
    const third = await disputes.submitDispute(ids.student, { attendanceSessionId: sessionC.session.id, statement });
    await disputes.resolveDispute(ids.lecturer, third.id, { decision: 'reject', note: 'The register shows you were not there.' });
    clock = new Date(clock.getTime() + 7 * DAY + 60_000);
    expect((await disputes.getStudentDisputes(ids.student)).disputes.find((item) => item.id === third.id)?.appealDeadline).toBeNull();
    await expect(disputes.appealDispute(ids.student, third.id, { statement: appealStatement }))
      .rejects.toMatchObject({ statusCode: 409, name: 'AppealWindowClosedError' });

    // The audit log shows the appeal and the decision to the department, not to another one.
    const governance = new GovernanceService({
      repository: new PostgresGovernanceRepository(database),
      policy: { graceMonths: 12, activeWithinDays: 180, checkPhotoDays: 90 },
      scheduled: false,
      now: () => clock,
    });
    const log = await governance.auditLog(hodAccount, { category: 'attendance' });
    const actions = log.entries.map((entry) => entry.action);
    expect(actions).toEqual(expect.arrayContaining(['attendance_appeal_sent', 'attendance_appeal_upheld']));
    const upheldEntry = log.entries.find((entry) => entry.action === 'attendance_appeal_upheld')!;
    expect(upheldEntry).toMatchObject({ actorName: 'Prof HOD', category: 'attendance', notable: true, summary: 'Accepted an attendance appeal' });
    expect(upheldEntry.facts).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'Department', value: 'Department' }),
      expect.objectContaining({ label: 'Lecturer who turned it down', value: 'Test Lecturer' }),
    ]));
    expect(upheldEntry.note).toMatch(/LT2/);
    expect((await governance.auditLog(otherHodAccount, { category: 'attendance' })).entries.filter((entry) => entry.action.startsWith('attendance_appeal_'))).toEqual([]);
  } finally {
    await client.close();
  }
}, 30_000);
