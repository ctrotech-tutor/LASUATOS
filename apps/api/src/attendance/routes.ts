import {
  AttendanceCorrectionRequestSchema,
  AttendanceReportQuerySchema,
  AttendanceSessionsQuerySchema,
  CheckInAttendanceRequestSchema,
  CreateAttendanceSessionRequestSchema,
  UpdateAttendanceSessionSettingsRequestSchema,
} from '@lasuatos/contracts';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type { StudentAuthService } from '../auth/service.js';
import type { AttendanceService } from './service.js';
import {
  invalidRequest,
  notAuthenticated,
  readSessionToken,
  unavailable,
  wrongAccountType,
} from './route-helpers.js';

const sessionParamsSchema = z.object({ attendanceSessionId: z.uuid() }).strict();
const offeringParamsSchema = z.object({ courseOfferingId: z.uuid() }).strict();

function serializeSession(session: Awaited<ReturnType<AttendanceService['listLecturerSessions']>>[number]) {
  return {
    id: session.id,
    courseOfferingId: session.courseOfferingId,
    courseCode: session.courseCode,
    courseTitle: session.courseTitle,
    title: session.title,
    venueId: session.venueId,
    venueCode: session.venueCode,
    venueName: session.venueName,
    locationRequired: session.locationRequired,
    qrOnly: session.qrOnly,
    status: session.status,
    startsAt: session.startsAt.toISOString(),
    endsAt: session.endsAt.toISOString(),
    closedAt: session.closedAt?.toISOString() ?? null,
    attendanceCount: session.attendanceCount,
    ...('sharedDeviceCount' in session && typeof session.sharedDeviceCount === 'number'
      ? { sharedDeviceCount: session.sharedDeviceCount }
      : {}),
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
    | 'getSessionQrChallenge'
    | 'updateSessionSettings'
    | 'checkIn'
    | 'listStudentHistory'
    | 'listStudentOpenSessions'
  > & Partial<Pick<
    AttendanceService,
    | 'getStudentSummary'
    | 'getOfferingReport'
    | 'exportOfferingReportCsv'
    | 'applyCorrection'
    | 'listCorrections'
  >>;
}

function serializeReport(report: Awaited<ReturnType<AttendanceService['getOfferingReport']>>) {
  return {
    offering: {
      id: report.offering.id,
      courseCode: report.offering.courseCode,
      courseTitle: report.offering.courseTitle,
      departmentName: report.offering.departmentName,
      semesterLabel: report.offering.semesterLabel,
    },
    generatedAt: report.generatedAt.toISOString(),
    threshold: report.threshold,
    totals: report.totals,
    sessions: report.sessions.map((session) => ({
      ...session,
      startsAt: session.startsAt.toISOString(),
    })),
    students: report.students.map((student) => ({
      studentId: student.studentUserId,
      displayName: student.displayName,
      studentNumber: student.studentNumber,
      studentNumberVerified: student.studentNumberVerified,
      levelLabel: student.levelLabel,
      levelDiffers: student.levelDiffers,
      enrollmentStatus: student.enrollmentStatus,
      enrolledAt: student.enrolledAt.toISOString(),
      eligibleSessions: student.eligibleSessions,
      attendedSessions: student.attendedSessions,
      rate: student.rate,
      belowThreshold: student.belowThreshold,
      cells: student.cells,
    })),
  };
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
    const result = await options.attendance.createSession(account.id, {
      courseOfferingId: parsed.data.courseOfferingId,
      venueId: parsed.data.venueId ?? null,
      title: parsed.data.title,
      durationMinutes: parsed.data.durationMinutes,
      ...(parsed.data.qrOnly != null ? { qrOnly: parsed.data.qrOnly } : {}),
    });
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
        studentId: attendee.studentUserId,
        displayName: attendee.displayName,
        checkedInAt: attendee.checkedInAt.toISOString(),
        method: attendee.method,
        venueOutcome: attendee.venueOutcome,
        status: attendee.status,
        revokedAt: attendee.revokedAt?.toISOString() ?? null,
        sharedDevice: attendee.sharedDevice,
        studentNumber: attendee.studentNumber,
        levelLabel: attendee.levelLabel,
      })),
    });
  });

  server.get('/api/v1/lecturer/attendance-sessions/:attendanceSessionId/qr', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) throw invalidRequest();
    if (!options.attendance) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const result = await options.attendance.getSessionQrChallenge(account.id, params.data.attendanceSessionId);
    return reply.header('cache-control', 'no-store').send({
      status: 'ok',
      challenge: result.challenge,
      validUntil: result.validUntil.toISOString(),
      sessionEndsAt: result.sessionEndsAt.toISOString(),
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

  server.post('/api/v1/lecturer/attendance-sessions/:attendanceSessionId/settings', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    const body = UpdateAttendanceSessionSettingsRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) throw invalidRequest();
    if (!options.attendance) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const session = await options.attendance.updateSessionSettings(account.id, params.data.attendanceSessionId, {
      qrOnly: body.data.qrOnly,
    });
    return reply.header('cache-control', 'no-store').send({ status: 'updated', session: serializeSession(session) });
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
    const result = await options.attendance.checkIn(account.id, {
      ...(parsed.data.code != null ? { code: parsed.data.code } : {}),
      ...(parsed.data.challenge != null ? { challenge: parsed.data.challenge } : {}),
      ...(parsed.data.deviceToken != null ? { deviceToken: parsed.data.deviceToken } : {}),
      ...(parsed.data.location
        ? {
          location: {
            latitude: parsed.data.location.latitude,
            longitude: parsed.data.location.longitude,
            accuracyMeters: parsed.data.location.accuracyMeters ?? null,
            capturedAt: parsed.data.location.capturedAt,
          },
        }
        : {}),
    });
    return reply.header('cache-control', 'no-store').send({
      status: result.kind,
      attendance: {
        attendanceSessionId: result.attendance.attendanceSessionId,
        courseCode: result.attendance.courseCode,
        courseTitle: result.attendance.courseTitle,
        sessionTitle: result.attendance.sessionTitle,
        venueName: result.attendance.venueName,
        venueOutcome: result.attendance.venueOutcome,
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
        venueName: record.venueName,
        venueOutcome: record.venueOutcome,
        method: record.method,
        status: record.status,
        startsAt: record.startsAt.toISOString(),
        checkedInAt: record.checkedInAt.toISOString(),
      })),
    });
  });

  server.get('/api/v1/student/attendance/open', async (request, reply) => {
    if (!options.attendance) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'student') throw wrongAccountType();
    const sessions = await options.attendance.listStudentOpenSessions(account.id);
    return reply.header('cache-control', 'no-store').send({
      sessions: sessions.map((session) => ({
        attendanceSessionId: session.attendanceSessionId,
        courseOfferingId: session.courseOfferingId,
        courseCode: session.courseCode,
        courseTitle: session.courseTitle,
        sessionTitle: session.sessionTitle,
        venueCode: session.venueCode,
        venueName: session.venueName,
        locationRequired: session.locationRequired,
        qrOnly: session.qrOnly,
        endsAt: session.endsAt.toISOString(),
      })),
    });
  });

  server.get('/api/v1/student/attendance/summary', async (request, reply) => {
    if (!options.attendance?.getStudentSummary) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'student') throw wrongAccountType();
    const courses = await options.attendance.getStudentSummary(account.id);
    return reply.header('cache-control', 'no-store').send({
      courses: courses.map((course) => ({
        ...course,
        lastSessionAt: course.lastSessionAt?.toISOString() ?? null,
      })),
    });
  });

  server.get('/api/v1/lecturer/course-offerings/:courseOfferingId/attendance-report', async (request, reply) => {
    const params = offeringParamsSchema.safeParse(request.params);
    const query = AttendanceReportQuerySchema.safeParse(request.query ?? {});
    if (!params.success || !query.success) throw invalidRequest();
    if (!options.attendance?.getOfferingReport) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const report = await options.attendance.getOfferingReport(
      account.id,
      params.data.courseOfferingId,
      query.data.threshold,
    );
    return reply.header('cache-control', 'no-store').send(serializeReport(report));
  });

  server.get('/api/v1/lecturer/course-offerings/:courseOfferingId/attendance-report.csv', async (request, reply) => {
    const params = offeringParamsSchema.safeParse(request.params);
    const query = AttendanceReportQuerySchema.safeParse(request.query ?? {});
    if (!params.success || !query.success) throw invalidRequest();
    if (!options.attendance?.exportOfferingReportCsv) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const result = await options.attendance.exportOfferingReportCsv(
      account.id,
      params.data.courseOfferingId,
      query.data.threshold,
    );
    return reply
      .header('cache-control', 'no-store')
      .header('content-disposition', `attachment; filename="${result.filename}"`)
      .header('x-content-type-options', 'nosniff')
      .type('text/csv; charset=utf-8')
      .send(result.csv);
  });

  server.post('/api/v1/lecturer/attendance-sessions/:attendanceSessionId/corrections', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    const parsed = AttendanceCorrectionRequestSchema.safeParse(request.body);
    if (!params.success || !parsed.success) throw invalidRequest();
    if (!options.attendance?.applyCorrection) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const result = await options.attendance.applyCorrection(account.id, params.data.attendanceSessionId, parsed.data);
    return reply.header('cache-control', 'no-store').send({
      status: result.kind,
      record: {
        studentId: result.record.studentUserId,
        status: result.record.status,
        method: result.record.method,
        venueOutcome: result.record.venueOutcome,
        checkedInAt: result.record.checkedInAt.toISOString(),
        revokedAt: result.record.revokedAt?.toISOString() ?? null,
      },
    });
  });

  server.get('/api/v1/lecturer/attendance-sessions/:attendanceSessionId/corrections', async (request, reply) => {
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) throw invalidRequest();
    if (!options.attendance?.listCorrections) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const corrections = await options.attendance.listCorrections(account.id, params.data.attendanceSessionId);
    return reply.header('cache-control', 'no-store').send({
      corrections: corrections.map((correction) => ({
        id: correction.id,
        studentId: correction.studentUserId,
        studentName: correction.studentName,
        actorName: correction.actorName,
        action: correction.action,
        previousStatus: correction.previousStatus,
        resultingStatus: correction.resultingStatus,
        reason: correction.reason,
        viaDispute: correction.viaDispute,
        createdAt: correction.createdAt.toISOString(),
      })),
    });
  });
}
