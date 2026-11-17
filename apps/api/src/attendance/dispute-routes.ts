import {
  AdministratorAttendanceAppealsQuerySchema,
  AttendanceAppealDecisionRequestSchema,
  AttendanceAppealRequestSchema,
  AttendanceDisputeRequestSchema,
  AttendanceDisputeResolutionRequestSchema,
  LecturerAttendanceDisputesQuerySchema,
} from '@lasuatos/contracts';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type { StudentAuthService } from '../auth/service.js';
import type {
  AdministratorAppealRecord,
  AppealSummaryRecord,
  LecturerDisputeRecord,
  StudentDisputeView,
} from './dispute-repository.js';
import type { AttendanceDisputeService } from './dispute-service.js';
import {
  invalidRequest,
  notAuthenticated,
  readSessionToken,
  unavailable,
  wrongAccountType,
} from './route-helpers.js';

const disputeParamsSchema = z.object({ disputeId: z.uuid() }).strict();
const appealParamsSchema = z.object({ appealId: z.uuid() }).strict();
const emptyBodySchema = z.union([z.undefined(), z.null(), z.object({}).strict()]);
const emptyQuerySchema = z.object({}).strict();

export interface AttendanceDisputeRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly disputes?: Pick<
    AttendanceDisputeService,
    | 'getStudentDisputes'
    | 'submitDispute'
    | 'withdrawDispute'
    | 'listLecturerDisputes'
    | 'countOpenLecturerDisputes'
    | 'resolveDispute'
    | 'appealDispute'
    | 'withdrawAppeal'
    | 'listAdministratorAppeals'
    | 'countOpenAdministratorAppeals'
    | 'decideAppeal'
  >;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function serializeAppeal(appeal: AppealSummaryRecord | null) {
  if (!appeal) return null;
  return {
    id: appeal.id,
    status: appeal.status,
    statement: appeal.statement,
    departmentName: appeal.departmentName,
    decisionNote: appeal.decisionNote,
    decidedByName: appeal.decidedByName,
    decidedAt: iso(appeal.decidedAt),
    createdAt: appeal.createdAt.toISOString(),
  };
}

export function serializeStudentDispute(dispute: StudentDisputeView) {
  return {
    id: dispute.id,
    attendanceSessionId: dispute.attendanceSessionId,
    courseOfferingId: dispute.courseOfferingId,
    courseCode: dispute.courseCode,
    courseTitle: dispute.courseTitle,
    sessionTitle: dispute.sessionTitle,
    sessionStartsAt: dispute.sessionStartsAt.toISOString(),
    kind: dispute.kind,
    status: dispute.status,
    statement: dispute.statement,
    resolutionNote: dispute.resolutionNote,
    resolvedByName: dispute.resolvedByName,
    resolvedAt: iso(dispute.resolvedAt),
    createdAt: dispute.createdAt.toISOString(),
    appeal: serializeAppeal(dispute.appeal),
    appealDeadline: iso(dispute.appealDeadline),
  };
}

export function serializeLecturerDispute(dispute: LecturerDisputeRecord) {
  return {
    id: dispute.id,
    courseOfferingId: dispute.courseOfferingId,
    courseCode: dispute.courseCode,
    courseTitle: dispute.courseTitle,
    attendanceSessionId: dispute.attendanceSessionId,
    sessionTitle: dispute.sessionTitle,
    sessionStartsAt: dispute.sessionStartsAt.toISOString(),
    venueName: dispute.venueName,
    student: dispute.student,
    standing: dispute.standing,
    kind: dispute.kind,
    status: dispute.status,
    statement: dispute.statement,
    record: dispute.record
      ? {
          status: dispute.record.status,
          method: dispute.record.method,
          venueOutcome: dispute.record.venueOutcome,
          checkedInAt: dispute.record.checkedInAt.toISOString(),
          revokedAt: iso(dispute.record.revokedAt),
        }
      : null,
    lastCorrection: dispute.lastCorrection
      ? { ...dispute.lastCorrection, createdAt: dispute.lastCorrection.createdAt.toISOString() }
      : null,
    resolutionNote: dispute.resolutionNote,
    resolvedByName: dispute.resolvedByName,
    resolvedAt: iso(dispute.resolvedAt),
    createdAt: dispute.createdAt.toISOString(),
    appeal: serializeAppeal(dispute.appeal),
  };
}

export function serializeAdministratorAppeal(appeal: AdministratorAppealRecord) {
  return {
    ...serializeAppeal(appeal)!,
    conflict: appeal.conflict,
    dispute: serializeLecturerDispute(appeal.dispute),
  };
}

/**
 * Student dispute submission and the lecturer review queue. All responses
 * are `no-store`; student routes never accept a student identifier, and
 * lecturer routes only reach disputes in offerings the lecturer is assigned to.
 */
export function registerAttendanceDisputeRoutes(server: FastifyInstance, options: AttendanceDisputeRouteOptions): void {
  async function requireAccount(request: FastifyRequest): Promise<AuthenticatedAccount> {
    if (!options.auth) throw Object.assign(new Error('Authentication is unavailable.'), { statusCode: 503 });
    const token = readSessionToken(request);
    if (!token) throw notAuthenticated();
    const account = await options.auth.getSession(token);
    if (!account) throw notAuthenticated();
    return account;
  }

  server.get('/api/v1/student/attendance/disputes', async (request, reply) => {
    if (!options.disputes) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'student') throw wrongAccountType();
    const result = await options.disputes.getStudentDisputes(account.id);
    return reply.header('cache-control', 'no-store').send({
      disputes: result.disputes.map(serializeStudentDispute),
      disputableSessions: result.disputableSessions.map((session) => ({
        attendanceSessionId: session.attendanceSessionId,
        courseOfferingId: session.courseOfferingId,
        courseCode: session.courseCode,
        courseTitle: session.courseTitle,
        sessionTitle: session.sessionTitle,
        startsAt: session.startsAt.toISOString(),
        kind: session.kind,
        revocation: session.revocation
          ? { reason: session.revocation.reason, revokedAt: session.revocation.revokedAt.toISOString() }
          : null,
        disputeDeadline: session.disputeDeadline.toISOString(),
      })),
      windowDays: result.windowDays,
      openLimit: result.openLimit,
    });
  });

  server.post('/api/v1/student/attendance/disputes', async (request, reply) => {
    const parsed = AttendanceDisputeRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest();
    if (!options.disputes) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'student') throw wrongAccountType();
    const dispute = await options.disputes.submitDispute(account.id, parsed.data);
    return reply.header('cache-control', 'no-store').code(201).send({ dispute: serializeStudentDispute(dispute) });
  });

  server.post('/api/v1/student/attendance/disputes/:disputeId/withdraw', async (request, reply) => {
    const params = disputeParamsSchema.safeParse(request.params);
    if (!params.success || !emptyBodySchema.safeParse(request.body).success) throw invalidRequest();
    if (!options.disputes) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'student') throw wrongAccountType();
    const dispute = await options.disputes.withdrawDispute(account.id, params.data.disputeId);
    return reply.header('cache-control', 'no-store').send({ dispute: serializeStudentDispute(dispute) });
  });

  // A rejected dispute can be taken to the course's department, once.
  server.post('/api/v1/student/attendance/disputes/:disputeId/appeal', async (request, reply) => {
    const params = disputeParamsSchema.safeParse(request.params);
    const parsed = AttendanceAppealRequestSchema.safeParse(request.body);
    if (!params.success || !parsed.success) throw invalidRequest();
    if (!options.disputes) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'student') throw wrongAccountType();
    const dispute = await options.disputes.appealDispute(account.id, params.data.disputeId, parsed.data);
    return reply.header('cache-control', 'no-store').code(201).send({ dispute: serializeStudentDispute(dispute) });
  });

  server.post('/api/v1/student/attendance/disputes/:disputeId/appeal/withdraw', async (request, reply) => {
    const params = disputeParamsSchema.safeParse(request.params);
    if (!params.success || !emptyBodySchema.safeParse(request.body).success) throw invalidRequest();
    if (!options.disputes) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'student') throw wrongAccountType();
    const dispute = await options.disputes.withdrawAppeal(account.id, params.data.disputeId);
    return reply.header('cache-control', 'no-store').send({ dispute: serializeStudentDispute(dispute) });
  });

  // The department's appeals queue: administrators see appeals for courses in their area only.
  server.get('/api/v1/admin/attendance-appeals', async (request, reply) => {
    const query = AdministratorAttendanceAppealsQuerySchema.safeParse(request.query);
    if (!query.success) throw invalidRequest();
    if (!options.disputes) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'administrator') throw wrongAccountType();
    const result = await options.disputes.listAdministratorAppeals(account, query.data.status ? { status: query.data.status } : {});
    return reply.header('cache-control', 'no-store').send({
      appeals: result.appeals.map(serializeAdministratorAppeal),
      openCount: result.openCount,
    });
  });

  server.get('/api/v1/admin/attendance-appeals/count', async (request, reply) => {
    if (!emptyQuerySchema.safeParse(request.query).success) throw invalidRequest();
    if (!options.disputes) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'administrator') throw wrongAccountType();
    const openCount = await options.disputes.countOpenAdministratorAppeals(account);
    return reply.header('cache-control', 'no-store').send({ openCount });
  });

  server.post('/api/v1/admin/attendance-appeals/:appealId/decide', async (request, reply) => {
    const params = appealParamsSchema.safeParse(request.params);
    const parsed = AttendanceAppealDecisionRequestSchema.safeParse(request.body);
    if (!params.success || !parsed.success) throw invalidRequest();
    if (!options.disputes) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'administrator') throw wrongAccountType();
    const result = await options.disputes.decideAppeal(account, params.data.appealId, parsed.data);
    return reply.header('cache-control', 'no-store').send({
      appeal: serializeAdministratorAppeal(result.appeal),
      correction: result.correction,
    });
  });

  server.get('/api/v1/lecturer/attendance-disputes', async (request, reply) => {
    const query = LecturerAttendanceDisputesQuerySchema.safeParse(request.query);
    if (!query.success) throw invalidRequest();
    if (!options.disputes) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const result = await options.disputes.listLecturerDisputes(account.id, {
      ...(query.data.status ? { status: query.data.status } : {}),
      ...(query.data.courseOfferingId ? { courseOfferingId: query.data.courseOfferingId } : {}),
    });
    return reply.header('cache-control', 'no-store').send({
      disputes: result.disputes.map(serializeLecturerDispute),
      openCount: result.openCount,
    });
  });

  // Lightweight count for the navigation badge; avoids loading the full queue.
  server.get('/api/v1/lecturer/attendance-disputes/count', async (request, reply) => {
    if (!emptyQuerySchema.safeParse(request.query).success) throw invalidRequest();
    if (!options.disputes) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const openCount = await options.disputes.countOpenLecturerDisputes(account.id);
    return reply.header('cache-control', 'no-store').send({ openCount });
  });

  server.post('/api/v1/lecturer/attendance-disputes/:disputeId/resolve', async (request, reply) => {
    const params = disputeParamsSchema.safeParse(request.params);
    const parsed = AttendanceDisputeResolutionRequestSchema.safeParse(request.body);
    if (!params.success || !parsed.success) throw invalidRequest();
    if (!options.disputes) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const result = await options.disputes.resolveDispute(account.id, params.data.disputeId, parsed.data);
    return reply.header('cache-control', 'no-store').send({
      dispute: serializeLecturerDispute(result.dispute),
      correction: result.correction,
    });
  });
}
