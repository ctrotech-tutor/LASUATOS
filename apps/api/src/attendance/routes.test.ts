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
  status: 'open',
  startsAt: new Date('2026-11-10T12:00:00.000Z'),
  endsAt: new Date('2026-11-10T13:00:00.000Z'),
  closedAt: null,
  attendanceCount: 0,
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
  };
}

function createAttendance(): NonNullable<AttendanceRouteOptions['attendance']> {
  return {
    createSession: vi.fn(async () => ({ code: 'ABCDEFGHJK23', session })),
    listLecturerSessions: vi.fn(async () => [session]),
    getLecturerSession: vi.fn(async () => ({ session, attendees: [{ displayName: student.displayName, checkedInAt: session.startsAt }] })),
    closeSession: vi.fn(async () => 'closed' as const),
    rotateSessionCode: vi.fn(async () => ({ code: 'JKLMNPQR2345', expiresAt: session.endsAt })),
    checkIn: vi.fn(async () => ({
      kind: 'checked_in' as const,
      attendance: {
        attendanceSessionId: session.id,
        courseCode: session.courseCode,
        courseTitle: session.courseTitle,
        sessionTitle: session.title,
        checkedInAt: session.startsAt,
      },
    })),
    listStudentHistory: vi.fn(async () => [{
      attendanceSessionId: session.id,
      courseOfferingId: session.courseOfferingId,
      courseCode: session.courseCode,
      courseTitle: session.courseTitle,
      sessionTitle: session.title,
      startsAt: session.startsAt,
      checkedInAt: session.startsAt,
    }]),
    listStudentOpenSessions: vi.fn(async () => [{
      attendanceSessionId: session.id,
      courseOfferingId: session.courseOfferingId,
      courseCode: session.courseCode,
      courseTitle: session.courseTitle,
      sessionTitle: session.title,
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
      title: 'Week 4 lecture',
      durationMinutes: 60,
    });
    expect(roster.statusCode).toBe(200);
    expect(roster.json().attendees).toEqual([{ displayName: student.displayName, checkedInAt: session.startsAt.toISOString() }]);
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
    expect(studentServer.attendance.checkIn).toHaveBeenCalledWith(student.id, 'ABCDEFGHJK23');
    expect(history.statusCode).toBe(200);
    expect(history.json().records).toHaveLength(1);
    expect(open.statusCode).toBe(200);
    expect(open.json().sessions).toEqual([{
      attendanceSessionId: session.id,
      courseOfferingId: session.courseOfferingId,
      courseCode: session.courseCode,
      courseTitle: session.courseTitle,
      sessionTitle: session.title,
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
      method: 'POST', url: '/api/v1/student/attendance/check-in', headers, payload: { code: 'not-a-code' },
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
});
