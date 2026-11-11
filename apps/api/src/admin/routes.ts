import type { ApiProblem } from '@lasuatos/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { StudentAuthService } from '../auth/service.js';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type { AdministratorOverviewService } from './service.js';

const COOKIE_NAME = 'lasuatos_session';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

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

function unauthenticated(): Error {
  return Object.assign(new Error('Authentication is required.'), { statusCode: 401 });
}

function notAdministrator(): Error {
  return Object.assign(new Error('This account cannot perform the requested action.'), { statusCode: 403 });
}

export interface AdministratorRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly overview?: Pick<AdministratorOverviewService, 'getOverview'> &
    Partial<Pick<AdministratorOverviewService, 'getAttendanceOverview'>>;
}

export function registerAdministratorRoutes(server: FastifyInstance, options: AdministratorRouteOptions): void {
  server.get('/api/v1/admin/overview', async (request, reply) => {
    if (!options.auth || !options.overview) return unavailable(request, reply);
    const token = readSessionToken(request);
    if (!token) throw unauthenticated();

    const account: AuthenticatedAccount | null = await options.auth.getSession(token);
    if (!account) throw unauthenticated();
    if (account.accountType !== 'administrator') throw notAdministrator();

    return reply.header('cache-control', 'no-store').send(
      await options.overview.getOverview(account),
    );
  });

  server.get('/api/v1/admin/attendance', async (request, reply) => {
    if (!options.auth || !options.overview?.getAttendanceOverview) return unavailable(request, reply);
    const token = readSessionToken(request);
    if (!token) throw unauthenticated();

    const account: AuthenticatedAccount | null = await options.auth.getSession(token);
    if (!account) throw unauthenticated();
    if (account.accountType !== 'administrator') throw notAdministrator();

    const overview = await options.overview.getAttendanceOverview(account);
    return reply.header('cache-control', 'no-store').send({
      generatedAt: overview.generatedAt.toISOString(),
      totals: overview.totals,
      offerings: overview.offerings.map((offering) => ({
        ...offering,
        lastSessionAt: offering.lastSessionAt?.toISOString() ?? null,
      })),
    });
  });
}
