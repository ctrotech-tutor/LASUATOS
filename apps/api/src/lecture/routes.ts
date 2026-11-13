import { z } from 'zod';
import {
  AppointClassRepRequestSchema,
  ClassRepStudentLookupRequestSchema,
  CreateLectureSessionRequestSchema,
  AddLectureAttendeeRequestSchema,
  LectureCheckInRequestSchema,
  LectureRegisterQuerySchema,
  CorrectLectureAttendeeRequestSchema,
  DeleteLectureSessionRequestSchema,
  LectureSessionListQuerySchema,
  LectureSummaryQuerySchema,
  RemoveLectureAttendeeRequestSchema,
  ResolveLectureRequestSchema,
  UpdateLectureSessionRequestSchema,
} from '@lasuatos/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type { StudentAuthService } from '../auth/service.js';
import { notAuthenticated, readSessionToken, unavailable } from '../attendance/route-helpers.js';
import { LECTURE_CODE_MISS_RULE, RateLimitedError } from '../security/rate-limit-policies.js';
import type { RateLimiter } from '../security/rate-limit.js';
import { LectureError, type LectureService } from './service.js';

const sessionParams = z.object({ sessionId: z.uuid() }).strict();
const attendeeParams = z.object({ sessionId: z.uuid(), attendeeId: z.uuid() }).strict();
const repParams = z.object({ repId: z.uuid() }).strict();

const invalid = (message = 'Some details are missing or not valid.') => new LectureError(400, message);

export interface LectureRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly lecture?: Pick<
    LectureService,
    | 'capabilities'
    | 'createSession'
    | 'listSessions'
    | 'registerCourses'
    | 'register'
    | 'getSession'
    | 'currentFrame'
    | 'updateSession'
    | 'setAttendeeRemoved'
    | 'correctAttendee'
    | 'deleteSession'
    | 'summary'
    | 'addAttendee'
    | 'courseSuggestions'
    | 'venueOptions'
    | 'resolve'
    | 'checkIn'
    | 'studentHistory'
    | 'listClassReps'
    | 'findStudent'
    | 'appointClassRep'
    | 'revokeClassRep'
  >;
  readonly rateLimiter?: Pick<RateLimiter, 'check' | 'consume'>;
}

export function registerLectureRoutes(server: FastifyInstance, options: LectureRouteOptions): void {
  async function requireAccount(request: FastifyRequest): Promise<AuthenticatedAccount> {
    if (!options.auth) throw Object.assign(new Error('Authentication is unavailable.'), { statusCode: 503 });
    const token = readSessionToken(request);
    if (!token) throw notAuthenticated();
    const account = await options.auth.getSession(token);
    if (!account) throw notAuthenticated();
    return account;
  }

  /** Public routes: a signed-in student is recognised, everyone else continues as a guest. */
  async function optionalAccount(request: FastifyRequest): Promise<AuthenticatedAccount | null> {
    const token = readSessionToken(request);
    if (!token || !options.auth) return null;
    return options.auth.getSession(token);
  }

  server.get('/api/v1/lecture/capabilities', async (request, reply) => {
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.lecture.capabilities(account));
  });

  server.get('/api/v1/lecture/sessions', async (request, reply) => {
    if (!options.lecture) return unavailable(request, reply);
    const query = LectureSessionListQuerySchema.safeParse(request.query ?? {});
    if (!query.success) throw invalid();
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.lecture.listSessions(account, query.data));
  });

  server.get('/api/v1/lecture/summary', async (request, reply) => {
    const query = LectureSummaryQuerySchema.safeParse(request.query ?? {});
    if (!query.success) throw invalid();
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.lecture.summary(account, query.data.days));
  });

  server.post('/api/v1/lecture/sessions/:sessionId/delete', async (request, reply) => {
    const params = sessionParams.safeParse(request.params);
    const body = DeleteLectureSessionRequestSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) throw invalid();
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    await options.lecture.deleteSession(account, params.data.sessionId, body.data);
    return reply.code(204).header('cache-control', 'no-store').send();
  });

  server.get('/api/v1/lecture/registers', async (request, reply) => {
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.lecture.registerCourses(account));
  });

  server.get('/api/v1/lecture/register', async (request, reply) => {
    const query = LectureRegisterQuerySchema.safeParse(request.query);
    if (!query.success) throw invalid('Choose a course.');
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.lecture.register(account, query.data.course, query.data.term));
  });

  server.post('/api/v1/lecture/sessions', async (request, reply) => {
    const body = CreateLectureSessionRequestSchema.safeParse(request.body);
    if (!body.success) throw invalid('Enter the course code, the course title and how long attendance stays open.');
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    const session = await options.lecture.createSession(account, body.data);
    return reply.code(201).header('cache-control', 'no-store').send(session);
  });

  server.get('/api/v1/lecture/sessions/:sessionId', async (request, reply) => {
    const params = sessionParams.safeParse(request.params);
    if (!params.success) throw invalid();
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.lecture.getSession(account, params.data.sessionId));
  });

  server.get('/api/v1/lecture/sessions/:sessionId/qr', async (request, reply) => {
    const params = sessionParams.safeParse(request.params);
    if (!params.success) throw invalid();
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.lecture.currentFrame(account, params.data.sessionId));
  });

  server.post('/api/v1/lecture/sessions/:sessionId', async (request, reply) => {
    const params = sessionParams.safeParse(request.params);
    const body = UpdateLectureSessionRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) throw invalid();
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.lecture.updateSession(account, params.data.sessionId, body.data));
  });

  server.post('/api/v1/lecture/sessions/:sessionId/attendees', async (request, reply) => {
    const params = sessionParams.safeParse(request.params);
    if (!params.success) throw invalid();
    const body = AddLectureAttendeeRequestSchema.safeParse(request.body);
    if (!body.success) {
      const field = body.error.issues[0]?.path[0];
      throw new LectureError(422, field === 'fullName'
        ? 'Enter the student’s full name (at least 3 letters).'
        : 'Enter the matric number using digits and letters only.');
    }
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    const result = await options.lecture.addAttendee(account, params.data.sessionId, body.data);
    return reply.code(result.status === 'added' ? 201 : 200).header('cache-control', 'no-store').send(result);
  });

  server.post('/api/v1/lecture/sessions/:sessionId/attendees/:attendeeId', async (request, reply) => {
    const params = attendeeParams.safeParse(request.params);
    const body = RemoveLectureAttendeeRequestSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) throw invalid();
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    await options.lecture.setAttendeeRemoved(account, params.data.sessionId, params.data.attendeeId, body.data);
    return reply.header('cache-control', 'no-store').send({ status: 'saved', id: params.data.attendeeId });
  });

  server.post('/api/v1/lecture/sessions/:sessionId/attendees/:attendeeId/details', async (request, reply) => {
    const params = attendeeParams.safeParse(request.params);
    const body = CorrectLectureAttendeeRequestSchema.safeParse(request.body ?? {});
    if (!params.success || !body.success) throw invalid();
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    const result = await options.lecture.correctAttendee(account, params.data.sessionId, params.data.attendeeId, body.data);
    return reply.header('cache-control', 'no-store').send(result);
  });

  server.get('/api/v1/lecture/course-suggestions', async (request, reply) => {
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.lecture.courseSuggestions(account));
  });

  server.get('/api/v1/lecture/venues', async (request, reply) => {
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.lecture.venueOptions(account));
  });

  server.post('/api/v1/lecture/resolve', async (request, reply) => {
    const body = ResolveLectureRequestSchema.safeParse(request.body);
    if (!body.success) throw invalid('Scan the QR code or type the code shown by your lecturer or class rep.');
    if (!options.lecture) return unavailable(request, reply);
    const account = await optionalAccount(request);
    // Typed codes can be guessed; scanned challenges are signed. Refuse an address
    // that has typed too many wrong codes before looking this one up.
    const missRule = body.data.code && !body.data.challenge && options.rateLimiter
      ? { ...LECTURE_CODE_MISS_RULE, subject: request.ip }
      : null;
    if (missRule) {
      const decision = await options.rateLimiter!.check(missRule);
      if (!decision.allowed) {
        request.log.warn({ rule: decision.rule, requestId: request.id }, 'Request rate limited');
        reply.header('retry-after', String(decision.retryAfterSeconds));
        throw new RateLimitedError(decision.retryAfterSeconds);
      }
    }
    try {
      return reply.header('cache-control', 'no-store').send(await options.lecture.resolve(account, body.data));
    } catch (error) {
      if (missRule && error instanceof LectureError && error.statusCode === 404) {
        await options.rateLimiter!.consume([missRule]);
      }
      throw error;
    }
  });

  server.post('/api/v1/lecture/check-in', async (request, reply) => {
    const body = LectureCheckInRequestSchema.safeParse(request.body);
    if (!body.success) {
      const field = body.error.issues[0]?.path[0];
      throw new LectureError(422, field === 'fullName'
        ? 'Enter your full name (at least 3 letters).'
        : field === 'matricNumber'
          ? 'Enter your matric number using digits and letters only.'
          : 'Some details are missing. Scan the QR code again.');
    }
    if (!options.lecture) return unavailable(request, reply);
    const account = await optionalAccount(request);
    const result = await options.lecture.checkIn(account, body.data);
    return reply.code(result.status === 'checked_in' ? 201 : 200).header('cache-control', 'no-store').send(result);
  });

  server.get('/api/v1/student/lecture-history', async (request, reply) => {
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.lecture.studentHistory(account));
  });

  server.get('/api/v1/class-reps', async (request, reply) => {
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.lecture.listClassReps(account));
  });

  server.post('/api/v1/class-reps/lookup', async (request, reply) => {
    const body = ClassRepStudentLookupRequestSchema.safeParse(request.body);
    if (!body.success) throw invalid('Type the student\'s matric number or email.');
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.lecture.findStudent(account, body.data.query));
  });

  server.post('/api/v1/class-reps', async (request, reply) => {
    const body = AppointClassRepRequestSchema.safeParse(request.body);
    if (!body.success) throw invalid('Choose the student, the role and the set.');
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.code(201).header('cache-control', 'no-store').send(await options.lecture.appointClassRep(account, body.data));
  });

  server.post('/api/v1/class-reps/:repId/revoke', async (request, reply) => {
    const params = repParams.safeParse(request.params);
    if (!params.success) throw invalid();
    if (!options.lecture) return unavailable(request, reply);
    const account = await requireAccount(request);
    await options.lecture.revokeClassRep(account, params.data.repId);
    return reply.header('cache-control', 'no-store').send({ status: 'saved', id: params.data.repId });
  });
}
