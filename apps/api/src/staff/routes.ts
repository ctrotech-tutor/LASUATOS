import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  StaffInvitationAcceptSchema,
  StaffInvitationCreateSchema,
  StaffInvitationTokenSchema,
  StaffStatusChangeSchema,
  UpdateStaffMemberRequestSchema,
  type ApiProblem,
} from '@lasuatos/contracts';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import type { StudentAuthService } from '../auth/service.js';
import { setSessionCookie, toAuthAccount } from '../auth/routes.js';
import { readSessionToken } from '../attendance/route-helpers.js';
import type { StaffService } from './service.js';

const invitationParamsSchema = z.object({ invitationId: z.uuid() }).strict();
const memberParamsSchema = z.object({ userId: z.uuid() }).strict();

export type StaffRouteService = Pick<
  StaffService,
  'directory' | 'scopeOptions' | 'invite' | 'resend' | 'revoke' | 'setStatus' | 'updateMember' | 'preview' | 'accept'
>;

export interface StaffRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly staff?: StaffRouteService;
  readonly secureCookies: boolean;
}

function httpError(statusCode: number, message: string, exposeDetail = false): Error {
  return Object.assign(new Error(message), { statusCode, ...(exposeDetail ? { exposeDetail: true } : {}) });
}

/** Shows only messages authored in the contracts (custom issues), never echoed input. */
function invalid(error: z.ZodError): Error {
  const custom = error.issues.find((issue) => issue.code === 'custom');
  return custom ? httpError(400, custom.message, true) : httpError(400, 'Invalid request.');
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
  return reply.header('cache-control', 'no-store').code(503).type('application/problem+json').send(problem);
}

export function registerStaffRoutes(server: FastifyInstance, options: StaffRouteOptions): void {
  async function administrator(request: FastifyRequest): Promise<AdministratorSessionAccount> {
    const token = readSessionToken(request);
    if (!token) throw httpError(401, 'Authentication is required.');
    const account = await options.auth!.getSession(token);
    if (!account) throw httpError(401, 'Authentication is required.');
    if (account.accountType !== 'administrator') {
      throw httpError(403, 'This account cannot perform the requested action.');
    }
    return account;
  }

  const ready = () => Boolean(options.auth && options.staff);

  server.get('/api/v1/admin/staff', async (request, reply) => {
    if (!ready()) return unavailable(request, reply);
    const account = await administrator(request);
    return reply.header('cache-control', 'no-store').send(await options.staff!.directory(account));
  });

  server.get('/api/v1/admin/staff/options', async (request, reply) => {
    if (!ready()) return unavailable(request, reply);
    const account = await administrator(request);
    return reply.header('cache-control', 'no-store').send(await options.staff!.scopeOptions(account));
  });

  server.post('/api/v1/admin/staff/invitations', async (request, reply) => {
    if (!ready()) return unavailable(request, reply);
    const account = await administrator(request);
    const parsed = StaffInvitationCreateSchema.safeParse(request.body);
    if (!parsed.success) throw invalid(parsed.error);
    // The raw token is deliberately not returned: the link only travels by email.
    const { invitation, emailSent } = await options.staff!.invite(account, parsed.data);
    return reply.header('cache-control', 'no-store').code(201).send({ invitation, emailSent });
  });

  server.post('/api/v1/admin/staff/invitations/:invitationId/resend', async (request, reply) => {
    if (!ready()) return unavailable(request, reply);
    const account = await administrator(request);
    const params = invitationParamsSchema.safeParse(request.params);
    if (!params.success) throw httpError(404, 'Not found.');
    return reply.header('cache-control', 'no-store').send(await options.staff!.resend(account, params.data.invitationId));
  });

  server.post('/api/v1/admin/staff/invitations/:invitationId/revoke', async (request, reply) => {
    if (!ready()) return unavailable(request, reply);
    const account = await administrator(request);
    const params = invitationParamsSchema.safeParse(request.params);
    if (!params.success) throw httpError(404, 'Not found.');
    await options.staff!.revoke(account, params.data.invitationId);
    return reply.header('cache-control', 'no-store').code(204).send();
  });

  server.post('/api/v1/admin/staff/members/:userId', async (request, reply) => {
    if (!ready()) return unavailable(request, reply);
    const account = await administrator(request);
    const params = memberParamsSchema.safeParse(request.params);
    if (!params.success) throw httpError(404, 'Not found.');
    const body = UpdateStaffMemberRequestSchema.safeParse(request.body);
    if (!body.success) throw httpError(400, 'Check the name and staff number.', true);
    await options.staff!.updateMember(account, params.data.userId, body.data);
    return reply.header('cache-control', 'no-store').code(204).send();
  });

  for (const [action, status] of [['suspend', 'suspended'], ['reactivate', 'active']] as const) {
    server.post(`/api/v1/admin/staff/members/:userId/${action}`, async (request, reply) => {
      if (!ready()) return unavailable(request, reply);
      const account = await administrator(request);
      const params = memberParamsSchema.safeParse(request.params);
      if (!params.success) throw httpError(404, 'Not found.');
      const body = StaffStatusChangeSchema.safeParse(request.body);
      if (!body.success) throw httpError(400, 'Give a reason of 10 to 500 characters.', true);
      await options.staff!.setStatus(account, params.data.userId, status, body.data.reason);
      return reply.header('cache-control', 'no-store').code(204).send();
    });
  }

  server.post('/api/v1/staff-invitations/preview', async (request, reply) => {
    if (!options.staff) return unavailable(request, reply);
    const parsed = StaffInvitationTokenSchema.safeParse(request.body);
    if (!parsed.success) throw httpError(400, 'Invalid request.');
    return reply.header('cache-control', 'no-store').send(await options.staff.preview(parsed.data.token));
  });

  server.post('/api/v1/staff-invitations/accept', async (request, reply) => {
    if (!options.staff) return unavailable(request, reply);
    const parsed = StaffInvitationAcceptSchema.safeParse(request.body);
    if (!parsed.success) {
      throw httpError(400, parsed.error.issues[0]?.path[0] === 'staffNumber'
        ? 'Write the staff number with letters, digits, spaces, / . or - only.'
        : 'Invalid request.');
    }
    const session = await options.staff.accept(parsed.data.token, parsed.data.password, parsed.data.staffNumber);
    setSessionCookie(reply, session.token, session.account.sessionExpiresAt, options.secureCookies);
    return reply.header('cache-control', 'no-store').send({ status: 'authenticated', account: toAuthAccount(session.account) });
  });
}
