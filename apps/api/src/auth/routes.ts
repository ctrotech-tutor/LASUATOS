import { z } from 'zod';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  AuthAdministratorSchema,
  NewPasswordSchema,
  PasswordChangeRequestSchema,
  PasswordResetCompleteSchema,
  PasswordResetRequestSchema,
} from '@lasuatos/contracts';
import type {
  AccountSessions,
  ApiProblem,
  AuthAccount,
  AuthStudent,
  PasswordChanged,
  PasswordResetCompleted,
  SessionsRevoked,
} from '@lasuatos/contracts';
import { AuthOperationUnavailableError, EmailDeliveryDeferredError } from './service.js';
import type { AccountSessionRecord, AuthenticatedAccount } from './repository.js';
import type { StudentAuthService } from './service.js';

const COOKIE_NAME = 'lasuatos_session';
const MAX_SESSION_AGE_SECONDS = 30 * 24 * 60 * 60;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

const registrationSchema = z.object({
  displayName: z.string().trim().min(1).max(160),
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  matricNumber: z.string().trim().min(1).max(64),
  password: NewPasswordSchema,
}).strict();

const sessionParamsSchema = z.object({ sessionId: z.uuid() }).strict();

const emailSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
}).strict();

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(320)),
  password: z.string().min(1).max(128),
}).strict();

const verificationSchema = z.object({
  token: z.string().regex(tokenPattern),
}).strict();

function invalidRequest(): Error {
  return Object.assign(new Error('Invalid request.'), { statusCode: 400 });
}

function serviceUnavailable(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const problem: ApiProblem = {
    type: 'about:blank',
    title: 'Service unavailable',
    status: 503,
    detail: 'The request could not be processed.',
    instance: request.routeOptions.url ?? '/unknown',
    requestId: request.id,
  };
  return reply
    .header('cache-control', 'no-store')
    .code(503)
    .type('application/problem+json')
    .send(problem);
}

function unauthenticated(): Error {
  return Object.assign(new Error('Authentication is required.'), { statusCode: 401 });
}

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

function toAuthStudent(student: {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly matricNumber: string;
  readonly matricNumberVerified: boolean;
  readonly sessionExpiresAt: Date;
}): AuthStudent {
  return {
    id: student.id,
    email: student.email,
    displayName: student.displayName,
    accountType: 'student',
    emailVerified: true,
    matricNumber: student.matricNumber,
    matricNumberVerified: student.matricNumberVerified,
    sessionExpiresAt: student.sessionExpiresAt.toISOString(),
  };
}

function toAuthAccount(account: AuthenticatedAccount): AuthAccount {
  if (account.accountType === 'student') return toAuthStudent(account);
  if (account.accountType === 'lecturer') {
    return {
      id: account.id,
      email: account.email,
      displayName: account.displayName,
      accountType: 'lecturer',
      emailVerified: true,
      sessionExpiresAt: account.sessionExpiresAt.toISOString(),
    };
  }

  const scope = account.scope.type === 'department'
    ? {
        type: 'department' as const,
        id: account.scope.id,
        label: account.scope.label,
        facultyName: account.scope.facultyName,
      }
    : {
        type: account.scope.type,
        id: account.scope.id,
        label: account.scope.label,
      };
  return AuthAdministratorSchema.parse({
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    accountType: 'administrator',
    emailVerified: true,
    institutionName: account.institutionName,
    institutionId: account.institutionId,
    role: account.role,
    scope,
    sessionExpiresAt: account.sessionExpiresAt.toISOString(),
  });
}

function setSessionCookie(
  reply: FastifyReply,
  token: string,
  expiresAt: Date,
  secure: boolean,
): void {
  const maxAge = Math.min(
    MAX_SESSION_AGE_SECONDS,
    Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1_000)),
  );
  const secureAttribute = secure ? '; Secure' : '';
  reply.header(
    'set-cookie',
    `${COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}; Expires=${expiresAt.toUTCString()}${secureAttribute}`,
  );
}

function clearSessionCookie(reply: FastifyReply, secure: boolean): void {
  const secureAttribute = secure ? '; Secure' : '';
  reply.header(
    'set-cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureAttribute}`,
  );
}

function logDeferredEmailFailure(request: FastifyRequest, purpose = 'Verification'): void {
  request.log.warn(
    { errorName: 'EmailDeliveryError', requestId: request.id },
    `${purpose} email was not accepted by the configured provider`,
  );
}

function toAccountSession(session: AccountSessionRecord) {
  return {
    id: session.id,
    createdAt: session.createdAt.toISOString(),
    lastSeenAt: session.lastSeenAt?.toISOString() ?? null,
    expiresAt: session.expiresAt.toISOString(),
    current: session.current,
  };
}

function cachePrivate(reply: FastifyReply): FastifyReply {
  return reply.header('cache-control', 'no-store');
}

export type AuthRouteService = Pick<
  StudentAuthService,
  | 'registerStudent'
  | 'resendVerification'
  | 'verifyEmail'
  | 'login'
  | 'getSession'
  | 'logout'
  | 'requestPasswordReset'
  | 'completePasswordReset'
  | 'changePassword'
  | 'listSessions'
  | 'revokeOtherSessions'
>;

export interface AuthRouteOptions {
  readonly auth?: AuthRouteService;
  readonly secureCookies: boolean;
}

export function registerAuthRoutes(server: FastifyInstance, options: AuthRouteOptions): void {
  server.post('/api/v1/auth/register', async (request, reply) => {
    const parsed = registrationSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest();
    if (!options.auth) return serviceUnavailable(request, reply);

    try {
      await options.auth.registerStudent(parsed.data);
    } catch (error) {
      if (error instanceof EmailDeliveryDeferredError) {
        logDeferredEmailFailure(request);
      } else if (error instanceof AuthOperationUnavailableError) {
        return serviceUnavailable(request, reply);
      } else {
        throw error;
      }
    }

    return cachePrivate(reply).code(202).send({
      status: 'accepted',
      message: 'If an account can be created for this address, a confirmation link will be sent.',
    });
  });

  server.post('/api/v1/auth/resend-verification', async (request, reply) => {
    const parsed = emailSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest();
    if (!options.auth) return serviceUnavailable(request, reply);

    try {
      await options.auth.resendVerification(parsed.data.email);
    } catch (error) {
      if (error instanceof EmailDeliveryDeferredError) {
        logDeferredEmailFailure(request);
      } else if (error instanceof AuthOperationUnavailableError) {
        return serviceUnavailable(request, reply);
      } else {
        throw error;
      }
    }

    return cachePrivate(reply).code(202).send({
      status: 'accepted',
      message: 'If this account is waiting for email confirmation, a new link will be sent.',
    });
  });

  server.post('/api/v1/auth/verify-email', async (request, reply) => {
    const parsed = verificationSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest();
    if (!options.auth) return serviceUnavailable(request, reply);

    const session = await options.auth.verifyEmail(parsed.data.token);
    setSessionCookie(reply, session.token, session.student.sessionExpiresAt, options.secureCookies);
    return cachePrivate(reply).send({
      status: 'verified',
      student: toAuthStudent(session.student),
    });
  });

  server.post('/api/v1/auth/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest();
    if (!options.auth) return serviceUnavailable(request, reply);

    const session = await options.auth.login(parsed.data.email, parsed.data.password);
    setSessionCookie(reply, session.token, session.account.sessionExpiresAt, options.secureCookies);
    return cachePrivate(reply).send({
      status: 'authenticated',
      account: toAuthAccount(session.account),
    });
  });

  server.get('/api/v1/auth/session', async (request, reply) => {
    if (!options.auth) return serviceUnavailable(request, reply);
    const token = readSessionToken(request);
    if (!token) throw unauthenticated();

    const account = await options.auth.getSession(token);
    if (!account) {
      clearSessionCookie(reply, options.secureCookies);
      throw unauthenticated();
    }
    return cachePrivate(reply).send({
      status: 'authenticated',
      account: toAuthAccount(account),
    });
  });

  server.post('/api/v1/auth/logout', async (request, reply) => {
    if (!options.auth) return serviceUnavailable(request, reply);
    const token = readSessionToken(request);
    if (token) await options.auth.logout(token);
    clearSessionCookie(reply, options.secureCookies);
    return cachePrivate(reply).code(204).send();
  });

  server.post('/api/v1/auth/password-reset/request', async (request, reply) => {
    const parsed = PasswordResetRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest();
    if (!options.auth) return serviceUnavailable(request, reply);

    try {
      await options.auth.requestPasswordReset(parsed.data.email);
    } catch (error) {
      if (error instanceof EmailDeliveryDeferredError) {
        logDeferredEmailFailure(request, 'Password reset');
      } else if (error instanceof AuthOperationUnavailableError) {
        return serviceUnavailable(request, reply);
      } else {
        throw error;
      }
    }

    return cachePrivate(reply).code(202).send({
      status: 'accepted',
      message: 'If an active account uses this address, a password reset link will be sent. Check your inbox and spam folder.',
    });
  });

  server.post('/api/v1/auth/password-reset/complete', async (request, reply) => {
    const parsed = PasswordResetCompleteSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest();
    if (!options.auth) return serviceUnavailable(request, reply);

    await options.auth.completePasswordReset(parsed.data.token, parsed.data.password);
    // Every session was revoked, including any on this browser.
    clearSessionCookie(reply, options.secureCookies);
    const body: PasswordResetCompleted = {
      status: 'password_reset',
      message: 'Your password has been reset and every device was signed out. Sign in with your new password.',
    };
    return cachePrivate(reply).send(body);
  });

  server.post('/api/v1/auth/password', async (request, reply) => {
    if (!options.auth) return serviceUnavailable(request, reply);
    const token = readSessionToken(request);
    if (!token) throw unauthenticated();
    const parsed = PasswordChangeRequestSchema.safeParse(request.body);
    if (!parsed.success) throw invalidRequest();

    const revokedSessions = await options.auth.changePassword(
      token,
      parsed.data.currentPassword,
      parsed.data.newPassword,
    );
    const body: PasswordChanged = { status: 'password_changed', revokedSessions };
    return cachePrivate(reply).send(body);
  });

  server.get('/api/v1/auth/sessions', async (request, reply) => {
    if (!options.auth) return serviceUnavailable(request, reply);
    const token = readSessionToken(request);
    if (!token) throw unauthenticated();

    const sessions = await options.auth.listSessions(token);
    const body: AccountSessions = { sessions: sessions.map(toAccountSession) };
    return cachePrivate(reply).send(body);
  });

  server.post('/api/v1/auth/sessions/revoke-others', async (request, reply) => {
    if (!options.auth) return serviceUnavailable(request, reply);
    const token = readSessionToken(request);
    if (!token) throw unauthenticated();
    if (request.body !== undefined && request.body !== null
      && !(typeof request.body === 'object' && Object.keys(request.body).length === 0)) {
      throw invalidRequest();
    }

    const body: SessionsRevoked = { revokedSessions: await options.auth.revokeOtherSessions(token) };
    return cachePrivate(reply).send(body);
  });

  server.delete('/api/v1/auth/sessions/:sessionId', async (request, reply) => {
    if (!options.auth) return serviceUnavailable(request, reply);
    const token = readSessionToken(request);
    if (!token) throw unauthenticated();
    const params = sessionParamsSchema.safeParse(request.params);
    if (!params.success) throw invalidRequest();

    const revokedSessions = await options.auth.revokeOtherSessions(token, params.data.sessionId);
    if (revokedSessions === 0) {
      throw Object.assign(new Error('Session not found.'), { statusCode: 404 });
    }
    const body: SessionsRevoked = { revokedSessions };
    return cachePrivate(reply).send(body);
  });
}
