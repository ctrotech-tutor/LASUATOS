import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { hashOpaqueToken } from '@lasuatos/auth';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import { PostgresAdministratorOverviewRepository } from '../admin/postgres-repository.js';
import { AdministratorOverviewService } from '../admin/service.js';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import { PostgresAttendanceRepository } from './postgres-repository.js';
import { AttendanceService } from './service.js';
import { applyMigrations, ids, seedAttendanceFixture } from './integration-fixture.js';

it('runs the attendance repository against embedded PostgreSQL', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const now = new Date('2026-11-10T12:00:00.000Z');
    await seedAttendanceFixture(client, now);

    const database = drizzle(client) as unknown as DatabaseClient;
    const repository = new PostgresAttendanceRepository(database);
    const service = new AttendanceService({ repository, now: () => now });
    const createInput = {
      courseOfferingId: ids.offering,
      title: 'Week 4 Lecture',
      durationMinutes: 60,
    };

    await expect(service.createSession(ids.unassignedLecturer, createInput))
      .rejects.toMatchObject({ statusCode: 404 });

    const created = await service.createSession(ids.lecturer, createInput);
    expect(created.session.status).toBe('open');
    expect(created.session.endsAt.toISOString()).toBe('2026-11-10T13:00:00.000Z');
    expect(created.code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    const storedCode = await client.query<{ code_hash: string }>(
      'SELECT code_hash FROM attendance_sessions WHERE id = $1',
      [created.session.id],
    );
    expect(storedCode.rows[0]?.code_hash).toBe(hashOpaqueToken(created.code));

    const first = await service.checkIn(ids.student, { code: created.code });
    const retry = await service.checkIn(ids.student, { code: created.code });
    expect(first.kind).toBe('checked_in');
    expect(retry.kind).toBe('already_checked_in');
    expect(retry.attendance.checkedInAt).toEqual(first.attendance.checkedInAt);
    await expect(service.checkIn(ids.notEnrolled, { code: created.code }))
      .rejects.toMatchObject({ statusCode: 403 });

    const rotated = await service.rotateSessionCode(ids.lecturer, created.session.id);
    expect(rotated.code).not.toBe(created.code);
    await expect(service.checkIn(ids.student, { code: created.code }))
      .rejects.toMatchObject({ statusCode: 400 });
    expect((await service.checkIn(ids.student, { code: rotated.code })).kind).toBe('already_checked_in');

    const sessions = await service.listLecturerSessions(ids.lecturer);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.attendanceCount).toBe(1);

    const openSessions = await service.listStudentOpenSessions(ids.student);
    expect(openSessions).toMatchObject([{
      attendanceSessionId: created.session.id,
      courseCode: 'DEMO-101',
      sessionTitle: 'Week 4 Lecture',
    }]);
    expect(await service.listStudentOpenSessions(ids.notEnrolled)).toEqual([]);

    const detail = await service.getLecturerSession(ids.lecturer, created.session.id);
    expect(detail.attendees).toEqual([{
      studentUserId: ids.student,
      displayName: 'Test Student',
      checkedInAt: now,
      method: 'code',
      venueOutcome: null,
      status: 'present',
      revokedAt: null,
      sharedDevice: false,
      studentNumber: 'STUDENT-1',
      entryYear: null,
      entryLevel: 100,
      programmeYears: 4,
      levelLabel: 'Level unknown',
    }]);
    expect(detail.session.qrOnly).toBe(false);
    expect(detail.session.sharedDeviceCount).toBe(0);

    const challengeResult = await service.getSessionQrChallenge(ids.lecturer, created.session.id);
    expect(challengeResult.challenge.startsWith(`lasu1.${created.session.id}.`)).toBe(true);
    expect(challengeResult.validUntil.getTime()).toBeGreaterThan(now.getTime());
    expect(await service.closeSession(ids.lecturer, created.session.id)).toBe('closed');
    expect(await service.listStudentOpenSessions(ids.student)).toEqual([]);
    await expect(service.checkIn(ids.notEnrolled, { code: rotated.code }))
      .rejects.toMatchObject({ statusCode: 409 });
  } finally {
    await client.close();
  }
}, 30_000);

it('applies audited corrections and builds reports against embedded PostgreSQL', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    let clock = new Date('2026-11-03T10:00:00.000Z');
    await seedAttendanceFixture(client, clock);
    await client.query("UPDATE course_enrollments SET enrolled_at = '2026-09-01T00:00:00Z' WHERE student_user_id = $1", [ids.student]);
    await client.query(
      'INSERT INTO users (id, institution_id, email, display_name, status, email_verified_at) VALUES ($1, $2, $3, $4, $5, $6), ($7, $2, $8, $9, $5, $6)',
      [ids.coLecturer, ids.institution, 'co@test.invalid', 'Co Lecturer', 'active', clock,
        ids.lateStudent, 'late@test.invalid', 'Late Student'],
    );
    await client.query(
      'INSERT INTO lecturer_profiles (user_id, institution_id, department_id, staff_number) VALUES ($1, $2, $3, $4)',
      [ids.coLecturer, ids.institution, ids.department, 'STAFF-2'],
    );
    await client.query(
      'INSERT INTO student_profiles (user_id, institution_id, department_id, student_number) VALUES ($1, $2, $3, $4)',
      [ids.lateStudent, ids.institution, ids.department, '=HYPERLINK("x")'],
    );
    await client.query(
      'INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id, department_id) VALUES ($1, $2, $3, $4, $5)',
      [ids.coLecturer, 'lecturer', 'department', ids.institution, ids.department],
    );
    await client.query(
      'INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, $2, $3, $4)',
      [ids.lateStudent, 'student', 'institution', ids.institution],
    );
    await client.query(
      'INSERT INTO course_assignments (institution_id, course_offering_id, lecturer_user_id, assignment_type) VALUES ($1, $2, $3, $4)',
      [ids.institution, ids.offering, ids.coLecturer, 'lecturer'],
    );

    const database = drizzle(client) as unknown as DatabaseClient;
    const repository = new PostgresAttendanceRepository(database);
    const service = new AttendanceService({ repository, now: () => clock });

    // Session A: the student checks in with the code, then it is closed.
    const sessionA = await service.createSession(ids.lecturer, {
      courseOfferingId: ids.offering,
      title: 'Week 1 Lecture',
      durationMinutes: 60,
    });
    expect((await service.checkIn(ids.student, { code: sessionA.code })).kind).toBe('checked_in');
    clock = new Date('2026-11-03T11:00:00.000Z');
    expect(await service.closeSession(ids.lecturer, sessionA.session.id)).toBe('closed');

    // A student who enrolls after session A is not counted absent for it.
    await client.query(
      'INSERT INTO course_enrollments (institution_id, course_offering_id, student_user_id, status, enrolled_at) VALUES ($1, $2, $3, $4, $5)',
      [ids.institution, ids.offering, ids.lateStudent, 'active', '2026-11-05T09:00:00Z'],
    );

    // Session B: nobody checks in; the co-lecturer records the student manually.
    clock = new Date('2026-11-10T12:00:00.000Z');
    const sessionB = await service.createSession(ids.lecturer, {
      courseOfferingId: ids.offering,
      title: 'Week 2 Lecture',
      durationMinutes: 60,
    });
    const reason = 'Student was present; phone battery was flat.';
    const marked = await service.applyCorrection(ids.coLecturer, sessionB.session.id, {
      studentId: ids.student,
      action: 'mark_present',
      reason,
    });
    expect(marked).toMatchObject({ kind: 'applied', record: { status: 'present', method: 'manual', venueOutcome: null } });
    expect((await service.applyCorrection(ids.coLecturer, sessionB.session.id, {
      studentId: ids.student,
      action: 'mark_present',
      reason,
    })).kind).toBe('unchanged');

    // Revoking blocks the student's own check-in from silently undoing it.
    clock = new Date('2026-11-10T12:05:00.000Z');
    const revoked = await service.applyCorrection(ids.lecturer, sessionB.session.id, {
      studentId: ids.student,
      action: 'revoke',
      reason: 'Recorded against the wrong student by mistake.',
    });
    expect(revoked).toMatchObject({ kind: 'applied', record: { status: 'revoked' } });
    expect(revoked.record.revokedAt).toEqual(clock);
    await expect(service.checkIn(ids.student, { code: sessionB.code }))
      .rejects.toMatchObject({ statusCode: 409, name: 'AttendanceRecordRevokedError' });

    clock = new Date('2026-11-10T12:10:00.000Z');
    const restored = await service.applyCorrection(ids.lecturer, sessionB.session.id, {
      studentId: ids.student,
      action: 'mark_present',
      reason: 'Confirmed in person after class; restoring.',
    });
    expect(restored).toMatchObject({ kind: 'applied', record: { status: 'present', method: 'manual', revokedAt: null } });

    expect((await service.applyCorrection(ids.lecturer, sessionA.session.id, {
      studentId: ids.student,
      action: 'revoke',
      reason: 'Code was shared outside the lecture hall.',
    })).kind).toBe('applied');

    // Guard rails.
    await expect(service.applyCorrection(ids.lecturer, sessionB.session.id, {
      studentId: ids.notEnrolled,
      action: 'mark_present',
      reason: 'Should never be recorded at all.',
    })).rejects.toMatchObject({ statusCode: 409, name: 'AttendanceCorrectionNotEnrolledError' });
    await expect(service.applyCorrection(ids.lecturer, sessionA.session.id, {
      studentId: ids.lateStudent,
      action: 'revoke',
      reason: 'Nothing exists here to revoke.',
    })).rejects.toMatchObject({ statusCode: 409, name: 'AttendanceCorrectionNoRecordError' });
    await expect(service.applyCorrection(ids.unassignedLecturer, sessionB.session.id, {
      studentId: ids.student,
      action: 'revoke',
      reason: 'Not my course but trying anyway.',
    })).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.applyCorrection(ids.lecturer, sessionB.session.id, {
      studentId: ids.student,
      action: 'revoke',
      reason: 'short',
    })).rejects.toMatchObject({ statusCode: 400 });

    // Audit trail: newest first, with actor names and verbatim reasons.
    const trail = await service.listCorrections(ids.lecturer, sessionB.session.id);
    expect(trail.map((entry) => [entry.action, entry.previousStatus, entry.resultingStatus, entry.actorName])).toEqual([
      ['mark_present', 'revoked', 'present', 'Test Lecturer'],
      ['revoke', 'present', 'revoked', 'Test Lecturer'],
      ['mark_present', null, 'present', 'Co Lecturer'],
    ]);
    expect(trail[2]?.reason).toBe(reason);
    expect(trail[2]?.studentName).toBe('Test Student');
    await expect(service.listCorrections(ids.unassignedLecturer, sessionB.session.id))
      .rejects.toMatchObject({ statusCode: 404 });

    // The audit table is append-only at the database level.
    await expect(client.query("UPDATE attendance_corrections SET reason = 'tampered with reason'"))
      .rejects.toThrow(/append-only/);
    await expect(client.query('DELETE FROM attendance_corrections')).rejects.toThrow(/append-only/);
    const auditCount = await client.query<{ count: number }>('SELECT count(*)::int AS count FROM attendance_corrections');
    expect(auditCount.rows[0]?.count).toBe(4);

    // Session counts include present records only.
    const listed = await service.listLecturerSessions(ids.lecturer);
    expect(listed.map((session) => [session.title, session.attendanceCount])).toEqual([
      ['Week 2 Lecture', 1],
      ['Week 1 Lecture', 0],
    ]);

    // Offering report (co-lecturer sees sessions opened by the other lecturer).
    const report = await service.getOfferingReport(ids.coLecturer, ids.offering);
    expect(report.offering).toMatchObject({ courseCode: 'DEMO-101', semesterLabel: '2026/27 First', departmentName: 'Department' });
    expect(report.threshold).toBe(75);
    expect(report.sessions.map((session) => session.title)).toEqual(['Week 1 Lecture', 'Week 2 Lecture']);
    expect(report.students.map((student) => [student.displayName, student.cells, student.rate, student.belowThreshold])).toEqual([
      ['Late Student', ['not_enrolled', 'absent'], 0, true],
      ['Test Student', ['revoked', 'manual'], 50, true],
    ]);
    expect(report.sessions[0]).toMatchObject({ expectedCount: 1, presentCount: 0, revokedCount: 1, rate: 0, status: 'closed' });
    expect(report.sessions[1]).toMatchObject({ expectedCount: 2, presentCount: 1, manualCount: 1, rate: 50, status: 'open' });
    expect(report.totals).toEqual({
      sessionsHeld: 2,
      activeStudents: 2,
      averageRate: 33.3,
      studentsBelowThreshold: 2,
      presentRecords: 1,
      inconclusiveRecords: 0,
      manualRecords: 1,
      revokedRecords: 1,
      openDisputes: 0,
    });
    expect((await service.getOfferingReport(ids.lecturer, ids.offering, 40)).totals.studentsBelowThreshold).toBe(1);
    await expect(service.getOfferingReport(ids.unassignedLecturer, ids.offering)).rejects.toMatchObject({ statusCode: 404 });

    const exported = await service.exportOfferingReportCsv(ids.lecturer, ids.offering);
    expect(exported.filename).toBe('DEMO-101-attendance-2026-11-10.csv');
    expect(exported.csv.startsWith('\uFEFFStudent name,')).toBe(true);
    expect(exported.csv).toContain(`"'=HYPERLINK(""x"")"`);
    expect(exported.csv).toContain('revoked by lecturer,present (recorded by lecturer)');

    // Student-facing summary and history reflect the same rules.
    expect(await service.getStudentSummary(ids.student)).toEqual([{
      courseOfferingId: ids.offering,
      courseCode: 'DEMO-101',
      courseTitle: 'Demo Course',
      sessionsHeld: 2,
      attended: 1,
      revoked: 1,
      rate: 50,
      lastSessionAt: new Date('2026-11-10T12:00:00.000Z'),
    }]);
    expect((await service.getStudentSummary(ids.lateStudent))[0]).toMatchObject({ sessionsHeld: 1, attended: 0, rate: 0 });
    const history = await service.listStudentHistory(ids.student);
    expect(history.map((entry) => [entry.sessionTitle, entry.status, entry.method])).toEqual([
      ['Week 2 Lecture', 'present', 'manual'],
      ['Week 1 Lecture', 'revoked', 'code'],
    ]);

    // Administrator attendance health uses the same rules and respects scope.
    const administrator = (scope: AdministratorSessionAccount['scope']): AdministratorSessionAccount => ({
      accountType: 'administrator',
      id: ids.lecturer,
      email: 'admin@test.invalid',
      displayName: 'Admin',
      emailVerified: true,
      institutionId: ids.institution,
      institutionName: 'Demo Test',
      role: 'institution_administrator',
      scope,
      sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
    });
    const adminService = new AdministratorOverviewService({
      repository: new PostgresAdministratorOverviewRepository(database),
      now: () => clock,
    });
    const adminOverview = await adminService.getAttendanceOverview(administrator({
      type: 'institution', id: ids.institution, label: 'Demo Test', institutionId: ids.institution,
    }));
    expect(adminOverview.offerings).toEqual([{
      courseOfferingId: ids.offering,
      courseCode: 'DEMO-101',
      courseTitle: 'Demo Course',
      departmentName: 'Department',
      semesterLabel: '2026/27 First',
      sessionsHeld: 2,
      activeEnrollments: 2,
      expectedCheckIns: 3,
      presentCheckIns: 1,
      inconclusiveCheckIns: 0,
      manualCheckIns: 1,
      revokedCheckIns: 1,
      rate: 33.3,
      lastSessionAt: new Date('2026-11-10T12:00:00.000Z'),
      openDisputes: 0,
      oldestOpenDisputeAt: null,
    }]);
    expect(adminOverview.totals).toMatchObject({ offeringsWithSessions: 1, sessionsHeld: 2, rate: 33.3 });
    const otherDepartment = await adminService.getAttendanceOverview(administrator({
      type: 'department', id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', label: 'Other', facultyName: 'F', institutionId: ids.institution,
    }));
    expect(otherDepartment.offerings).toEqual([]);
    expect(otherDepartment.totals.rate).toBeNull();
  } finally {
    await client.close();
  }
}, 30_000);

it('enforces QR-only sessions, records per-session device hashes and derives levels in PostgreSQL', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const now = new Date('2026-11-10T12:00:00.000Z');
    await seedAttendanceFixture(client, now);
    // A second enrolled student with a LASU-format matric number, in a five-year programme.
    await client.query('UPDATE departments SET programme_years = 5 WHERE id = $1', [ids.department]);
    await client.query("UPDATE student_profiles SET student_number = '240591001' WHERE user_id = $1", [ids.student]);
    await client.query("UPDATE student_profiles SET student_number = '250591002', entry_level = 200 WHERE user_id = $1", [ids.notEnrolled]);
    await client.query(
      'INSERT INTO course_enrollments (institution_id, course_offering_id, student_user_id, status) VALUES ($1, $2, $3, $4)',
      [ids.institution, ids.offering, ids.notEnrolled, 'active'],
    );

    const database = drizzle(client) as unknown as DatabaseClient;
    const service = new AttendanceService({ repository: new PostgresAttendanceRepository(database), now: () => now });
    const created = await service.createSession(ids.lecturer, {
      courseOfferingId: ids.offering,
      title: 'QR only lecture',
      durationMinutes: 30,
      qrOnly: true,
    });
    expect(created.session.qrOnly).toBe(true);
    expect((await service.listStudentOpenSessions(ids.student))[0]?.qrOnly).toBe(true);

    await expect(service.checkIn(ids.student, { code: created.code }))
      .rejects.toMatchObject({ statusCode: 409, name: 'AttendanceQrRequiredError' });

    const sharedToken = 'shared-phone-token-0123456789';
    const { challenge } = await service.getSessionQrChallenge(ids.lecturer, created.session.id);
    expect((await service.checkIn(ids.student, { challenge, deviceToken: sharedToken })).kind).toBe('checked_in');
    expect((await service.checkIn(ids.notEnrolled, { challenge, deviceToken: sharedToken })).kind).toBe('checked_in');

    const stored = await client.query<{ device_hash: string | null; method: string }>(
      'SELECT device_hash, method FROM attendance_records WHERE attendance_session_id = $1',
      [created.session.id],
    );
    expect(stored.rows).toHaveLength(2);
    for (const row of stored.rows) {
      expect(row.method).toBe('qr_code');
      expect(row.device_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.device_hash).not.toContain(sharedToken);
    }

    const detail = await service.getLecturerSession(ids.lecturer, created.session.id);
    expect(detail.session.sharedDeviceCount).toBe(2);
    expect(detail.attendees.map((row) => [row.studentNumber, row.sharedDevice, row.levelLabel]).sort()).toEqual([
      ['240591001', true, '300 Level'],
      ['250591002', true, '300 Level'],
    ]);

    // Switching QR-only off re-enables the typed code; a closed session refuses changes.
    const relaxed = await service.updateSessionSettings(ids.lecturer, created.session.id, { qrOnly: false });
    expect(relaxed.qrOnly).toBe(false);
    await expect(service.updateSessionSettings(ids.unassignedLecturer, created.session.id, { qrOnly: true }))
      .rejects.toMatchObject({ statusCode: 404 });
    expect(await service.closeSession(ids.lecturer, created.session.id)).toBe('closed');
    await expect(service.updateSessionSettings(ids.lecturer, created.session.id, { qrOnly: true }))
      .rejects.toMatchObject({ statusCode: 409 });

    const report = await service.getOfferingReport(ids.lecturer, ids.offering);
    expect(report.students.map((student) => student.levelLabel).sort()).toEqual(['300 Level', '300 Level']);
    expect(report.students.every((student) => student.levelDiffers)).toBe(true);

    // The administrator overview groups students by derived level in SQL, normalising matric formatting.
    const adminService = new AdministratorOverviewService({
      repository: new PostgresAdministratorOverviewRepository(database),
      now: () => now,
    });
    const institutionAdministrator: AdministratorSessionAccount = {
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
    expect((await adminService.getOverview(institutionAdministrator)).studentLevels).toEqual([
      { label: '300 Level', level: 300, count: 2 },
    ]);
    await client.query("UPDATE student_profiles SET student_number = ' 25/0591-002 ' WHERE user_id = $1", [ids.notEnrolled]);
    await client.query("UPDATE student_profiles SET student_number = 'STUDENT-1' WHERE user_id = $1", [ids.student]);
    expect((await adminService.getOverview(institutionAdministrator)).studentLevels).toEqual([
      { label: '300 Level', level: 300, count: 1 },
      { label: 'Level unknown', level: null, count: 1 },
    ]);
  } finally {
    await client.close();
  }
});

it('gives students a walking guide to the venue of an open session', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    const now = new Date('2026-11-10T12:00:00.000Z');
    await seedAttendanceFixture(client, now);
    const campusId = 'e1111111-1111-4111-8111-111111111111';
    const buildingId = 'e2222222-2222-4222-8222-222222222222';
    const activeVenue = 'e3333333-3333-4333-8333-333333333333';
    const draftVenue = 'e4444444-4444-4444-8444-444444444444';
    await client.query(
      'INSERT INTO campuses (id, institution_id, code, name) VALUES ($1, $2, $3, $4)',
      [campusId, ids.institution, 'EPE', 'Epe Campus'],
    );
    await client.query(
      'INSERT INTO buildings (id, institution_id, campus_id, code, name) VALUES ($1, $2, $3, $4, $5)',
      [buildingId, ids.institution, campusId, 'ENG', 'Engineering Complex'],
    );
    await client.query(
      `INSERT INTO venues (id, institution_id, campus_id, building_id, code, name, venue_type, floor_label, status,
         latitude, longitude, geofence_radius_meters, location_registered_by_user_id, location_registered_at)
       VALUES ($1, $2, $3, $4, 'LT-1', 'Lecture Theatre 1', 'lecture_theatre', 'Ground floor', 'active',
         6.5943, 3.99595, 80, $5, now())`,
      [activeVenue, ids.institution, campusId, buildingId, ids.lecturer],
    );
    // A venue still awaiting review keeps its coordinates to itself.
    await client.query(
      `INSERT INTO venues (id, institution_id, campus_id, code, name, venue_type, status, latitude, longitude)
       VALUES ($1, $2, $3, 'LAB-9', 'Draft Lab', 'laboratory', 'pending_review', 6.6, 4.0)`,
      [draftVenue, ids.institution, campusId],
    );

    const database = drizzle(client) as unknown as DatabaseClient;
    const service = new AttendanceService({ repository: new PostgresAttendanceRepository(database), now: () => now });
    await service.createSession(ids.lecturer, { courseOfferingId: ids.offering, venueId: activeVenue, title: 'In the theatre', durationMinutes: 30 });
    const [open] = await service.listStudentOpenSessions(ids.student);
    expect(open).toMatchObject({
      venueName: 'Lecture Theatre 1',
      locationRequired: true,
      venueGuide: {
        campusName: 'Epe Campus',
        buildingName: 'Engineering Complex',
        floorLabel: 'Ground floor',
        sectionLabel: null,
        radiusMeters: 80,
      },
    });
    expect(open?.venueGuide?.latitude).toBeCloseTo(6.5943);
    expect(open?.venueGuide?.longitude).toBeCloseTo(3.99595);

    await client.query("UPDATE attendance_sessions SET venue_id = $1 WHERE venue_id = $2", [draftVenue, activeVenue]);
    const [draft] = await service.listStudentOpenSessions(ids.student);
    expect(draft?.venueGuide).toEqual({
      campusName: 'Epe Campus',
      buildingName: null,
      floorLabel: null,
      sectionLabel: null,
      latitude: null,
      longitude: null,
      radiusMeters: null,
    });
  } finally {
    await client.close();
  }
}, 30_000);
