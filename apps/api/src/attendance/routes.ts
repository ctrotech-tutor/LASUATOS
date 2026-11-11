import {
  AttendanceSessionsQuerySchema,
  CheckInAttendanceRequestSchema,
  CreateAttendanceSessionRequestSchema,
} from '@lasuatos/contracts';
import type { ApiProblem } from '@lasuatos/contracts';
import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type { StudentAuthService } from '../auth/service.js';
import type { AttendanceService } from './service.js';

const COOKIE_NAME = 'lasuatos_session';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const sessionParamsSchema = z.object({ attendanceSessionId: z.uuid() }).strict();

function readSessionToken(request: FastifyRequest): string | undefined {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return undefined;
  for (const item of cookieHeader.split(';')) {
    const separator = item.indexOf('=');
    if (separator < 0 || item.slice(0, separator).trim() !== COOKIE_NAME) continue;
    const token = item.slice(separator + 1).trim();
    return tokenPattern.test(token) ? token : undefined;
  }
  return undefined;
}

function unavailable(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const problem: ApiProblem = {
    type: 'about:blank',
    title: 'Service unavailable',
    status: 503,
    detail: 'The request could not be processed.',
    instance: request.routeOptions.url ?? '/unknown',
    requestId: request.id,
  };
  return reply.header('cache-control', 'no-store')
    .code(503)
    .type('application/problem+json')
    .send(problem);
}

function notAuthenticated(): Error {
  return Object.assign(new Error('Authentication is required.'), { statusCode: 401 });
}

function wrongAccountType(): Error {
  return Object.assign(new Error('This account cannot perform the requested action.'), { statusCode: 403 });
}

function invalidRequest(): Error {
  return Object.assign(new Error('Invalid request.'), { statusCode: 400 });
}

function serializeSession(session: Awaited<ReturnType<AttendanceService['listLecturerSessions']>>[number]) {
  return {
    id: session.id,
    courseOfferingId: session.courseOfferingId,
    courseCode: session.courseCode,
    courseTitle: session.courseTitle,
    title: session.title,
    status: session.status,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    closedAt: session.closedAt?.toISOString() ?? null,
    attendanceCount: session.attendanceCount,
  };
}

export interface AttendanceRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly attendance?: Pick<
    AttendanceService,
    | 'createSession'
    | 'listLecturerSessions'
    | 'getLecturerSession'
    | 'closeSession'
    | 'rotateSessionCode'
    | 'checkIn'
    | 'listStudentHistory'
  >;
}

export function registerAttendanceRoutes(server: FastifyInstance, options: AttendanceRouteOptions): void {
  async function requireAccount(request: FastifyRequest): Promise<AuthenticatedAccount> {
    if (!options.auth) throw Object.assign(new Error('Authentication is unavailable.'), { statusCode: 503 });
    const token = readSessionToken(request);
    if (!token) throw notAuthenticated();
    const account = await options.auth.getSession(token);
    if (!account) throw notAuthenticated();
    return account;
  }

  server.get('/api/v1/lecturer/attendance-sessions', async (request, reply) => {
    const query = AttendanceSessionsQuerySchema.safeParse(request.query);
    if (!query.success) throw invalidRequest();
    if (!options.attendance) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const sessions = await options.attendance.listLecturerSessions(account.id, query.data.courseOfferingId);
    return reply.header('cache-control', 'no-store').send({ sessions: sessions.map(serializeSession) });
  });

  server.post('/api/v1/lecturer/attendance-sessions', async (request, reply) => {
    const parsed = CreateAttendanceSessionRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest();
    if (!options.attendance) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const result = await options.attendance.createSession(account.id, parsed.data);
    return reply.header('cache-control', 'no-store').code(201).send({
      status: 'created',
      code: result.code,
      session: serializeSession(result.session),
    });
  });

  server.get('/api/v1/lecturer/attendance-sessions/:attendanceSessionId', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) throw invalidRequest();
    if (!options.attendance) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const detail = await options.attendance.getLecturerSession(account.id, params.data.attendanceSessionId);
    return reply.header('cache-control', 'no-store').send({
      session: serializeSession(detail.session),
      attendees: detail.attendees.map((attendee) => ({
        displayName: attendee.displayName,
        checkedInAt: attendee.checkedInAt.toISOString(),
      })),
    });
  });

  server.post('/api/v1/lecturer/attendance-sessions/:attendanceSessionId/close', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) throw invalidRequest();
    if (!options.attendance) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const status = await options.attendance.closeSession(account.id, params.data.attendanceSessionId);
    return reply.header('cache-control', 'no-store').send({ status });
  });

  server.post('/api/v1/lecturer/attendance-sessions/:attendanceSessionId/code', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) throw invalidRequest();
    if (!options.attendance) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const result = await options.attendance.rotateSessionCode(account.id, params.data.attendanceSessionId);
    return reply.header('cache-control', 'no-store').send({
      status: 'rotated',
      code: result.code,
      expiresAt: result.expiresAt.toISOString(),
    });
  });

  server.post('/api/v1/student/attendance/check-in', async (request, reply) => {
    const parsed = CheckInAttendanceRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest();
    if (!options.attendance) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'student') throw wrongAccountType();
    const result = await options.attendance.checkIn(account.id, parsed.data.code);
    return reply.header('cache-control', 'no-store').send({
      status: result.kind,
      attendance: {
        attendanceSessionId: result.attendance.attendanceSessionId,
        courseCode: result.attendance.courseCode,
        courseTitle: result.attendance.courseTitle,
        sessionTitle: result.attendance.sessionTitle,
        checkedInAt: result.attendance.checkedInAt.toISOString(),
      },
    });
  });

  server.get('/api/v1/student/attendance', async (request, reply) => {
    if (!options.attendance) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'student') throw wrongAccountType();
    const records = await options.attendance.listStudentHistory(account.id);
    return reply.header('cache-control', 'no-store').send({
      records: records.map((record) => ({
        attendanceSessionId: record.attendanceSessionId,
        courseOfferingId: record.courseOfferingId,
        courseCode: record.courseCode,
        courseTitle: record.courseTitle,
        sessionTitle: record.sessionTitle,
        startsAt: record.startsAt.toISOString(),
        checkedInAt: record.checkedInAt.toISOString(),
      })),
    });
  });
}
