import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import { PostgresAdministratorOverviewRepository } from '../admin/postgres-repository.js';
import { AdministratorOverviewService } from '../admin/service.js';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import { PostgresAttendanceDisputeRepository } from './dispute-postgres-repository.js';
import { AttendanceDisputeService } from './dispute-service.js';
import { applyMigrations, ids, seedAttendanceFixture } from './integration-fixture.js';
import { PostgresAttendanceRepository } from './postgres-repository.js';
import { AttendanceService } from './service.js';

const statement = 'I was in the lecture hall but my phone could not load the page.';

it('runs the student dispute and lecturer review workflow against embedded PostgreSQL', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    let clock = new Date('2026-11-03T10:00:00.000Z');
    await seedAttendanceFixture(client, clock);
    await client.query("UPDATE course_enrollments SET enrolled_at = '2026-09-01T00:00:00Z' WHERE student_user_id = $1", [ids.student]);
    await client.query(
      'INSERT INTO users (id, institution_id, email, display_name, status, email_verified_at) VALUES ($1, $2, $3, $4, $5, $6), ($7, $2, $8, $9, $5, $6)',
      [ids.unassignedLecturer, ids.institution, 'unassigned@test.invalid', 'Unassigned Lecturer', 'active', clock,
        ids.lateStudent, 'late@test.invalid', 'Late Student'],
    );
    await client.query(
      'INSERT INTO lecturer_profiles (user_id, institution_id, department_id, staff_number) VALUES ($1, $2, $3, $4)',
      [ids.unassignedLecturer, ids.institution, ids.department, 'STAFF-9'],
    );
    await client.query(
      'INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id, department_id) VALUES ($1, $2, $3, $4, $5)',
      [ids.unassignedLecturer, 'lecturer', 'department', ids.institution, ids.department],
    );
    await client.query(
      'INSERT INTO student_profiles (user_id, institution_id, department_id, student_number) VALUES ($1, $2, $3, $4)',
      [ids.lateStudent, ids.institution, ids.department, 'STUDENT-3'],
    );
    await client.query(
      'INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, $2, $3, $4)',
      [ids.lateStudent, 'student', 'institution', ids.institution],
    );

    const database = drizzle(client) as unknown as DatabaseClient;
    const attendance = new AttendanceService({ repository: new PostgresAttendanceRepository(database), now: () => clock });
    const disputeRepository = new PostgresAttendanceDisputeRepository(database);
    const disputes = new AttendanceDisputeService({ repository: disputeRepository, now: () => clock });

    // Session A runs 10:00–11:00. The student never checks in.
    const sessionA = await attendance.createSession(ids.lecturer, {
      courseOfferingId: ids.offering,
      title: 'Week 1 Lecture',
      durationMinutes: 60,
    });
    const sessionAId = sessionA.session.id;

    // While check-ins are open, a missing check-in cannot be disputed.
    await expect(disputes.submitDispute(ids.student, { attendanceSessionId: sessionAId, statement }))
      .rejects.toMatchObject({ statusCode: 409, name: 'DisputeSessionStillOpenError' });
    expect((await disputes.getStudentDisputes(ids.student)).disputableSessions).toEqual([]);
    // A student with no enrollment in the offering cannot even see the session.
    await expect(disputes.submitDispute(ids.notEnrolled, { attendanceSessionId: sessionAId, statement }))
      .rejects.toMatchObject({ statusCode: 404, name: 'DisputeSessionUnavailableError' });

    // After the session expires it becomes disputable for 14 days.
    clock = new Date('2026-11-03T11:30:00.000Z');
    await client.query(
      'INSERT INTO course_enrollments (institution_id, course_offering_id, student_user_id, status, enrolled_at) VALUES ($1, $2, $3, $4, $5)',
      [ids.institution, ids.offering, ids.lateStudent, 'active', '2026-11-05T09:00:00Z'],
    );
    const listed = await disputes.getStudentDisputes(ids.student);
    expect(listed.windowDays).toBe(14);
    expect(listed.disputableSessions).toEqual([expect.objectContaining({
      attendanceSessionId: sessionAId,
      kind: 'missing_check_in',
      revocation: null,
      disputeDeadline: new Date('2026-11-17T11:00:00.000Z'),
    })]);
    await expect(disputes.submitDispute(ids.lateStudent, { attendanceSessionId: sessionAId, statement }))
      .rejects.toMatchObject({ statusCode: 409, name: 'DisputeEnrolledAfterSessionError' });
    await expect(disputes.submitDispute(ids.student, { attendanceSessionId: sessionAId, statement: '  too short  ' }))
      .rejects.toMatchObject({ statusCode: 400 });

    const first = await disputes.submitDispute(ids.student, { attendanceSessionId: sessionAId, statement: `  ${statement}  ` });
    expect(first).toMatchObject({ status: 'open', kind: 'missing_check_in', statement, courseCode: 'DEMO-101', resolvedAt: null });
    await expect(disputes.submitDispute(ids.student, { attendanceSessionId: sessionAId, statement }))
      .rejects.toMatchObject({ statusCode: 409, name: 'DisputeAlreadyOpenError' });
    // The partial unique index settles a concurrent duplicate that slipped past the check.
    expect(await disputeRepository.insertDispute({
      institutionId: ids.institution,
      courseOfferingId: ids.offering,
      attendanceSessionId: sessionAId,
      studentUserId: ids.student,
      kind: 'missing_check_in',
      statement,
      now: clock,
    })).toEqual({ kind: 'already_open' });

    // Submission fields are immutable even while open.
    await expect(client.query("UPDATE attendance_disputes SET statement = 'Rewritten after the fact by someone.' WHERE id = $1", [first.id]))
      .rejects.toThrow(/immutable/);

    // Withdrawal is owner-only and final; the student may then resubmit.
    await expect(disputes.withdrawDispute(ids.notEnrolled, first.id)).rejects.toMatchObject({ statusCode: 404 });
    expect(await disputes.withdrawDispute(ids.student, first.id)).toMatchObject({ status: 'withdrawn' });
    await expect(disputes.withdrawDispute(ids.student, first.id))
      .rejects.toMatchObject({ statusCode: 409, name: 'DisputeNotOpenError' });
    clock = new Date('2026-11-03T12:00:00.000Z');
    const second = await disputes.submitDispute(ids.student, { attendanceSessionId: sessionAId, statement });
    expect((await disputes.getStudentDisputes(ids.student)).disputes.map((dispute) => dispute.status)).toEqual(['open', 'withdrawn']);

    // Lecturer queue: assigned lecturers only, with the student's current record.
    const queue = await disputes.listLecturerDisputes(ids.lecturer);
    expect(queue.openCount).toBe(1);
    expect(queue.disputes).toEqual([expect.objectContaining({
      id: second.id,
      sessionTitle: 'Week 1 Lecture',
      kind: 'missing_check_in',
      status: 'open',
      record: null,
      lastCorrection: null,
      student: { id: ids.student, displayName: 'Test Student', studentNumber: 'STUDENT-1', studentNumberVerified: false, enrollmentStatus: 'active' },
    })]);
    expect((await disputes.listLecturerDisputes(ids.lecturer, { status: 'resolved' })).disputes.map((dispute) => dispute.id)).toEqual([first.id]);
    expect(await disputes.listLecturerDisputes(ids.unassignedLecturer)).toEqual({ disputes: [], openCount: 0 });
    expect(await disputes.countOpenLecturerDisputes(ids.lecturer)).toBe(1);
    expect(await disputes.countOpenLecturerDisputes(ids.unassignedLecturer)).toBe(0);

    // Reports and the administrator overview surface the open dispute.
    expect((await attendance.getOfferingReport(ids.lecturer, ids.offering)).totals.openDisputes).toBe(1);
    const adminService = new AdministratorOverviewService({
      repository: new PostgresAdministratorOverviewRepository(database),
      now: () => clock,
    });
    const administrator: AdministratorSessionAccount = {
      accountType: 'administrator',
      id: ids.lecturer,
      email: 'admin@test.invalid',
      displayName: 'Admin',
      emailVerified: true,
      institutionId: ids.institution,
      institutionName: 'Demo Test',
      role: 'institution_administrator',
      scope: { type: 'institution', id: ids.institution, label: 'Demo Test', institutionId: ids.institution },
      sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
    };
    const overview = await adminService.getAttendanceOverview(administrator);
    expect(overview.totals).toMatchObject({ openDisputes: 1, oldestOpenDisputeAt: second.createdAt });
    expect(overview.offerings[0]).toMatchObject({ openDisputes: 1, oldestOpenDisputeAt: second.createdAt });

    // Resolution guard rails.
    await expect(disputes.resolveDispute(ids.unassignedLecturer, second.id, { decision: 'uphold', note: 'Not my course at all.' }))
      .rejects.toMatchObject({ statusCode: 404, name: 'DisputeNotFoundError' });
    await expect(disputes.resolveDispute(ids.lecturer, second.id, { decision: 'uphold', note: 'short' }))
      .rejects.toMatchObject({ statusCode: 400 });

    // Upholding records the student present through a linked, audited correction.
    clock = new Date('2026-11-04T09:00:00.000Z');
    const upheld = await disputes.resolveDispute(ids.lecturer, second.id, {
      decision: 'uphold',
      note: 'I remember you at the front row; recording you present.',
    });
    expect(upheld.correction).toBe('applied');
    expect(await disputes.countOpenLecturerDisputes(ids.lecturer)).toBe(0);
    expect(upheld.dispute).toMatchObject({
      status: 'upheld',
      resolvedByName: 'Test Lecturer',
      resolvedAt: clock,
      record: { status: 'present', method: 'manual', venueOutcome: null },
      lastCorrection: { action: 'mark_present', actorName: 'Test Lecturer', reason: 'I remember you at the front row; recording you present.' },
    });
    const trailA = await attendance.listCorrections(ids.lecturer, sessionAId);
    expect(trailA).toEqual([expect.objectContaining({ action: 'mark_present', previousStatus: null, viaDispute: true })]);
    await expect(disputes.resolveDispute(ids.lecturer, second.id, { decision: 'reject', note: 'Changing my mind later on.' }))
      .rejects.toMatchObject({ statusCode: 409, name: 'DisputeNotOpenError' });
    await expect(disputes.submitDispute(ids.student, { attendanceSessionId: sessionAId, statement }))
      .rejects.toMatchObject({ statusCode: 409, name: 'DisputeAlreadyPresentError' });
    expect((await disputes.getStudentDisputes(ids.student)).disputes[0]).toMatchObject({
      status: 'upheld',
      resolutionNote: 'I remember you at the front row; recording you present.',
      resolvedByName: 'Test Lecturer',
    });

    // Decided disputes are frozen at the database level and never deleted.
    await expect(client.query("UPDATE attendance_disputes SET status = 'rejected' WHERE id = $1", [second.id]))
      .rejects.toThrow(/final/);
    await expect(client.query('DELETE FROM attendance_disputes WHERE id = $1', [second.id]))
      .rejects.toThrow(/cannot be deleted/);

    // Session B: the student checks in, the lecturer revokes it, and the
    // student can dispute immediately, seeing the lecturer's reason.
    clock = new Date('2026-11-10T12:00:00.000Z');
    const sessionB = await attendance.createSession(ids.lecturer, {
      courseOfferingId: ids.offering,
      title: 'Week 2 Lecture',
      durationMinutes: 60,
    });
    const sessionBId = sessionB.session.id;
    await attendance.checkIn(ids.student, { code: sessionB.code });
    clock = new Date('2026-11-10T12:10:00.000Z');
    await attendance.applyCorrection(ids.lecturer, sessionBId, {
      studentId: ids.student,
      action: 'revoke',
      reason: 'Code was used from outside the lecture hall.',
    });
    const revokedList = await disputes.getStudentDisputes(ids.student);
    expect(revokedList.disputableSessions).toEqual([expect.objectContaining({
      attendanceSessionId: sessionBId,
      kind: 'revoked_check_in',
      revocation: { reason: 'Code was used from outside the lecture hall.', revokedAt: clock },
    })]);
    const third = await disputes.submitDispute(ids.student, {
      attendanceSessionId: sessionBId,
      statement: 'I was inside; the location reading was wrong because of the building.',
    });
    expect(third.kind).toBe('revoked_check_in');

    clock = new Date('2026-11-10T14:00:00.000Z');
    const queueB = await disputes.listLecturerDisputes(ids.lecturer, { courseOfferingId: ids.offering });
    expect(queueB.disputes[0]).toMatchObject({
      id: third.id,
      record: { status: 'revoked', method: 'code' },
      lastCorrection: { action: 'revoke', reason: 'Code was used from outside the lecture hall.' },
    });
    const rejected = await disputes.resolveDispute(ids.lecturer, third.id, {
      decision: 'reject',
      note: 'Two classmates confirmed you left before the session began.',
    });
    expect(rejected).toMatchObject({ correction: null, dispute: { status: 'rejected', record: { status: 'revoked' } } });
    await expect(disputes.submitDispute(ids.student, { attendanceSessionId: sessionBId, statement }))
      .rejects.toMatchObject({ statusCode: 409, name: 'DisputeAlreadyResolvedError' });

    // Upholding is refused (and nothing changes) once the student is no longer enrolled.
    const fourth = await disputes.submitDispute(ids.lateStudent, { attendanceSessionId: sessionBId, statement });
    await client.query("UPDATE course_enrollments SET status = 'withdrawn' WHERE student_user_id = $1", [ids.lateStudent]);
    await expect(disputes.resolveDispute(ids.lecturer, fourth.id, { decision: 'uphold', note: 'Recording them present anyway.' }))
      .rejects.toMatchObject({ statusCode: 409, name: 'DisputeUpholdNotEnrolledError' });
    const stillOpen = await disputes.listLecturerDisputes(ids.lecturer);
    expect(stillOpen.disputes).toEqual([expect.objectContaining({
      id: fourth.id,
      status: 'open',
      student: expect.objectContaining({ enrollmentStatus: 'withdrawn' }),
    })]);
    expect((await disputes.resolveDispute(ids.lecturer, fourth.id, {
      decision: 'reject',
      note: 'You withdrew from the course, so this cannot be recorded.',
    })).dispute.status).toBe('rejected');
    expect(await attendance.listCorrections(ids.lecturer, sessionBId)).toHaveLength(1);

    // After the window, sessions drop off the list and submissions are refused.
    clock = new Date('2026-11-25T14:00:00.000Z');
    expect((await disputes.getStudentDisputes(ids.student)).disputableSessions).toEqual([]);
    await expect(disputes.submitDispute(ids.student, { attendanceSessionId: sessionBId, statement }))
      .rejects.toMatchObject({ statusCode: 409, name: 'DisputeWindowClosedError' });
    expect((await disputes.listLecturerDisputes(ids.lecturer, { status: 'all' })).disputes).toHaveLength(4);
  } finally {
    await client.close();
  }
}, 30_000);
