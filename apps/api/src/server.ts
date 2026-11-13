import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyServerOptions } from 'fastify';
import { z } from 'zod';
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
import { registerStaffRoutes } from './staff/routes.js';
import { registerStructureRoutes } from './admin/structure-routes.js';
import type { StructureRouteOptions } from './admin/structure-routes.js';
import type { StaffRouteService } from './staff/routes.js';
import { registerLectureRoutes } from './lecture/routes.js';
import type { LectureRouteOptions } from './lecture/routes.js';
import { LOG_REDACT_CENSOR, LOG_REDACT_PATHS, registerSecurityHeaders } from './security/headers.js';
import { normalizeOrigins, registerOriginGuard } from './security/origin-guard.js';
import { registerRateLimiting } from './security/rate-limit-policies.js';
import type { RateLimiter } from './security/rate-limit.js';
import { fingerprintOf, scrubAlertText, within, type OperatorAlert, type OperatorAlerts } from './monitoring/alerts.js';

/** Alerts are awaited (a serverless function may stop once it responds) but never for long. */
const ALERT_WAIT_MILLISECONDS = 2_500;

const ClientErrorReportSchema = z.object({
  message: z.string().max(2_000),
  name: z.string().max(120).optional(),
  digest: z.string().max(120).optional(),
  path: z.string().min(1).max(2_000),
  userAgent: z.string().max(400).optional(),
}).strip();

function schemaBehindAlert(): OperatorAlert {
  return {
    kind: 'schema_behind',
    summary: 'database updates have not been applied',
    details: { fix: 'Redeploy the latest production build (it applies database updates), or run pnpm prod:migrate.' },
    fingerprint: 'schema-behind',
    occurredAt: new Date(),
  };
}


export interface ServerOptions {
  readonly checkDatabase?: () => Promise<void>;
  /** 'behind' means the database is missing migrations this code needs. */
  readonly checkSchema?: () => Promise<'current' | 'behind' | 'unknown'>;
  readonly auth?: AuthRouteService;
  readonly administratorOverview?: AdministratorRouteOptions['overview'];
  readonly courseEnrollment?: CourseEnrollmentRouteOptions['enrollment'];
  readonly attendance?: AttendanceRouteOptions['attendance'];
  readonly attendanceDisputes?: AttendanceDisputeRouteOptions['disputes'];
  readonly venue?: VenueRouteOptions['venue'];
  readonly staff?: StaffRouteService;
  readonly structure?: StructureRouteOptions['structure'];
  readonly lecture?: LectureRouteOptions['lecture'];
  readonly secureCookies?: boolean;
  readonly logger?: FastifyServerOptions['logger'];
  /** Applies the central rate-limit policy when provided. */
  readonly rateLimiter?: RateLimiter;
  /** Emails the operator about server errors, page crashes and an outdated database. */
  readonly alerts?: Pick<OperatorAlerts, 'report'>;
  /** Origins allowed to send state-changing browser requests (normally PUBLIC_APP_URL). */
  readonly trustedOrigins?: readonly string[];
  /** Send Strict-Transport-Security; enable only when served over HTTPS. */
  readonly hsts?: boolean;
  readonly trustProxy?: FastifyServerOptions['trustProxy'];
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
    case 410:
      return 'Gone';
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
    trustProxy: options.trustProxy ?? false,
    logger: options.logger ?? {
      level: 'info',
      redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR },
    },
  });

  // Cross-cutting protections are registered before any route.
  registerSecurityHeaders(server, { hsts: options.hsts ?? false });
  registerOriginGuard(server, normalizeOrigins(options.trustedOrigins ?? []));
  if (options.rateLimiter) registerRateLimiting(server, options.rateLimiter);

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
  registerStructureRoutes(server, {
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.structure ? { structure: options.structure } : {}),
  });
  registerLectureRoutes(server, {
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.lecture ? { lecture: options.lecture } : {}),
    ...(options.rateLimiter ? { rateLimiter: options.rateLimiter } : {}),
  });
  registerStaffRoutes(server, {
    ...(options.auth ? { auth: options.auth } : {}),
    ...(options.staff ? { staff: options.staff } : {}),
    secureCookies: options.secureCookies ?? false,
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
      const schema = options.checkSchema ? await options.checkSchema() : undefined;
      if (schema === 'behind') {
        request.log.error('Database schema is behind this release: run the database migrations');
        if (options.alerts) await within(options.alerts.report(schemaBehindAlert()), ALERT_WAIT_MILLISECONDS);
        return reply.code(503).header('cache-control', 'no-store').send({
          status: 'not_ready',
          checks: { database: 'up', schema },
        });
      }
      return reply.header('cache-control', 'no-store').send({
        status: 'ready',
        checks: { database: 'up', ...(schema ? { schema } : {}) },
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

  // Crash reports from the web app's error screens (a page stopped working in a browser).
  server.post('/api/v1/client-errors', async (request, reply) => {
    const body = ClientErrorReportSchema.safeParse(request.body);
    if (!body.success) return reply.code(204).send();
    const report = body.data;
    const message = scrubAlertText(report.message, 300);
    const page = scrubAlertText(report.path.split('#')[0]!.split('?')[0]!, 200);
    if (options.alerts) {
      await within(options.alerts.report({
        kind: 'page_error',
        summary: `${page} (${scrubAlertText(report.name ?? 'Error', 60)})`,
        details: {
          page,
          error: `${scrubAlertText(report.name ?? 'Error', 60)}: ${message}`,
          ...(report.digest ? { digest: scrubAlertText(report.digest, 40) } : {}),
          ...(report.userAgent ? { browser: scrubAlertText(report.userAgent, 160) } : {}),
          requestId: request.id,
        },
        fingerprint: fingerprintOf('page', page, report.name ?? '', message.slice(0, 120)),
        occurredAt: new Date(),
      }), ALERT_WAIT_MILLISECONDS);
    } else {
      request.log.warn({ page, errorName: report.name }, 'Page error reported by a browser');
    }
    return reply.code(204).header('cache-control', 'no-store').send();
  });

  server.setErrorHandler(async (error, request, reply) => {
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
      if (options.alerts && status === 500) {
        const route = `${request.method} ${request.routeOptions.url ?? '(unknown route)'}`;
        const message = error instanceof Error ? scrubAlertText(error.message, 300) : '';
        const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
        await within(options.alerts.report({
          kind: 'server_error',
          summary: `${route} failed (${errorName})`,
          details: {
            request: route,
            error: message ? `${errorName}: ${message}` : errorName,
            ...(code ? { code: scrubAlertText(code, 40) } : {}),
            requestId: request.id,
          },
          fingerprint: fingerprintOf('server', route, errorName, code ?? ''),
          occurredAt: new Date(),
        }), ALERT_WAIT_MILLISECONDS);
      }
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
