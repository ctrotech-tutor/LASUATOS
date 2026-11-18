import type { FastifyInstance } from 'fastify';
import { BackupReportSchema } from '@lasuatos/contracts';
import type { StudentAuthService } from '../auth/service.js';
import { notAuthenticated, readSessionToken, unavailable } from '../attendance/route-helpers.js';
import type { HealthService } from './health.js';
import type { StatusNoticeSource } from './status-notices.js';
import { BackupReportError, type BackupMonitor } from './backups.js';

export interface HealthRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly health?: Pick<HealthService, 'report' | 'publicStatus'>;
  readonly notices?: Pick<StatusNoticeSource, 'current'>;
  readonly backups?: Pick<BackupMonitor, 'receive'>;
}

/**
 * GET /api/v1/admin/health: System health for institution administrators (ADR 029).
 * GET /api/v1/status: coarse public status for the independent status page (ADR 034).
 * GET /api/v1/status/notices: the status page's incident and maintenance notices, for the app banner.
 * POST /api/v1/ops/backups: the nightly backup workflow's report (ADR 035), signed by GitHub.
 */
export function registerHealthRoutes(server: FastifyInstance, options: HealthRouteOptions): void {
  server.get('/api/v1/admin/health', async (request, reply) => {
    if (!options.health || !options.auth) return unavailable(request, reply);
    const token = readSessionToken(request);
    if (!token) throw notAuthenticated();
    const account = await options.auth.getSession(token);
    if (!account) throw notAuthenticated();
    return reply.header('cache-control', 'no-store').send(await options.health.report(account));
  });

  server.get('/api/v1/status', async (request, reply) => {
    if (!options.health) return unavailable(request, reply);
    const status = await options.health.publicStatus();
    // Down parts answer 503 so a plain uptime checker sees it too; the body says which.
    const down = status.components.core === 'down';
    return reply
      .code(down ? 503 : 200)
      .header('cache-control', 'public, max-age=0, s-maxage=15')
      .header('access-control-allow-origin', '*')
      .send(status);
  });

  server.get('/api/v1/status/notices', async (_request, reply) => {
    const notices = options.notices ? await options.notices.current() : { statusPageUrl: null, notices: [] };
    // Shared by every visitor; the CDN keeps it a minute so page views do not each run the function.
    return reply.header('cache-control', 'public, max-age=60, s-maxage=60, stale-while-revalidate=300').send(notices);
  });

  server.post('/api/v1/ops/backups', async (request, reply) => {
    if (!options.backups) return unavailable(request, reply);
    const header = request.headers.authorization;
    const token = typeof header === 'string' && /^Bearer [A-Za-z0-9._-]{20,8192}$/.test(header) ? header.slice(7) : null;
    if (!token) throw new BackupReportError(401, 'Send the GitHub Actions identity token as Authorization: Bearer.');
    const body = BackupReportSchema.safeParse(request.body);
    if (!body.success) {
      const issue = body.error.issues[0];
      // The workflow log shows this, so it says which field is wrong.
      throw new BackupReportError(400, `The report is not valid: ${issue?.path.join('.') || 'body'}: ${issue?.message ?? 'invalid'}`.slice(0, 300));
    }
    await options.backups.receive(token, body.data);
    return reply.code(204).header('cache-control', 'no-store').send();
  });
}
