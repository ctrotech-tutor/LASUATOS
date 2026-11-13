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
  // A whole class signs in or signs up from one campus Wi-Fi address, so the
  // per-address limits are sized for a lecture hall; per-email limits stop guessing.
  'POST /api/v1/auth/login': [
    { subject: 'ip', limit: 300, windowMilliseconds: 15 * MINUTE },
    { subject: 'email', limit: 10, windowMilliseconds: 15 * MINUTE },
  ],
  'POST /api/v1/auth/register': [
    { subject: 'ip', limit: 200, windowMilliseconds: HOUR },
    { subject: 'email', limit: 5, windowMilliseconds: HOUR },
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
  // Correcting your own name or matric number. The matric change also checks
  // the current password, so the address limit bounds password guessing.
  'POST /api/v1/auth/profile': [
    { subject: 'session', limit: 20, windowMilliseconds: HOUR },
    { subject: 'ip', limit: 60, windowMilliseconds: HOUR },
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
  'POST /api/v1/student/profile/entry-level': [
    { subject: 'session', limit: 20, windowMilliseconds: HOUR },
  ],
  'POST /api/v1/student/profile/department': [
    { subject: 'session', limit: 20, windowMilliseconds: HOUR },
  ],
  'POST /api/v1/student/attendance/disputes': [
    { subject: 'session', limit: 20, windowMilliseconds: HOUR },
  ],
  // Staff provisioning (Phase 11). Invitation links are 256-bit tokens, so
  // these limits bound noise and email volume rather than guessing.
  'POST /api/v1/admin/staff/invitations': [
    { subject: 'session', limit: 30, windowMilliseconds: HOUR },
  ],
  'POST /api/v1/admin/staff/invitations/:invitationId/resend': [
    { subject: 'session', limit: 30, windowMilliseconds: HOUR },
  ],
  // Academic structure edits: generous, but bound accidental loops and noise in the audit trail.
  'POST /api/v1/admin/structure/faculties': [{ subject: 'session', limit: 60, windowMilliseconds: HOUR }],
  'POST /api/v1/admin/structure/faculties/:facultyId': [{ subject: 'session', limit: 120, windowMilliseconds: HOUR }],
  'POST /api/v1/admin/structure/departments': [{ subject: 'session', limit: 120, windowMilliseconds: HOUR }],
  'POST /api/v1/admin/structure/departments/:departmentId': [{ subject: 'session', limit: 240, windowMilliseconds: HOUR }],
  'POST /api/v1/admin/structure/academic-sessions': [{ subject: 'session', limit: 30, windowMilliseconds: HOUR }],
  'POST /api/v1/admin/structure/academic-sessions/:sessionId/current': [{ subject: 'session', limit: 30, windowMilliseconds: HOUR }],
  'POST /api/v1/admin/structure/academic-sessions/:sessionId': [{ subject: 'session', limit: 60, windowMilliseconds: HOUR }],
  // Venue, building, staff and course corrections (all audited or owner-scoped).
  'POST /api/v1/admin/buildings/:buildingId': [{ subject: 'session', limit: 120, windowMilliseconds: HOUR }],
  'POST /api/v1/admin/venues/:venueId': [{ subject: 'session', limit: 240, windowMilliseconds: HOUR }],
  'POST /api/v1/admin/staff/members/:userId': [{ subject: 'session', limit: 120, windowMilliseconds: HOUR }],
  'POST /api/v1/lecturer/course-offerings/:courseOfferingId': [{ subject: 'session', limit: 120, windowMilliseconds: HOUR }],
  // Lecture sessions. Public check-in comes from a whole hall on one campus
  // address, so per-address limits are large; codes are long enough that
  // guessing at these rates is impractical.
  'POST /api/v1/lecture/resolve': [{ subject: 'ip', limit: 3000, windowMilliseconds: 10 * MINUTE }],
  'POST /api/v1/lecture/check-in': [{ subject: 'ip', limit: 3000, windowMilliseconds: 10 * MINUTE }],
  'POST /api/v1/lecture/sessions': [{ subject: 'session', limit: 60, windowMilliseconds: HOUR }],
  'POST /api/v1/lecture/sessions/:sessionId': [{ subject: 'session', limit: 240, windowMilliseconds: HOUR }],
  'POST /api/v1/lecture/sessions/:sessionId/attendees': [{ subject: 'session', limit: 600, windowMilliseconds: HOUR }],
  'POST /api/v1/lecture/sessions/:sessionId/attendees/:attendeeId': [{ subject: 'session', limit: 600, windowMilliseconds: HOUR }],
  'POST /api/v1/lecture/sessions/:sessionId/attendees/:attendeeId/details': [{ subject: 'session', limit: 300, windowMilliseconds: HOUR }],
  'POST /api/v1/class-reps/lookup': [{ subject: 'session', limit: 120, windowMilliseconds: HOUR }],
  'POST /api/v1/class-reps': [{ subject: 'session', limit: 60, windowMilliseconds: HOUR }],
  'POST /api/v1/class-reps/:repId/revoke': [{ subject: 'session', limit: 60, windowMilliseconds: HOUR }],
  'POST /api/v1/staff-invitations/preview': [
    { subject: 'ip', limit: 30, windowMilliseconds: 15 * MINUTE },
  ],
  'POST /api/v1/staff-invitations/accept': [
    { subject: 'ip', limit: 20, windowMilliseconds: 15 * MINUTE },
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
