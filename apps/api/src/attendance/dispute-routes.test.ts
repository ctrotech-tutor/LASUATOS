import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../server.js';
import type { AuthRouteService } from '../auth/routes.js';
import {
  AdministratorAttendanceAppealDecisionResponseSchema,
  AdministratorAttendanceAppealsSchema,
  StudentAttendanceDisputeResponseSchema,
  StudentAttendanceDisputesSchema,
} from '@lasuatos/contracts';
import type {
  AdministratorSessionAccount,
  AuthenticatedAccount,
  LecturerSessionAccount,
  StudentSessionAccount,
} from '../auth/repository.js';
import type { AttendanceDisputeRouteOptions } from './dispute-routes.js';
import type { AdministratorAppealRecord, LecturerDisputeRecord, StudentDisputeView } from './dispute-repository.js';
import { AppealConflictError, DisputeAlreadyOpenError, DisputeNotFoundError } from './dispute-service.js';

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
const administrator: AdministratorSessionAccount = {
  accountType: 'administrator',
  id: '0d6c2f61-3b8e-4a8c-9a8e-55f1c1f0c0aa',
  email: 'hod@example.net',
  displayName: 'Example HOD',
  emailVerified: true,
  institutionName: 'Example University',
  institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
  role: 'department_administrator',
  scope: {
    type: 'department',
    id: '2c8f0a51-0a6b-4f5e-9f53-8a3f3b1f8e01',
    label: 'Example Department',
    facultyName: 'Example Faculty',
    institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
  },
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
};
const appealId = '9f1e7a3c-2b4d-4e6f-8a1b-3c5d7e9f0a12';
const sessionId = '7a5d513c-5e22-4d0e-a8ce-98d8b029865b';
const offeringId = 'b3aa9508-2ead-444c-8b8f-3051fe8d14df';
const disputeId = '5b0f8a9e-8d1c-4c71-9d53-4c1b6c0e2a11';
const statement = 'I was in the lecture hall but my phone could not load the page.';
const startsAt = new Date('2026-11-03T10:00:00.000Z');
const createdAt = new Date('2026-11-03T12:00:00.000Z');

const studentDispute: StudentDisputeView = {
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
  appeal: null,
  appealFacts: { disputeStatus: 'open', resolvedAt: null, hasAppeal: false, enrollmentStatus: 'active', recordStatus: 'revoked' },
  appealDeadline: null,
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
  standing: { attended: 3, eligible: 4, countsThisClass: true },
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
  appeal: null,
};

const appealSummary = {
  id: appealId,
  status: 'open' as const,
  statement: 'The venue check shows I was in the hall; please look again.',
  departmentName: 'Example Department',
  decisionNote: null,
  decidedByName: null,
  decidedAt: null,
  createdAt: new Date('2026-11-05T09:00:00.000Z'),
};

const administratorAppeal: AdministratorAppealRecord = {
  ...appealSummary,
  conflict: false,
  dispute: { ...lecturerDispute, status: 'rejected', appeal: appealSummary },
};

const servers: Array<ReturnType<typeof buildServer>> = [];

function createAuth(account: AuthenticatedAccount): AuthRouteService {
  return {
    registerStudent: vi.fn(async () => ({ token: sessionToken, student })),
    resendVerification: vi.fn(async () => undefined),
    verifyEmail: vi.fn(async () => ({ token: sessionToken, student })),
    login: vi.fn(async () => ({ token: sessionToken, account })),
    getSession: vi.fn(async (token: string) => (token === sessionToken ? account : null)),
    logout: vi.fn(async () => undefined),
    requestPasswordReset: vi.fn(async () => undefined),
    completePasswordReset: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => 0),
    listSessions: vi.fn(async () => []),
    revokeOtherSessions: vi.fn(async () => 0),
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
    appealDispute: vi.fn(async () => ({
      ...studentDispute,
      status: 'rejected' as const,
      appeal: appealSummary,
    })),
    withdrawAppeal: vi.fn(async () => ({
      ...studentDispute,
      status: 'rejected' as const,
      appeal: { ...appealSummary, status: 'withdrawn' as const, decidedAt: createdAt },
    })),
    listAdministratorAppeals: vi.fn(async () => ({ appeals: [administratorAppeal], openCount: 1 })),
    countOpenAdministratorAppeals: vi.fn(async () => 1),
    decideAppeal: vi.fn(async () => ({
      appeal: {
        ...administratorAppeal,
        status: 'upheld' as const,
        decisionNote: 'The venue check places you in the hall.',
        decidedByName: administrator.displayName,
        decidedAt: createdAt,
      },
      correction: 'applied' as const,
    })),
  };
}

function createServer(account: AuthenticatedAccount, disputes = createDisputes()) {
  const server = buildServer({ logger: false, auth: createAuth(account), attendanceDisputes: disputes });
  servers.push(server);
  return { server, disputes };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('attendance appeal routes', () => {
  it('lets a student take their own dispute to the department, with a strict body', async () => {
    const { server, disputes } = createServer(student);
    const url = `/api/v1/student/attendance/disputes/${disputeId}/appeal`;
    const appealStatement = 'The venue check shows I was in the hall; please look again.';
    const response = await server.inject({ method: 'POST', url, headers, payload: { statement: appealStatement } });
    expect(response.statusCode).toBe(201);
    expect(response.headers['cache-control']).toBe('no-store');
    const body = StudentAttendanceDisputeResponseSchema.parse(response.json());
    expect(body.dispute.appeal).toMatchObject({ id: appealId, status: 'open', departmentName: 'Example Department' });
    expect(disputes.appealDispute).toHaveBeenCalledWith(student.id, disputeId, { statement: appealStatement });

    for (const payload of [{}, { statement: 'too short' }, { statement: appealStatement, studentId: lecturer.id }]) {
      expect((await server.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(400);
    }
    expect((await server.inject({ method: 'POST', url: '/api/v1/student/attendance/disputes/nope/appeal', headers, payload: { statement: appealStatement } })).statusCode).toBe(400);
    expect(disputes.appealDispute).toHaveBeenCalledTimes(1);

    const withdrawn = await server.inject({ method: 'POST', url: `${url}/withdraw`, headers });
    expect(withdrawn.statusCode).toBe(200);
    expect(StudentAttendanceDisputeResponseSchema.parse(withdrawn.json()).dispute.appeal?.status).toBe('withdrawn');
    expect((await server.inject({ method: 'POST', url: `${url}/withdraw`, headers, payload: { reason: 'x' } })).statusCode).toBe(400);
  });

  it('keeps appeals to students and the queue to administrators', async () => {
    const lecturerServer = createServer(lecturer);
    expect((await lecturerServer.server.inject({
      method: 'POST',
      url: `/api/v1/student/attendance/disputes/${disputeId}/appeal`,
      headers,
      payload: { statement: 'The venue check shows I was in the hall.' },
    })).statusCode).toBe(403);
    expect((await lecturerServer.server.inject({ method: 'GET', url: '/api/v1/admin/attendance-appeals', headers })).statusCode).toBe(403);
    expect((await lecturerServer.server.inject({
      method: 'POST',
      url: `/api/v1/admin/attendance-appeals/${appealId}/decide`,
      headers,
      payload: { decision: 'uphold', note: 'Seen in the hall.' },
    })).statusCode).toBe(403);
    expect(lecturerServer.disputes.decideAppeal).not.toHaveBeenCalled();
    expect((await createServer(student).server.inject({ method: 'GET', url: '/api/v1/admin/attendance-appeals/count', headers })).statusCode).toBe(403);
  });

  it('lists, counts and decides appeals in the administrator’s area', async () => {
    const { server, disputes } = createServer(administrator);
    const list = await server.inject({ method: 'GET', url: '/api/v1/admin/attendance-appeals?status=all', headers });
    expect(list.statusCode).toBe(200);
    expect(list.headers['cache-control']).toBe('no-store');
    const parsed = AdministratorAttendanceAppealsSchema.parse(list.json());
    expect(parsed.appeals[0]).toMatchObject({ id: appealId, conflict: false, dispute: { id: disputeId, status: 'rejected' } });
    expect(disputes.listAdministratorAppeals).toHaveBeenCalledWith(administrator, { status: 'all' });
    expect((await server.inject({ method: 'GET', url: '/api/v1/admin/attendance-appeals?status=open&x=1', headers })).statusCode).toBe(400);
    expect((await server.inject({ method: 'GET', url: '/api/v1/admin/attendance-appeals/count', headers })).json()).toEqual({ openCount: 1 });

    const url = `/api/v1/admin/attendance-appeals/${appealId}/decide`;
    const decided = await server.inject({ method: 'POST', url, headers, payload: { decision: 'uphold', note: 'The venue check places you in the hall.' } });
    expect(decided.statusCode).toBe(200);
    expect(AdministratorAttendanceAppealDecisionResponseSchema.parse(decided.json())).toMatchObject({ appeal: { status: 'upheld' }, correction: 'applied' });
    expect(disputes.decideAppeal).toHaveBeenCalledWith(administrator, appealId, { decision: 'uphold', note: 'The venue check places you in the hall.' });
    for (const payload of [{ decision: 'maybe', note: 'Seen in the hall.' }, { decision: 'reject', note: 'short' }, { decision: 'reject' }]) {
      expect((await server.inject({ method: 'POST', url, headers, payload })).statusCode).toBe(400);
    }
  });

  it('explains why the person who rejected the dispute cannot decide the appeal', async () => {
    const disputes = createDisputes();
    disputes.decideAppeal = vi.fn(async () => { throw new AppealConflictError(); });
    const { server } = createServer(administrator, disputes);
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/admin/attendance-appeals/${appealId}/decide`,
      headers,
      payload: { decision: 'reject', note: 'Nothing places you in the hall.' },
    });
    expect(response.statusCode).toBe(409);
    expect(response.json().detail).toBe(new AppealConflictError().message);
  });

  it('serves the student list in the published shape', async () => {
    const { server } = createServer(student);
    const response = await server.inject({ method: 'GET', url: '/api/v1/student/attendance/disputes', headers });
    expect(() => StudentAttendanceDisputesSchema.parse(response.json())).not.toThrow();
  });
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
        appeal: null,
        appealDeadline: null,
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
      standing: { attended: 3, eligible: 4, countsThisClass: true },
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
