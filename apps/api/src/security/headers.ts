import type { FastifyInstance } from 'fastify';

/**
 * Log paths that must never be written. Shared by the default test logger and
 * the production logger so the two lists cannot drift apart.
 */
export const LOG_REDACT_PATHS: readonly string[] = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'req.body.email',
  'req.body.displayName',
  'req.body.matricNumber',
  'req.body.password',
  'req.body.currentPassword',
  'req.body.newPassword',
  'req.body.token',
  'req.body.code',
  'req.body.location',
  'req.body.statement',
  'req.body.note',
];

export const LOG_REDACT_CENSOR = '[REDACTED]';

/**
 * The API only ever returns JSON (or problem+json), so its policy forbids every
 * active content type and framing. Pages get their own policy from Next.js.
 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
  'cross-origin-opener-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'x-permitted-cross-domain-policies': 'none',
};

export const HSTS_HEADER = 'max-age=31536000; includeSubDomains';

export function registerSecurityHeaders(server: FastifyInstance, options: { readonly hsts: boolean }): void {
  server.addHook('onSend', async (_request, reply, payload) => {
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      if (!reply.hasHeader(name)) reply.header(name, value);
    }
    if (options.hsts) reply.header('strict-transport-security', HSTS_HEADER);
    reply.removeHeader('x-powered-by');
    return payload;
  });
}
