import type { FastifyInstance } from 'fastify';
import type { StudentAuthService } from '../auth/service.js';
import { notAuthenticated, readSessionToken, unavailable } from '../attendance/route-helpers.js';
import { lasuMailConfig, type LasuMailSettings } from './config.js';

export interface LasuMailRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly settings?: LasuMailSettings;
}

/** GET /api/v1/mail/config: whether this account can open its LASU inbox here (ADR 030). */
export function registerLasuMailRoutes(server: FastifyInstance, options: LasuMailRouteOptions): void {
  server.get('/api/v1/mail/config', async (request, reply) => {
    if (!options.auth) return unavailable(request, reply);
    const token = readSessionToken(request);
    if (!token) throw notAuthenticated();
    const account = await options.auth.getSession(token);
    if (!account) throw notAuthenticated();
    const settings = options.settings ?? { mode: 'off', pilot: [], domains: [] };
    return reply.header('cache-control', 'private, no-store').send(lasuMailConfig(account, settings));
  });
}
