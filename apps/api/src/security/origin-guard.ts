import type { FastifyInstance, FastifyRequest } from 'fastify';

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export class CrossOriginRequestError extends Error {
  readonly statusCode = 403;
  readonly exposeDetail = true;

  constructor() {
    super('This request was blocked because it did not come from the LASUATOS app. Reload the page and try again.');
    this.name = 'CrossOriginRequestError';
  }
}

/** Normalizes configured origins (scheme://host[:port]) and drops invalid ones. */
export function normalizeOrigins(values: readonly string[]): Set<string> {
  const origins = new Set<string>();
  for (const value of values) {
    try {
      const url = new URL(value.trim());
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
    } catch {
      // Ignore malformed entries; configuration validation reports them.
    }
  }
  return origins;
}

export type OriginDecision = 'allow' | 'block';

/**
 * Cross-site request forgery defence for cookie-authenticated mutations,
 * following the Fetch Metadata and Origin-verification approach:
 *
 * 1. `Sec-Fetch-Site: same-origin` or `none` (typed URL, bookmark) → allow.
 *    `cross-site` → block, whatever the Origin says.
 * 2. Otherwise (`same-site`, or an older browser without Fetch Metadata), an
 *    `Origin` header must match a trusted origin exactly; `Origin: null` blocks.
 * 3. With neither header the request is not from a modern browser context
 *    (for example curl or a server-side client); it carries no ambient browser
 *    credentials to forge, so it is allowed.
 *
 * Safe methods (GET/HEAD/OPTIONS) are never blocked; they must not change state.
 */
export function evaluateOrigin(
  request: Pick<FastifyRequest, 'method' | 'headers'>,
  trustedOrigins: ReadonlySet<string>,
): OriginDecision {
  if (!UNSAFE_METHODS.has(request.method)) return 'allow';
  const site = headerValue(request.headers['sec-fetch-site']);
  if (site === 'same-origin' || site === 'none') return 'allow';
  if (site === 'cross-site') return 'block';

  const origin = headerValue(request.headers.origin);
  if (origin === undefined) return site === 'same-site' ? 'block' : 'allow';
  return trustedOrigins.has(origin) ? 'allow' : 'block';
}

function headerValue(value: string | string[] | undefined): string | undefined {
  const single = Array.isArray(value) ? value[0] : value;
  const trimmed = single?.trim().toLowerCase();
  return trimmed ? trimmed : undefined;
}

export function registerOriginGuard(server: FastifyInstance, trustedOrigins: ReadonlySet<string>): void {
  server.addHook('onRequest', async (request) => {
    if (!request.url.startsWith('/api/')) return;
    if (evaluateOrigin(request, trustedOrigins) === 'allow') return;
    request.log.warn({ requestId: request.id, secFetchSite: request.headers['sec-fetch-site'] ?? null }, 'Cross-origin mutation blocked');
    throw new CrossOriginRequestError();
  });
}
