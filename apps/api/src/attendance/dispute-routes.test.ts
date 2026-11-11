import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../server.js';
import type { AuthRouteService } from '../auth/routes.js';
import type { LecturerSessionAccount, StudentSessionAccount } from '../auth/repository.js';
import type { AttendanceDisputeRouteOptions } from './dispute-routes.js';
import type { LecturerDisputeRecord, StudentDisputeRecord } from './dispute-repository.js';
import { DisputeAlreadyOpenError, DisputeNotFoundError } from './dispute-service.js';

const sessionToken = 's'.repeat(43);
const headers = { cookie: `lasuatos_session=${sessionToken}` };
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
const sessionId = '7a5d513c-5e22-4d0e-a8ce-98d8b029865b';
const offeringId = 'b3aa9508-2ead-444c-8b8f-3051fe8d14df';
const disputeId = '5b0f8a9e-8d1c-4c71-9d53-4c1b6c0e2a11';
const statement = 'I was in the lecture hall but my phone could not load the page.';
const startsAt = new Date('2026-11-03T10:00:00.000Z');
const createdAt = new Date('2026-11-03T12:00:00.000Z');

const studentDispute: StudentDisputeRecord = {
  id: disputeId,
  attendanceSessionId: sessionId,
  courseOfferingId: offeringId,
  courseCode: 'DEMO-101',
  courseTitle: 'Demo Course',
  sessionTitle: 'Week 1 Lecture',
  sessionStartsAt: startsAt,
  kind: 'revoked_check_in',
  status: 'open',
  statement,
  resolutionNote: null,
  resolvedByName: null,
  resolvedAt: null,
  createdAt,
};

const lecturerDispute: LecturerDisputeRecord = {
  id: disputeId,
  courseOfferingId: offeringId,
  courseCode: 'DEMO-101',
  courseTitle: 'Demo Course',
  attendanceSessionId: sessionId,
  sessionTitle: 'Week 1 Lecture',
  sessionStartsAt: startsAt,
  venueName: 'Main Hall',
  student: {
    id: student.id,
    displayName: student.displayName,
    studentNumber: '00000001',
    studentNumberVerified: false,
    enrollmentStatus: 'active',
  },
  kind: 'revoked_check_in',
  status: 'upheld',
  statement,
  record: {
    status: 'present',
    method: 'manual',
    venueOutcome: null,
    checkedInAt: new Date('2026-11-04T09:00:00.000Z'),
    revokedAt: null,
  },
  lastCorrection: {
    action: 'mark_present',
    reason: 'Seen in the front row; restoring.',
    actorName: 'Example Lecturer',
    createdAt: new Date('2026-11-04T09:00:00.000Z'),
  },
  resolutionNote: 'Seen in the front row; restoring.',
  resolvedByName: 'Example Lecturer',
  resolvedAt: new Date('2026-11-04T09:00:00.000Z'),
  createdAt,
};

const servers: Array<ReturnType<typeof buildServer>> = [];

function createAuth(account: StudentSessionAccount | LecturerSessionAccount): AuthRouteService {
  return {
    registerStudent: vi.fn(async () => undefined),
    resendVerification: vi.fn(async () => undefined),
    verifyEmail: vi.fn(async () => ({ token: sessionToken, student })),
    login: vi.fn(async () => ({ token: sessionToken, account })),
    getSession: vi.fn(async (token: string) => (token === sessionToken ? account : null)),
    logout: vi.fn(async () => undefined),
  };
}

function createDisputes(): NonNullable<AttendanceDisputeRouteOptions['disputes']> {
  return {
    getStudentDisputes: vi.fn(async () => ({
      disputes: [studentDispute],
      disputableSessions: [{
        attendanceSessionId: sessionId,
        courseOfferingId: offeringId,
        courseCode: 'DEMO-101',
        courseTitle: 'Demo Course',
        sessionTitle: 'Week 2 Lecture',
        startsAt,
        kind: 'revoked_check_in' as const,
        revocation: { reason: 'Code was shared outside the hall.', revokedAt: createdAt },
        disputeDeadline: new Date('2026-11-17T11:00:00.000Z'),
      }],
      windowDays: 14,
      openLimit: 10,
    })),
    submitDispute: vi.fn(async () => studentDispute),
    withdrawDispute: vi.fn(async () => ({ ...studentDispute, status: 'withdrawn' as const })),
    listLecturerDisputes: vi.fn(async () => ({ disputes: [lecturerDispute], openCount: 3 })),
    countOpenLecturerDisputes: vi.fn(async () => 3),
    resolveDispute: vi.fn(async () => ({ dispute: lecturerDispute, correction: 'applied' as const })),
  };
}

function createServer(account: StudentSessionAccount | LecturerSessionAccount, disputes = createDisputes()) {
  const server = buildServer({ logger: false, auth: createAuth(account), attendanceDisputes: disputes });
  servers.push(server);
  return { server, disputes };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('attendance dispute routes', () => {
  it('lists a student’s disputes and disputable sessions without caching', async () => {
    const { server, disputes } = createServer(student);
    const response = await server.inject({ method: 'GET', url: '/api/v1/student/attendance/disputes', headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(disputes.getStudentDisputes).toHaveBeenCalledWith(student.id);
    expect(response.json()).toEqual({
      disputes: [{
        id: disputeId,
        attendanceSessionId: sessionId,
        courseOfferingId: offeringId,
        courseCode: 'DEMO-101',
        courseTitle: 'Demo Course',
        sessionTitle: 'Week 1 Lecture',
        sessionStartsAt: startsAt.toISOString(),
        kind: 'revoked_check_in',
        status: 'open',
        statement,
        resolutionNote: null,
        resolvedByName: null,
        resolvedAt: null,
        createdAt: createdAt.toISOString(),
      }],
      disputableSessions: [{
        attendanceSessionId: sessionId,
        courseOfferingId: offeringId,
        courseCode: 'DEMO-101',
        courseTitle: 'Demo Course',
        sessionTitle: 'Week 2 Lecture',
        startsAt: startsAt.toISOString(),
        kind: 'revoked_check_in',
        revocation: { reason: 'Code was shared outside the hall.', revokedAt: createdAt.toISOString() },
        disputeDeadline: '2026-11-17T11:00:00.000Z',
      }],
      windowDays: 14,
      openLimit: 10,
    });
  });

  it('requires a signed-in account of the right type', async () => {
    const { server, disputes } = createServer(lecturer);
    expect((await server.inject({ method: 'GET', url: '/api/v1/student/attendance/disputes' })).statusCode).toBe(401);
    expect((await server.inject({
      method: 'GET',
      url: '/api/v1/student/attendance/disputes',
      headers: { cookie: `lasuatos_session=${'x'.repeat(43)}` },
    })).statusCode).toBe(401);
    expect((await server.inject({ method: 'GET', url: '/api/v1/student/attendance/disputes', headers })).statusCode).toBe(403);
    expect((await server.inject({
      method: 'POST',
      url: '/api/v1/student/attendance/disputes',
      headers,
      payload: { attendanceSessionId: sessionId, statement },
    })).statusCode).toBe(403);
    expect(disputes.getStudentDisputes).not.toHaveBeenCalled();
    expect(disputes.submitDispute).not.toHaveBeenCalled();

    const studentServer = createServer(student);
    expect((await studentServer.server.inject({ method: 'GET', url: '/api/v1/lecturer/attendance-disputes', headers })).statusCode).toBe(403);
    expect((await studentServer.server.inject({
      method: 'POST',
      url: `/api/v1/lecturer/attendance-disputes/${disputeId}/resolve`,
      headers,
      payload: { decision: 'uphold', note: 'Seen in the front row.' },
    })).statusCode).toBe(403);
    expect(studentServer.disputes.resolveDispute).not.toHaveBeenCalled();
  });

  it('submits a dispute for the signed-in student only, with strict bodies', async () => {
    const { server, disputes } = createServer(student);
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/student/attendance/disputes',
      headers,
      payload: { attendanceSessionId: sessionId, statement },
    });
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ dispute: { id: disputeId, status: 'open' } });
    expect(disputes.submitDispute).toHaveBeenCalledWith(student.id, { attendanceSessionId: sessionId, statement });

    for (const payload of [
      { attendanceSessionId: sessionId, statement, studentId: lecturer.id },
      { attendanceSessionId: sessionId, statement, kind: 'missing_check_in' },
      { attendanceSessionId: 'not-a-uuid', statement },
      { attendanceSessionId: sessionId },
      { attendanceSessionId: sessionId, statement: 'x'.repeat(1001) },
    ]) {
      const rejected = await server.inject({ method: 'POST', url: '/api/v1/student/attendance/disputes', headers, payload });
      expect(rejected.statusCode).toBe(400);
    }
    expect(disputes.submitDispute).toHaveBeenCalledTimes(1);
  });

  it('exposes the domain explanation for refused disputes', async () => {
    const disputes = createDisputes();
    disputes.submitDispute = vi.fn(async () => { throw new DisputeAlreadyOpenError(); });
    const { server } = createServer(student, disputes);
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/student/attendance/disputes',
      headers,
      payload: { attendanceSessionId: sessionId, statement },
    });
    expect(response.statusCode).toBe(409);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.json().detail).toBe(new DisputeAlreadyOpenError().message);
  });

  it('withdraws only with an empty body and a valid id', async () => {
    const { server, disputes } = createServer(student);
    const url = `/api/v1/student/attendance/disputes/${disputeId}/withdraw`;
    for (const payload of [undefined, {}]) {
      const response = await server.inject({ method: 'POST', url, headers, ...(payload ? { payload } : {}) });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ dispute: { status: 'withdrawn' } });
    }
    expect(disputes.withdrawDispute).toHaveBeenCalledWith(student.id, disputeId);
    expect((await server.inject({ method: 'POST', url, headers, payload: { reason: 'x' } })).statusCode).toBe(400);
    expect((await server.inject({ method: 'POST', url: '/api/v1/student/attendance/disputes/nope/withdraw', headers })).statusCode).toBe(400);
  });

  it('serves the lecturer queue with filters and the current record', async () => {
    const { server, disputes } = createServer(lecturer);
    const response = await server.inject({
      method: 'GET',
      url: `/api/v1/lecturer/attendance-disputes?status=all&courseOfferingId=${offeringId}`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(disputes.listLecturerDisputes).toHaveBeenCalledWith(lecturer.id, { status: 'all', courseOfferingId: offeringId });
    const body = response.json();
    expect(body.openCount).toBe(3);
    expect(body.disputes[0]).toMatchObject({
      id: disputeId,
      venueName: 'Main Hall',
      student: { displayName: 'Example Student', enrollmentStatus: 'active' },
      record: { status: 'present', method: 'manual', checkedInAt: '2026-11-04T09:00:00.000Z', revokedAt: null },
      lastCorrection: { action: 'mark_present', createdAt: '2026-11-04T09:00:00.000Z' },
      resolvedAt: '2026-11-04T09:00:00.000Z',
    });

    await server.inject({ method: 'GET', url: '/api/v1/lecturer/attendance-disputes', headers });
    expect(disputes.listLecturerDisputes).toHaveBeenLastCalledWith(lecturer.id, {});
    for (const query of ['status=pending', 'courseOfferingId=nope', 'extra=1']) {
      expect((await server.inject({ method: 'GET', url: `/api/v1/lecturer/attendance-disputes?${query}`, headers })).statusCode).toBe(400);
    }
  });

  it('returns only the open count for the navigation badge', async () => {
    const { server, disputes } = createServer(lecturer);
    const response = await server.inject({ method: 'GET', url: '/api/v1/lecturer/attendance-disputes/count', headers });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ openCount: 3 });
    expect(disputes.countOpenLecturerDisputes).toHaveBeenCalledWith(lecturer.id);
    expect(disputes.listLecturerDisputes).not.toHaveBeenCalled();
    expect((await server.inject({ method: 'GET', url: '/api/v1/lecturer/attendance-disputes/count?status=open', headers })).statusCode).toBe(400);
    const studentServer = createServer(student);
    expect((await studentServer.server.inject({ method: 'GET', url: '/api/v1/lecturer/attendance-disputes/count', headers })).statusCode).toBe(403);
  });

  it('resolves a dispute and reports whether a correction was applied', async () => {
    const { server, disputes } = createServer(lecturer);
    const url = `/api/v1/lecturer/attendance-disputes/${disputeId}/resolve`;
    const response = await server.inject({
      method: 'POST',
      url,
      headers,
      payload: { decision: 'uphold', note: 'Seen in the front row; restoring.' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toMatchObject({ correction: 'applied', dispute: { status: 'upheld' } });
    expect(disputes.resolveDispute).toHaveBeenCalledWith(lecturer.id, disputeId, {
      decision: 'uphold',
      note: 'Seen in the front row; restoring.',
    });

    for (const payload of [
      { decision: 'approve', note: 'Seen in the front row.' },
      { decision: 'uphold' },
      { decision: 'reject', note: 'Not seen.', studentId: student.id },
    ]) {
      expect((await server.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(400);
    }

    disputes.resolveDispute = vi.fn(async () => { throw new DisputeNotFoundError(); });
    const notAssigned = createServer(lecturer, disputes);
    const missing = await notAssigned.server.inject({
      method: 'POST',
      url,
      headers,
      payload: { decision: 'reject', note: 'Not seen in class at all.' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('reports 503 when the dispute service is not configured', async () => {
    const server = buildServer({ logger: false, auth: createAuth(student) });
    servers.push(server);
    const response = await server.inject({ method: 'GET', url: '/api/v1/student/attendance/disputes', headers });
    expect(response.statusCode).toBe(503);
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
