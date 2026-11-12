import { z } from 'zod';
import {
  CreateCourseOfferingRequestSchema,
  JoinCourseRequestSchema,
  UpdateStudentEntryLevelRequestSchema,
  type ApiProblem,
  type CourseOfferingSummary,
} from '@lasuatos/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type { StudentAuthService } from '../auth/service.js';
import type { CourseEnrollmentService } from './service.js';

const COOKIE_NAME = 'lasuatos_session';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const offeringParamsSchema = z.object({ courseOfferingId: z.uuid() }).strict();

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

function courseSummary(course: {
  readonly courseOfferingId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly departmentName: string;
  readonly semesterName: string;
  readonly level: string;
  readonly semesterEndsAt: Date;
}): CourseOfferingSummary {
  return {
    courseOfferingId: course.courseOfferingId,
    courseCode: course.courseCode,
    courseTitle: course.courseTitle,
    departmentName: course.departmentName,
    semesterName: course.semesterName,
    level: course.level,
    semesterEndsAt: course.semesterEndsAt.toISOString(),
  };
}

export interface CourseEnrollmentRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly enrollment?: Pick<
    CourseEnrollmentService,
    | 'listAvailableSemesters'
    | 'createCourseOffering'
    | 'listLecturerOfferings'
    | 'issueJoinCode'
    | 'revokeJoinCode'
    | 'joinWithCode'
    | 'listStudentEnrollments'
    | 'getStudentAcademicProfile'
    | 'updateStudentEntryLevel'
  >;
}

export function registerCourseEnrollmentRoutes(
  server: FastifyInstance,
  options: CourseEnrollmentRouteOptions,
): void {
  async function requireAccount(request: FastifyRequest): Promise<AuthenticatedAccount> {
    if (!options.auth) throw Object.assign(new Error('Authentication is unavailable.'), { statusCode: 503 });
    const token = readSessionToken(request);
    if (!token) throw notAuthenticated();
    const account = await options.auth.getSession(token);
    if (!account) throw notAuthenticated();
    return account;
  }

  server.post('/api/v1/enrollments/join', async (request, reply) => {
    const parsed = JoinCourseRequestSchema.safeParse(request.body);
    if (!parsed.success) throw Object.assign(new Error('Invalid request.'), { statusCode: 400 });
    if (!options.enrollment) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'student') throw wrongAccountType();

    const result = await options.enrollment.joinWithCode(account.id, parsed.data.code);
    return reply.header('cache-control', 'no-store').send({
      status: result.status,
      course: courseSummary(result.course),
    });
  });

  server.get('/api/v1/enrollments', async (request, reply) => {
    if (!options.enrollment) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'student') throw wrongAccountType();
    const enrollments = await options.enrollment.listStudentEnrollments(account.id);
    return reply.header('cache-control', 'no-store').send({
      enrollments: enrollments.map((enrollment) => ({
        ...courseSummary(enrollment),
        enrolledAt: enrollment.enrolledAt.toISOString(),
      })),
    });
  });

  server.get('/api/v1/student/profile', async (request, reply) => {
    if (!options.enrollment) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'student') throw wrongAccountType();
    const profile = await options.enrollment.getStudentAcademicProfile(account.id);
    if (!profile) throw wrongAccountType();
    return reply.header('cache-control', 'no-store').send(profile);
  });

  server.post('/api/v1/student/profile/entry-level', async (request, reply) => {
    const parsed = UpdateStudentEntryLevelRequestSchema.safeParse(request.body);
    if (!parsed.success) throw Object.assign(new Error('Invalid request.'), { statusCode: 400 });
    if (!options.enrollment) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'student') throw wrongAccountType();
    const profile = await options.enrollment.updateStudentEntryLevel(account.id, parsed.data.entryLevel);
    return reply.header('cache-control', 'no-store').send(profile);
  });

  server.get('/api/v1/lecturer/course-offerings', async (request, reply) => {
    if (!options.enrollment) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const offerings = await options.enrollment.listLecturerOfferings(account.id);
    return reply.header('cache-control', 'no-store').send({
      offerings: offerings.map((offering) => ({
        ...courseSummary(offering),
        joinCodeActive: offering.joinCodeActive,
      })),
    });
  });

  server.get('/api/v1/lecturer/semesters', async (request, reply) => {
    if (!options.enrollment) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();
    const semesters = await options.enrollment.listAvailableSemesters(account.id);
    return reply.header('cache-control', 'no-store').send({
      semesters: semesters.map((semester) => ({
        id: semester.id,
        name: semester.name,
        startsAt: semester.startsAt.toISOString(),
        endsAt: semester.endsAt.toISOString(),
      })),
    });
  });

  server.post('/api/v1/lecturer/course-offerings', async (request, reply) => {
    const parsed = CreateCourseOfferingRequestSchema.safeParse(request.body);
    if (!parsed.success) throw Object.assign(new Error('Invalid request.'), { statusCode: 400 });
    if (!options.enrollment) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();

    const result = await options.enrollment.createCourseOffering(account.id, parsed.data);
    return reply.header('cache-control', 'no-store')
      .code(result.status === 'created' ? 201 : 200)
      .send({ status: result.status, course: courseSummary(result.course) });
  });

  server.post('/api/v1/lecturer/course-offerings/:courseOfferingId/join-code', async (request, reply) => {
    const params = offeringParamsSchema.safeParse(request.params);
    if (!params.success) throw Object.assign(new Error('Invalid request.'), { statusCode: 400 });
    if (!options.enrollment) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();

    const result = await options.enrollment.issueJoinCode(account.id, params.data.courseOfferingId);
    return reply.header('cache-control', 'no-store').send({
      status: 'issued',
      code: result.code,
      expiresAt: result.expiresAt.toISOString(),
      rotated: result.rotated,
    });
  });

  server.delete('/api/v1/lecturer/course-offerings/:courseOfferingId/join-code', async (request, reply) => {
    const params = offeringParamsSchema.safeParse(request.params);
    if (!params.success) throw Object.assign(new Error('Invalid request.'), { statusCode: 400 });
    if (!options.enrollment) return unavailable(request, reply);
    const account = await requireAccount(request);
    if (account.accountType !== 'lecturer') throw wrongAccountType();

    await options.enrollment.revokeJoinCode(account.id, params.data.courseOfferingId);
    return reply.header('cache-control', 'no-store').code(204).send();
  });
}
