import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import type { ApiProblem } from '@lasuatos/contracts';
import { registerAuthRoutes } from './auth/routes.js';
import type { AuthRouteService } from './auth/routes.js';
import { registerAdministratorRoutes } from './admin/routes.js';
import type { AdministratorRouteOptions } from './admin/routes.js';
import { registerCourseEnrollmentRoutes } from './enrollment/routes.js';
import type { CourseEnrollmentRouteOptions } from './enrollment/routes.js';
import { registerAttendanceRoutes } from './attendance/routes.js';
import type { AttendanceRouteOptions } from './attendance/routes.js';
import { registerAttendanceDisputeRoutes } from './attendance/dispute-routes.js';
import type { AttendanceDisputeRouteOptions } from './attendance/dispute-routes.js';
import { registerVenueRoutes } from './venue/routes.js';
import type { VenueRouteOptions } from './venue/routes.js';

export interface ServerOptions {
  readonly checkDatabase?: () => Promise<void>;
  readonly auth?: AuthRouteService;
  readonly administratorOverview?: AdministratorRouteOptions['overview'];
  readonly courseEnrollment?: CourseEnrollmentRouteOptions['enrollment'];
  readonly attendance?: AttendanceRouteOptions['attendance'];
  readonly attendanceDisputes?: AttendanceDisputeRouteOptions['disputes'];
  readonly venue?: VenueRouteOptions['venue'];
  readonly secureCookies?: boolean;
  readonly logger?: FastifyServerOptions['logger'];
}

function titleForStatus(status: number): string {
  switch (status) {
    case 400:
      return 'Bad request';
    case 401:
      return 'Authentication required';
    case 403:
      return 'Forbidden';
    case 404:
      return 'Not found';
    case 409:
      return 'Conflict';
    case 422:
      return 'Unprocessable request';
    case 429:
      return 'Too many requests';
    case 503:
      return 'Service unavailable';
    default:
      return status >= 500 ? 'Internal server error' : 'Request failed';
  }
}

function detailForStatus(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return 'The request is invalid.';
    case 401:
      return 'Authentication is required.';
    case 403:
      return 'You are not authorized to perform this action.';
    case 404:
      return 'The requested resource was not found.';
    case 409:
      return 'The request conflicts with the current resource state.';
    case 429:
      return 'Too many requests. Try again later.';
    default:
      return 'The request could not be processed.';
  }
}

export function buildServer(options: ServerOptions = {}) {
  const server = Fastify({
    bodyLimit: 16 * 1024,
    genReqId: () => randomUUID(),
    logger: options.logger ?? {
      level: 'info',
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'req.body.email',
          'req.body.displayName',
          'req.body.matricNumber',
          'req.body.password',
          'req.body.token',
          'req.body.code',
          'req.body.location',
          'req.body.statement',
          'req.body.note',
        ],
        censor: '[REDACTED]',
      },
    },
  });

  registerAuthRoutes(server, {
    ...(options.auth ? { auth: options.auth } : {}),
    secureCookies: options.secureCookies ?? false,
  });
  registerCourseEnrollmentRoutes(server, {
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.courseEnrollment ? { enrollment: options.courseEnrollment } : {}),
  });
  registerAttendanceRoutes(server, {
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.attendance ? { attendance: options.attendance } : {}),
  });
  registerAttendanceDisputeRoutes(server, {
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.attendanceDisputes ? { disputes: options.attendanceDisputes } : {}),
  });
  registerVenueRoutes(server, {
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.venue ? { venue: options.venue } : {}),
  });
  registerAdministratorRoutes(server, {
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.administratorOverview ? { overview: options.administratorOverview } : {}),
  });

  server.get('/api/v1/health', async (_request, reply) => {
    return reply
      .header('cache-control', 'no-store')
      .send({
        status: 'ok',
        service: 'lasuatos-api',
        timestamp: new Date().toISOString(),
      });
  });

  server.get('/api/v1/ready', async (request, reply) => {
    if (!options.checkDatabase) {
      return reply.code(503).header('cache-control', 'no-store').send({
        status: 'not_ready',
        checks: { database: 'not_configured' },
      });
    }

    try {
      await options.checkDatabase();
      return reply.header('cache-control', 'no-store').send({
        status: 'ready',
        checks: { database: 'up' },
      });
    } catch (error) {
      request.log.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError' },
        'Database readiness check failed',
      );
      return reply.code(503).header('cache-control', 'no-store').send({
        status: 'not_ready',
        checks: { database: 'down' },
      });
    }
  });

  server.setErrorHandler((error, request, reply) => {
    const rawStatus =
      typeof error === 'object' && error !== null && 'statusCode' in error &&
      typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;
    const status = rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500;

    const errorName = error instanceof Error ? error.name : 'UnknownError';
    const logFields = { errorName, status, requestId: request.id };
    if (status >= 500) {
      request.log.error(logFields, 'Unhandled API error');
    } else {
      request.log.warn(logFields, 'API request rejected');
    }

    // Domain errors may opt in to showing their own message by setting
    // `exposeDetail: true`. Those messages are authored on the server and never
    // interpolate request values; every other client error keeps the generic
    // status text, and server errors never expose a message.
    const exposedDetail =
      status < 500 && error instanceof Error && 'exposeDetail' in error &&
      error.exposeDetail === true && error.message.length > 0 && error.message.length <= 300
        ? error.message
        : undefined;

    const problem: ApiProblem = {
      type: 'about:blank',
      title: titleForStatus(status),
      status,
      ...(status < 500 ? { detail: exposedDetail ?? detailForStatus(status) } : {}),
      instance: request.routeOptions.url ?? '/unknown',
      requestId: request.id,
    };

    return reply
      .header('cache-control', 'no-store')
      .code(status)
      .type('application/problem+json')
      .send(problem);
  });

  return server;
}
