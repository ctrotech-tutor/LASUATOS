import { timingSafeEqual, createHash } from 'node:crypto';
import { AuditLogQuerySchema, RetentionRunRequestSchema } from '@lasuatos/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type { StudentAuthService } from '../auth/service.js';
import { notAuthenticated, readSessionToken, unavailable } from '../attendance/route-helpers.js';
import { GovernanceError, type GovernanceService } from './service.js';

export interface GovernanceRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly governance?: Pick<GovernanceService, 'auditLog' | 'retentionPreview' | 'runRetention' | 'runScheduled'>;
  /** Vercel Cron's shared secret; without it the scheduled route refuses every call. */
  readonly cronSecret?: string | undefined;
}

function sameSecret(given: string, expected: string): boolean {
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

export function registerGovernanceRoutes(server: FastifyInstance, options: GovernanceRouteOptions): void {
  async function requireAccount(request: FastifyRequest): Promise<AuthenticatedAccount> {
    if (!options.auth) throw Object.assign(new Error('Authentication is unavailable.'), { statusCode: 503 });
    const token = readSessionToken(request);
    if (!token) throw notAuthenticated();
    const account = await options.auth.getSession(token);
    if (!account) throw notAuthenticated();
    return account;
  }

  server.get('/api/v1/admin/audit', async (request, reply) => {
    const query = AuditLogQuerySchema.safeParse(request.query ?? {});
    if (!query.success) throw new GovernanceError(400, 'Choose a category, dates (from and to) or a search of up to 120 characters.');
    if (!options.governance) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.governance.auditLog(account, query.data));
  });

  server.get('/api/v1/admin/retention', async (request, reply) => {
    if (!options.governance) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.governance.retentionPreview(account));
  });

  server.post('/api/v1/admin/retention/run', async (request, reply) => {
    const body = RetentionRunRequestSchema.safeParse(request.body);
    if (!body.success) throw new GovernanceError(400, 'Confirm that you want to delete the face data that is due.');
    if (!options.governance) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.governance.runRetention(account));
  });

  // Vercel Cron calls this daily with "Authorization: Bearer <CRON_SECRET>".
  server.get('/api/v1/cron/retention', async (request, reply) => {
    const header = request.headers.authorization ?? '';
    const given = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!options.cronSecret || !given || !sameSecret(given, options.cronSecret)) {
      return reply.code(401).header('cache-control', 'no-store').send({ error: 'unauthorized' });
    }
    if (!options.governance) return unavailable(request, reply);
    const result = await options.governance.runScheduled();
    request.log.info({ event: 'retention_run', ...result }, 'Scheduled retention finished');
    return reply.header('cache-control', 'no-store').send({ status: 'ok', ...result });
  });
}
