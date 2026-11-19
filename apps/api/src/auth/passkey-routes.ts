import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  PASSKEY_LIMIT,
  PasskeyRegistrationOptionsRequestSchema,
  PasskeyRegistrationRequestSchema,
  PasskeyRenameRequestSchema,
  PasskeySignInRequestSchema,
  type Passkey,
  type PasskeyList,
  type PasskeyOptions,
} from '@lasuatos/contracts';
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server';
import { readSessionToken } from '../attendance/route-helpers.js';
import type { PasskeyRecord, PasskeyService } from './passkeys.js';
import { setSessionCookie, toAuthAccount } from './routes.js';

export type PasskeyRouteService = Pick<PasskeyService, 'relyingPartyId' | 'list' | 'registrationOptions' | 'register' | 'rename' | 'remove' | 'signInOptions' | 'signIn'>;

const passkeyParamsSchema = z.object({ passkeyId: z.uuid() }).strict();

function toPasskey(record: PasskeyRecord): Passkey {
  return {
    id: record.id,
    credentialId: record.credentialId,
    name: record.name,
    createdAt: record.createdAt.toISOString(),
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    synced: record.backedUp,
  };
}

const invalid = (message = 'Invalid request.') => Object.assign(new Error(message), { statusCode: 400, exposeDetail: true });
const unauthenticated = () => Object.assign(new Error('Authentication is required.'), { statusCode: 401 });
const unavailable = () => Object.assign(new Error('Passkeys are not available right now. Sign in with your password.'), { statusCode: 503, exposeDetail: true });
const noStore = (reply: FastifyReply) => reply.header('cache-control', 'no-store');

/**
 * Staff passkeys (ADR 037). Adding, renaming and removing need a staff session;
 * signing in needs nothing but the passkey. Every route is rate limited
 * (rate-limit-policies.ts) and goes through the origin guard.
 */
export function registerPasskeyRoutes(server: FastifyInstance, options: { readonly passkeys?: PasskeyRouteService | undefined; readonly secureCookies: boolean }): void {
  const service = () => {
    if (!options.passkeys) throw unavailable();
    return options.passkeys;
  };
  const session = (token: string | undefined) => {
    if (!token) throw unauthenticated();
    return token;
  };

  server.get('/api/v1/auth/passkeys', async (request, reply) => {
    const passkeys = service();
    const listed = await passkeys.list(session(readSessionToken(request)));
    const body: PasskeyList = {
      passkeys: listed.passkeys.map(toPasskey),
      limit: PASSKEY_LIMIT,
      relyingPartyId: passkeys.relyingPartyId,
      userHandle: listed.userHandle,
    };
    return noStore(reply).send(body);
  });

  server.post('/api/v1/auth/passkeys/registration/options', async (request, reply) => {
    const parsed = PasskeyRegistrationOptionsRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalid('Enter your current password.');
    const passkeys = service();
    const result = await passkeys.registrationOptions(session(readSessionToken(request)), parsed.data.currentPassword);
    const body: PasskeyOptions = { challengeId: result.challengeId, options: { ...result.options } };
    return noStore(reply).send(body);
  });

  // A security key may send a certificate chain with its answer, so this body can be larger than most.
  server.post('/api/v1/auth/passkeys/registration', { bodyLimit: 64 * 1024 }, async (request, reply) => {
    const parsed = PasskeyRegistrationRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalid(parsed.error.issues.some((issue) => issue.path[0] === 'name') ? 'Give the passkey a name of up to 60 characters.' : 'Invalid request.');
    const passkeys = service();
    const added = await passkeys.register(session(readSessionToken(request)), {
      challengeId: parsed.data.challengeId,
      credential: parsed.data.credential as RegistrationResponseJSON,
      name: parsed.data.name,
      userAgent: request.headers['user-agent'],
    });
    return noStore(reply).code(201).send({ passkey: toPasskey(added) });
  });

  server.post('/api/v1/auth/passkeys/:passkeyId', async (request, reply) => {
    const params = passkeyParamsSchema.safeParse(request.params);
    const parsed = PasskeyRenameRequestSchema.safeParse(request.body);
    if (!params.success) throw invalid();
    if (!parsed.success) throw invalid('Give the passkey a name of up to 60 characters.');
    const renamed = await service().rename(session(readSessionToken(request)), params.data.passkeyId, parsed.data.name);
    return noStore(reply).send({ passkey: toPasskey(renamed) });
  });

  server.delete('/api/v1/auth/passkeys/:passkeyId', async (request, reply) => {
    const params = passkeyParamsSchema.safeParse(request.params);
    if (!params.success) throw invalid();
    await service().remove(session(readSessionToken(request)), params.data.passkeyId);
    return noStore(reply).code(204).send();
  });

  server.post('/api/v1/auth/passkeys/sign-in/options', async (request, reply) => {
    if (request.body !== undefined && request.body !== null && Object.keys(request.body as object).length > 0) throw invalid();
    const result = await service().signInOptions();
    const body: PasskeyOptions = { challengeId: result.challengeId, options: { ...result.options } };
    return noStore(reply).send(body);
  });

  server.post('/api/v1/auth/passkeys/sign-in', async (request, reply) => {
    const parsed = PasskeySignInRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalid();
    const issued = await service().signIn({ challengeId: parsed.data.challengeId, credential: parsed.data.credential as AuthenticationResponseJSON });
    setSessionCookie(reply, issued.token, issued.account.sessionExpiresAt, options.secureCookies);
    return noStore(reply).send({ status: 'authenticated', account: toAuthAccount(issued.account) });
  });
}
