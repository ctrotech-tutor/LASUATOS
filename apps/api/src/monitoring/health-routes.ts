import type { FastifyInstance } from 'fastify';
import type { StudentAuthService } from '../auth/service.js';
import { notAuthenticated, readSessionToken, unavailable } from '../attendance/route-helpers.js';
import type { HealthService } from './health.js';

export interface HealthRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly health?: Pick<HealthService, 'report'>;
}

/** GET /api/v1/admin/health: System health for institution administrators (ADR 029). */
export function registerHealthRoutes(server: FastifyInstance, options: HealthRouteOptions): void {
  server.get('/api/v1/admin/health', async (request, reply) => {
    if (!options.health || !options.auth) return unavailable(request, reply);
    const token = readSessionToken(request);
    if (!token) throw notAuthenticated();
    const account = await options.auth.getSession(token);
    if (!account) throw notAuthenticated();
    return reply.header('cache-control', 'no-store').send(await options.health.report(account));
  });
}
