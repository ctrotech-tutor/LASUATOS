import { ContactInboxQuerySchema, ContactMessageRequestSchema, ContactMessageUpdateSchema } from '@lasuatos/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type { StudentAuthService } from '../auth/service.js';
import { notAuthenticated, readSessionToken, unavailable } from '../attendance/route-helpers.js';
import { within } from '../monitoring/alerts.js';
import { ContactError, type ContactService } from './service.js';

/** Serverless functions may stop once they respond, so the emails are awaited, briefly. */
const EMAIL_WAIT_MILLISECONDS = 4_000;

export interface ContactRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly contact?: Pick<ContactService, 'submit' | 'inbox' | 'newCount' | 'setStatus'>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function registerContactRoutes(server: FastifyInstance, options: ContactRouteOptions): void {
  async function requireAccount(request: FastifyRequest): Promise<AuthenticatedAccount> {
    if (!options.auth) throw Object.assign(new Error('Authentication is unavailable.'), { statusCode: 503 });
    const token = readSessionToken(request);
    if (!token) throw notAuthenticated();
    const account = await options.auth.getSession(token);
    if (!account) throw notAuthenticated();
    return account;
  }

  async function optionalAccount(request: FastifyRequest): Promise<AuthenticatedAccount | null> {
    const token = readSessionToken(request);
    if (!token || !options.auth) return null;
    return options.auth.getSession(token).catch(() => null);
  }

  server.post('/api/v1/contact', async (request, reply) => {
    const body = ContactMessageRequestSchema.safeParse(request.body);
    if (!body.success) {
      const first = body.error.issues[0];
      // Only the messages written into the contract are shown; zod's own wording never is.
      const known = first && first.code !== 'unrecognized_keys' && first.message && !/expected|invalid|too (big|small)|unrecognized/i.test(first.message) ? first.message : null;
      throw new ContactError(400, known ?? 'Check the form and try again.');
    }
    if (!options.contact) return unavailable(request, reply);
    const sender = await optionalAccount(request);
    const result = await options.contact.submit(body.data, sender);
    await within(result.delivered, EMAIL_WAIT_MILLISECONDS);
    return reply.code(201).header('cache-control', 'no-store').send({ reference: result.reference });
  });

  server.get('/api/v1/admin/messages', async (request, reply) => {
    const query = ContactInboxQuerySchema.safeParse(request.query ?? {});
    if (!query.success) throw new ContactError(400, 'Choose new, handled or all messages.');
    if (!options.contact) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.contact.inbox(account, query.data));
  });

  server.get('/api/v1/admin/messages/count', async (request, reply) => {
    if (!options.contact) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.contact.newCount(account));
  });

  server.post<{ Params: { messageId: string } }>('/api/v1/admin/messages/:messageId', async (request, reply) => {
    const body = ContactMessageUpdateSchema.safeParse(request.body);
    if (!body.success || !UUID.test(request.params.messageId)) throw new ContactError(400, 'Mark the message as new or handled.');
    if (!options.contact) return unavailable(request, reply);
    const account = await requireAccount(request);
    return reply.header('cache-control', 'no-store').send(await options.contact.setStatus(account, request.params.messageId, body.data.status));
  });
}
