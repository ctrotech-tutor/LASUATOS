import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../server.js';
import type { AuthRouteService } from '../auth/routes.js';
import type { LecturerSessionAccount, StudentSessionAccount } from '../auth/repository.js';
import type { AttendanceRouteOptions } from './routes.js';
import type { AttendanceSessionRecord } from './repository.js';

const sessionToken = 's'.repeat(43);
const student: StudentSessionAccount = {
  accountType: 'student',
  id: 'a938d6d9-5f40-45c9-876e-4f971acbb79a',
  email: 'student@example.net',
  displayName: 'Example Student',
  matricNumber: '00000001',
  matricNumberVerified: false,
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
};
const lecturer: LecturerSessionAccount = {
  accountType: 'lecturer',
  id: 'c19ca6fe-1355-4ed7-a54d-2b6bb11824fe',
  email: 'lecturer@example.net',
  displayName: 'Example Lecturer',
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
};
const session: AttendanceSessionRecord = {
  id: '7a5d513c-5e22-4d0e-a8ce-98d8b029865b',
  courseOfferingId: 'b3aa9508-2ead-444c-8b8f-3051fe8d14df',
  courseCode: 'DEMO-101',
  courseTitle: 'Demonstration course',
  title: 'Week 4 lecture',
  venueId: null,
  venueCode: null,
  venueName: null,
  locationRequired: false,
  status: 'open',
  startsAt: new Date('2026-11-10T12:00:00.000Z'),
  endsAt: new Date('2026-11-10T13:00:00.000Z'),
  closedAt: null,
  attendanceCount: 0,
};

const reportFixture = {
  offering: {
    id: session.courseOfferingId,
    courseCode: session.courseCode,
    courseTitle: session.courseTitle,
    departmentName: 'Demo Department',
    semesterLabel: '2026/27 First',
  },
  generatedAt: session.startsAt,
  threshold: 75,
  totals: {
    sessionsHeld: 1,
    activeStudents: 1,
    averageRate: 100,
    studentsBelowThreshold: 0,
    presentRecords: 1,
    inconclusiveRecords: 0,
    manualRecords: 0,
    revokedRecords: 0,
    openDisputes: 0,
  },
  sessions: [{
    id: session.id,
    title: session.title,
    startsAt: session.startsAt,
    status: 'open' as const,
    venueName: null,
    expectedCount: 1,
    presentCount: 1,
    withinBoundaryCount: 0,
    inconclusiveCount: 0,
    unlocatedCount: 1,
    manualCount: 0,
    revokedCount: 0,
    rate: 100,
  }],
  students: [{
    studentUserId: student.id,
    displayName: student.displayName,
    studentNumber: '00000001',
    studentNumberVerified: false,
    enrollmentStatus: 'active' as const,
    enrolledAt: new Date('2026-09-01T00:00:00.000Z'),
    eligibleSessions: 1,
    attendedSessions: 1,
    rate: 100,
    belowThreshold: false,
    cells: ['unlocated' as const],
  }],
};

const servers: ReturnType<typeof buildServer>[] = [];

function createAuth(account: StudentSessionAccount | LecturerSessionAccount = student): AuthRouteService {
  return {
    registerStudent: vi.fn(async () => undefined),
    resendVerification: vi.fn(async () => undefined),
    verifyEmail: vi.fn(async () => ({ token: sessionToken, student })),
    login: vi.fn(async () => ({ token: sessionToken, account })),
    getSession: vi.fn(async () => account),
    logout: vi.fn(async () => undefined),
    requestPasswordReset: vi.fn(async () => undefined),
    completePasswordReset: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => 0),
    listSessions: vi.fn(async () => []),
    revokeOtherSessions: vi.fn(async () => 0),
  };
}

function createAttendance(): NonNullable<AttendanceRouteOptions['attendance']> {
  return {
    createSession: vi.fn(async () => ({ code: 'ABCDEFGHJK23', session })),
    listLecturerSessions: vi.fn(async () => [session]),
    getLecturerSession: vi.fn(async () => ({
      session,
      attendees: [{
        studentUserId: student.id,
        displayName: student.displayName,
        checkedInAt: session.startsAt,
        method: 'code' as const,
        venueOutcome: null,
        status: 'present' as const,
        revokedAt: null,
      }],
    })),
    closeSession: vi.fn(async () => 'closed' as const),
    rotateSessionCode: vi.fn(async () => ({ code: 'JKLMNPQR2345', expiresAt: session.endsAt })),
    getSessionQrChallenge: vi.fn(async () => ({
      challenge: `lasu1.${session.id}.123456.AAAAAAAAAAAAAAAAAAAAAA`,
      validUntil: new Date('2026-11-10T12:00:20.000Z'),
      sessionEndsAt: session.endsAt,
    })),
    checkIn: vi.fn(async () => ({
      kind: 'checked_in' as const,
      attendance: {
        attendanceSessionId: session.id,
        courseCode: session.courseCode,
        courseTitle: session.courseTitle,
        sessionTitle: session.title,
        venueName: null,
        venueOutcome: null,
        checkedInAt: session.startsAt,
      },
    })),
    listStudentHistory: vi.fn(async () => [{
      attendanceSessionId: session.id,
      courseOfferingId: session.courseOfferingId,
      courseCode: session.courseCode,
      courseTitle: session.courseTitle,
      sessionTitle: session.title,
      venueName: null,
      venueOutcome: null,
      method: 'code' as const,
      status: 'present' as const,
      startsAt: session.startsAt,
      checkedInAt: session.startsAt,
    }]),
    getStudentSummary: vi.fn(async () => [{
      courseOfferingId: session.courseOfferingId,
      courseCode: session.courseCode,
      courseTitle: session.courseTitle,
      sessionsHeld: 4,
      attended: 3,
      revoked: 0,
      rate: 75,
      lastSessionAt: session.startsAt,
    }]),
    getOfferingReport: vi.fn(async () => reportFixture),
    exportOfferingReportCsv: vi.fn(async () => ({
      filename: 'DEMO-101-attendance-2026-11-10.csv',
      csv: '\uFEFFStudent name\r\nExample Student\r\n',
    })),
    applyCorrection: vi.fn(async () => ({
      kind: 'applied' as const,
      record: {
        studentUserId: student.id,
        status: 'present' as const,
        method: 'manual' as const,
        venueOutcome: null,
        checkedInAt: session.startsAt,
        revokedAt: null,
      },
    })),
    listCorrections: vi.fn(async () => [{
      id: '0b9c1fd4-27c9-4b7e-9e4b-5bb1a1b0f001',
      studentUserId: student.id,
      studentName: student.displayName,
      actorName: lecturer.displayName,
      action: 'mark_present' as const,
      previousStatus: null,
      resultingStatus: 'present' as const,
      reason: 'Phone battery was flat in class.',
      viaDispute: false,
      createdAt: session.startsAt,
    }]),
    listStudentOpenSessions: vi.fn(async () => [{
      attendanceSessionId: session.id,
      courseOfferingId: session.courseOfferingId,
      courseCode: session.courseCode,
      courseTitle: session.courseTitle,
      sessionTitle: session.title,
      venueCode: null,
      venueName: null,
      locationRequired: false,
      endsAt: session.endsAt,
    }]),
  };
}

function createServer(
  account: StudentSessionAccount | LecturerSessionAccount = student,
  attendance = createAttendance(),
) {
  const server = buildServer({ logger: false, auth: createAuth(account), attendance });
  servers.push(server);
  return { server, attendance };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('attendance routes', () => {
  it('limits session creation, listing, and rosters to signed-in lecturers', async () => {
    const denied = createServer();
    const headers = { cookie: `lasuatos_session=${sessionToken}` };
    const listDenied = await denied.server.inject({ method: 'GET', url: '/api/v1/lecturer/attendance-sessions', headers });
    const createDenied = await denied.server.inject({
      method: 'POST', url: '/api/v1/lecturer/attendance-sessions', headers,
      payload: { courseOfferingId: session.courseOfferingId, title: session.title, durationMinutes: 60 },
    });
    expect(listDenied.statusCode).toBe(403);
    expect(createDenied.statusCode).toBe(403);
    expect(denied.attendance.listLecturerSessions).not.toHaveBeenCalled();
    expect(denied.attendance.createSession).not.toHaveBeenCalled();

    const lecturerServer = createServer(lecturer);
    const created = await lecturerServer.server.inject({
      method: 'POST', url: '/api/v1/lecturer/attendance-sessions', headers,
      payload: { courseOfferingId: session.courseOfferingId, title: '  Week 4 lecture  ', durationMinutes: 60 },
    });
    const roster = await lecturerServer.server.inject({
      method: 'GET', url: `/api/v1/lecturer/attendance-sessions/${session.id}`, headers,
    });
    const listing = await lecturerServer.server.inject({
      method: 'GET', url: `/api/v1/lecturer/attendance-sessions?courseOfferingId=${session.courseOfferingId}`, headers,
    });
    const rotated = await lecturerServer.server.inject({
      method: 'POST', url: `/api/v1/lecturer/attendance-sessions/${session.id}/code`, headers,
    });
    const closed = await lecturerServer.server.inject({
      method: 'POST', url: `/api/v1/lecturer/attendance-sessions/${session.id}/close`, headers,
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ status: 'created', code: 'ABCDEFGHJK23', session: {
      ...session,
      startsAt: session.startsAt.toISOString(),
      endsAt: session.endsAt.toISOString(),
    } });
    expect(lecturerServer.attendance.createSession).toHaveBeenCalledWith(lecturer.id, {
      courseOfferingId: session.courseOfferingId,
      venueId: null,
      title: 'Week 4 lecture',
      durationMinutes: 60,
    });
    expect(roster.statusCode).toBe(200);
    expect(roster.json().attendees).toEqual([{
      studentId: student.id,
      displayName: student.displayName,
      checkedInAt: session.startsAt.toISOString(),
      method: 'code',
      venueOutcome: null,
      status: 'present',
      revokedAt: null,
    }]);
    expect(listing.statusCode).toBe(200);
    expect(listing.json().sessions[0].id).toBe(session.id);
    expect(rotated.statusCode).toBe(200);
    expect(rotated.json()).toEqual({ status: 'rotated', code: 'JKLMNPQR2345', expiresAt: session.endsAt.toISOString() });
    expect(closed.statusCode).toBe(200);
    expect(closed.json()).toEqual({ status: 'closed' });
    expect(lecturerServer.attendance.rotateSessionCode).toHaveBeenCalledWith(lecturer.id, session.id);
    expect(lecturerServer.attendance.closeSession).toHaveBeenCalledWith(lecturer.id, session.id);
  });

  it('allows enrolled student check-in/history routes but denies lecturer use', async () => {
    const headers = { cookie: `lasuatos_session=${sessionToken}` };
    const studentServer = createServer(student);
    const checkedIn = await studentServer.server.inject({
      method: 'POST', url: '/api/v1/student/attendance/check-in', headers,
      payload: { code: ' abcd-efgh-jk23 ' },
    });
    const history = await studentServer.server.inject({ method: 'GET', url: '/api/v1/student/attendance', headers });
    const open = await studentServer.server.inject({ method: 'GET', url: '/api/v1/student/attendance/open', headers });
    expect(checkedIn.statusCode).toBe(200);
    expect(checkedIn.json().status).toBe('checked_in');
    expect(checkedIn.json().attendance.checkedInAt).toBe(session.startsAt.toISOString());
    expect(studentServer.attendance.checkIn).toHaveBeenCalledWith(student.id, { code: 'abcd-efgh-jk23' });
    expect(history.statusCode).toBe(200);
    expect(history.json().records).toHaveLength(1);
    expect(open.statusCode).toBe(200);
    expect(open.json().sessions).toEqual([{
      attendanceSessionId: session.id,
      courseOfferingId: session.courseOfferingId,
      courseCode: session.courseCode,
      courseTitle: session.courseTitle,
      sessionTitle: session.title,
      venueCode: null,
      venueName: null,
      locationRequired: false,
      endsAt: session.endsAt.toISOString(),
    }]);

    const lecturerServer = createServer(lecturer);
    const denied = await lecturerServer.server.inject({
      method: 'POST', url: '/api/v1/student/attendance/check-in', headers,
      payload: { code: 'ABCDEFGHJK23' },
    });
    const openDenied = await lecturerServer.server.inject({ method: 'GET', url: '/api/v1/student/attendance/open', headers });
    expect(denied.statusCode).toBe(403);
    expect(openDenied.statusCode).toBe(403);
    expect(lecturerServer.attendance.checkIn).not.toHaveBeenCalled();
    expect(lecturerServer.attendance.listStudentOpenSessions).not.toHaveBeenCalled();
  });

  it('rejects malformed codes and durations before calling services', async () => {
    const headers = { cookie: `lasuatos_session=${sessionToken}` };
    const studentServer = createServer(student);
    const invalidCode = await studentServer.server.inject({
      method: 'POST', url: '/api/v1/student/attendance/check-in', headers, payload: { code: 'THIS-CODE-IS-FAR-TOO-LONG-TO-BE-VALID' },
    });
    expect(invalidCode.statusCode).toBe(400);
    expect(studentServer.attendance.checkIn).not.toHaveBeenCalled();

    const lecturerServer = createServer(lecturer);
    const invalidDuration = await lecturerServer.server.inject({
      method: 'POST', url: '/api/v1/lecturer/attendance-sessions', headers,
      payload: { courseOfferingId: session.courseOfferingId, title: 'Week 4', durationMinutes: 500 },
    });
    expect(invalidDuration.statusCode).toBe(400);
    expect(lecturerServer.attendance.createSession).not.toHaveBeenCalled();
  });

  it('serves offering reports and CSV exports to lecturers only', async () => {
    const headers = { cookie: `lasuatos_session=${sessionToken}` };
    const url = `/api/v1/lecturer/course-offerings/${session.courseOfferingId}/attendance-report`;
    const studentServer = createServer(student);
    expect((await studentServer.server.inject({ method: 'GET', url, headers })).statusCode).toBe(403);
    expect((await studentServer.server.inject({ method: 'GET', url: `${url}.csv`, headers })).statusCode).toBe(403);
    expect(studentServer.attendance.getOfferingReport).not.toHaveBeenCalled();

    const lecturerServer = createServer(lecturer);
    const report = await lecturerServer.server.inject({ method: 'GET', url: `${url}?threshold=60`, headers });
    expect(report.statusCode).toBe(200);
    expect(report.headers['cache-control']).toBe('no-store');
    expect(lecturerServer.attendance.getOfferingReport).toHaveBeenCalledWith(lecturer.id, session.courseOfferingId, 60);
    const { AttendanceReportSchema } = await import('@lasuatos/contracts');
    const parsed = AttendanceReportSchema.parse(report.json());
    expect(parsed.students[0]).toMatchObject({ studentId: student.id, cells: ['unlocated'], enrolledAt: '2026-09-01T00:00:00.000Z' });
    expect(parsed.sessions[0]?.startsAt).toBe(session.startsAt.toISOString());

    const csv = await lecturerServer.server.inject({ method: 'GET', url: `${url}.csv`, headers });
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(csv.headers['content-disposition']).toBe('attachment; filename="DEMO-101-attendance-2026-11-10.csv"');
    expect(csv.headers['cache-control']).toBe('no-store');
    expect(csv.body).toContain('Example Student');

    for (const bad of [`${url}?threshold=0`, `${url}?threshold=101`, `${url}?threshold=abc`, `${url}?other=1`,
      '/api/v1/lecturer/course-offerings/not-a-uuid/attendance-report']) {
      expect((await lecturerServer.server.inject({ method: 'GET', url: bad, headers })).statusCode).toBe(400);
    }
    expect(lecturerServer.attendance.getOfferingReport).toHaveBeenCalledTimes(1);
  });

  it('validates and applies lecturer corrections and lists the audit trail', async () => {
    const headers = { cookie: `lasuatos_session=${sessionToken}` };
    const url = `/api/v1/lecturer/attendance-sessions/${session.id}/corrections`;
    const payload = { studentId: student.id, action: 'mark_present', reason: '  Phone battery was flat in class.  ' };

    const studentServer = createServer(student);
    expect((await studentServer.server.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(403);
    expect(studentServer.attendance.applyCorrection).not.toHaveBeenCalled();

    const lecturerServer = createServer(lecturer);
    const applied = await lecturerServer.server.inject({ method: 'POST', url, headers, payload });
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toEqual({
      status: 'applied',
      record: {
        studentId: student.id,
        status: 'present',
        method: 'manual',
        venueOutcome: null,
        checkedInAt: session.startsAt.toISOString(),
        revokedAt: null,
      },
    });
    expect(lecturerServer.attendance.applyCorrection).toHaveBeenCalledWith(lecturer.id, session.id, {
      studentId: student.id,
      action: 'mark_present',
      reason: 'Phone battery was flat in class.',
    });

    for (const bad of [
      { ...payload, reason: 'too short' },
      { ...payload, action: 'delete' },
      { ...payload, studentId: 'nope' },
      { ...payload, status: 'present' },
      { studentId: student.id, action: 'revoke' },
    ]) {
      expect((await lecturerServer.server.inject({ method: 'POST', url, headers, payload: bad })).statusCode).toBe(400);
    }
    expect(lecturerServer.attendance.applyCorrection).toHaveBeenCalledTimes(1);

    const trail = await lecturerServer.server.inject({ method: 'GET', url, headers });
    expect(trail.statusCode).toBe(200);
    expect(trail.json()).toEqual({
      corrections: [{
        id: '0b9c1fd4-27c9-4b7e-9e4b-5bb1a1b0f001',
        studentId: student.id,
        studentName: student.displayName,
        actorName: lecturer.displayName,
        action: 'mark_present',
        previousStatus: null,
        resultingStatus: 'present',
        reason: 'Phone battery was flat in class.',
        viaDispute: false,
        createdAt: session.startsAt.toISOString(),
      }],
    });
  });

  it('returns the student attendance summary and surfaces revoked check-ins as 409', async () => {
    const headers = { cookie: `lasuatos_session=${sessionToken}` };
    const studentServer = createServer(student);
    const summary = await studentServer.server.inject({ method: 'GET', url: '/api/v1/student/attendance/summary', headers });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toEqual({
      courses: [{
        courseOfferingId: session.courseOfferingId,
        courseCode: session.courseCode,
        courseTitle: session.courseTitle,
        sessionsHeld: 4,
        attended: 3,
        revoked: 0,
        rate: 75,
        lastSessionAt: session.startsAt.toISOString(),
      }],
    });

    const { AttendanceRecordRevokedError } = await import('./service.js');
    const revokedAttendance = createAttendance();
    revokedAttendance.checkIn = vi.fn(async () => { throw new AttendanceRecordRevokedError(); });
    const revokedServer = createServer(student, revokedAttendance);
    const response = await revokedServer.server.inject({
      method: 'POST', url: '/api/v1/student/attendance/check-in', headers, payload: { code: 'ABCDEFGHJK23' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().detail).toContain('removed your check-in');

    const lecturerServer = createServer(lecturer);
    expect((await lecturerServer.server.inject({ method: 'GET', url: '/api/v1/student/attendance/summary', headers })).statusCode).toBe(403);
  });
});
