import type { FastifyInstance, FastifyRequest } from 'fastify';
import { readSessionToken } from '../attendance/route-helpers.js';
import type { RateLimiter, RateLimitRule } from './rate-limit.js';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Subject = 'ip' | 'email' | 'session';

interface PolicyLimit {
  readonly subject: Subject;
  readonly limit: number;
  readonly windowMilliseconds: number;
}

/**
 * Central rate-limit policy, keyed by `METHOD route-template`. Limits are
 * deliberately generous for real use (a lecture of several hundred students
 * shares one campus NAT address, so per-address limits on check-in are left to
 * per-session limits) and tight enough to make guessing, credential stuffing
 * and mail flooding impractical. These are starting values for the pilot, to
 * be tuned from observed traffic, not measured capacity figures.
 */
export const RATE_LIMIT_POLICIES: Readonly<Record<string, readonly PolicyLimit[]>> = {
  'POST /api/v1/auth/login': [
    { subject: 'ip', limit: 30, windowMilliseconds: 15 * MINUTE },
    { subject: 'email', limit: 10, windowMilliseconds: 15 * MINUTE },
  ],
  'POST /api/v1/auth/register': [
    { subject: 'ip', limit: 10, windowMilliseconds: HOUR },
    { subject: 'email', limit: 3, windowMilliseconds: HOUR },
  ],
  'POST /api/v1/auth/resend-verification': [
    { subject: 'ip', limit: 10, windowMilliseconds: HOUR },
    { subject: 'email', limit: 5, windowMilliseconds: HOUR },
  ],
  'POST /api/v1/auth/verify-email': [
    { subject: 'ip', limit: 30, windowMilliseconds: 15 * MINUTE },
  ],
  'POST /api/v1/auth/password-reset/request': [
    { subject: 'ip', limit: 10, windowMilliseconds: HOUR },
    { subject: 'email', limit: 5, windowMilliseconds: HOUR },
  ],
  'POST /api/v1/auth/password-reset/complete': [
    { subject: 'ip', limit: 20, windowMilliseconds: 15 * MINUTE },
  ],
  'POST /api/v1/auth/password': [
    { subject: 'session', limit: 10, windowMilliseconds: HOUR },
    { subject: 'ip', limit: 30, windowMilliseconds: HOUR },
  ],
  'POST /api/v1/auth/sessions/revoke-others': [
    { subject: 'session', limit: 20, windowMilliseconds: HOUR },
  ],
  'DELETE /api/v1/auth/sessions/:sessionId': [
    { subject: 'session', limit: 60, windowMilliseconds: HOUR },
  ],
  'POST /api/v1/enrollments/join': [
    { subject: 'session', limit: 20, windowMilliseconds: 10 * MINUTE },
    { subject: 'ip', limit: 300, windowMilliseconds: 10 * MINUTE },
  ],
  'POST /api/v1/student/attendance/check-in': [
    { subject: 'session', limit: 30, windowMilliseconds: 5 * MINUTE },
  ],
  'POST /api/v1/student/attendance/disputes': [
    { subject: 'session', limit: 20, windowMilliseconds: HOUR },
  ],
};

export class RateLimitedError extends Error {
  readonly statusCode = 429;
  readonly exposeDetail = true;
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    const minutes = Math.ceil(retryAfterSeconds / 60);
    super(retryAfterSeconds < 60
      ? 'Too many attempts. Wait a minute and try again.'
      : `Too many attempts. Wait about ${minutes} minute${minutes === 1 ? '' : 's'} and try again.`);
    this.name = 'RateLimitedError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function normalizedEmail(body: unknown): string | null {
  if (!body || typeof body !== 'object' || !('email' in body) || typeof body.email !== 'string') return null;
  const email = body.email.trim().toLowerCase();
  return email.length > 0 && email.length <= 320 ? email : null;
}

/** Builds the concrete rules for one request; subjects that are absent are skipped. */
export function rulesForRequest(request: FastifyRequest, policyKey: string): RateLimitRule[] {
  const policy = RATE_LIMIT_POLICIES[policyKey];
  if (!policy) return [];
  const rules: RateLimitRule[] = [];
  for (const limit of policy) {
    const subject = limit.subject === 'ip'
      ? request.ip
      : limit.subject === 'email'
        ? normalizedEmail(request.body)
        : readSessionToken(request) ?? null;
    if (!subject) continue;
    rules.push({
      name: `${policyKey}:${limit.subject}`,
      subject,
      limit: limit.limit,
      windowMilliseconds: limit.windowMilliseconds,
    });
  }
  return rules;
}

/**
 * Enforces the policy table before route handlers run (after body parsing so
 * email-keyed limits can apply). Requests are counted whether or not they
 * succeed, so a burst of failures cannot be hidden behind later successes.
 */
export function registerRateLimiting(server: FastifyInstance, limiter: RateLimiter): void {
  server.addHook('preHandler', async (request, reply) => {
    const route = request.routeOptions.url;
    if (!route) return;
    const policyKey = `${request.method} ${route}`;
    if (!RATE_LIMIT_POLICIES[policyKey]) return;
    const decision = await limiter.consume(rulesForRequest(request, policyKey));
    if (decision.allowed) return;
    request.log.warn({ rule: decision.rule, requestId: request.id }, 'Request rate limited');
    reply.header('retry-after', String(decision.retryAfterSeconds));
    throw new RateLimitedError(decision.retryAfterSeconds);
  });
}
