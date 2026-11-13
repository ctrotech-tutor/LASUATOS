import type { InjectOptions } from 'fastify';
import { createApiApplication, type ApiApplication } from './app.js';
import { loadEnvironment } from './env.js';
import { within } from './monitoring/alerts.js';

/**
 * Runs the Fastify API inside a Web-standard request handler, so the Next.js
 * app can serve `/api/v1/*` itself from one serverless deployment (Vercel).
 * The same routes, validation, rate limits, origin checks and security headers
 * apply as in the standalone server; requests are dispatched with
 * `server.inject`, so no port is opened.
 */

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);
// Hop-by-hop and length headers are recomputed by Fastify and the platform.
const DROPPED_REQUEST_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'upgrade', 'content-length']);
const DROPPED_RESPONSE_HEADERS = new Set(['connection', 'keep-alive', 'transfer-encoding', 'content-length']);

type HttpMethod = NonNullable<InjectOptions['method']>;

const globalStore = globalThis as typeof globalThis & {
  __lasuatosApi?: Promise<ApiApplication> | undefined;
};

/** One application (and connection pool) per warm function instance. */
function application(): Promise<ApiApplication> {
  globalStore.__lasuatosApi ??= (async () => {
    const app = createApiApplication(loadEnvironment(), { serverless: true });
    await app.server.ready();
    // Once per cold start: tell the operator if the database is missing updates
    // (one quick query when it is up to date; never holds the request for long).
    await within(app.checkSchemaAndAlert().catch(() => undefined), 2_500);
    return app;
  })().catch((error: unknown) => {
    globalStore.__lasuatosApi = undefined;
    throw error;
  });
  return globalStore.__lasuatosApi;
}

/**
 * The client address for rate limiting. Vercel sets `x-real-ip` and overwrites
 * `x-forwarded-for` with the real client address, so they cannot be spoofed
 * there. Other hosts must not use embedded mode unless their edge does the same.
 */
export function clientAddress(headers: Headers): string {
  const realIp = headers.get('x-real-ip')?.trim();
  if (realIp) return realIp;
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  return forwarded || '127.0.0.1';
}

export async function handleApiRequest(request: Request): Promise<Response> {
  const app = await application();
  const url = new URL(request.url);
  const method = request.method.toUpperCase() as HttpMethod;

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    if (!DROPPED_REQUEST_HEADERS.has(key)) headers[key] = value;
  });

  const response = await app.server.inject({
    method,
    url: `${url.pathname}${url.search}`,
    headers,
    remoteAddress: clientAddress(request.headers),
    ...(BODYLESS_METHODS.has(method) ? {} : { payload: Buffer.from(await request.arrayBuffer()) }),
  });

  const responseHeaders = new Headers();
  for (const [key, value] of Object.entries(response.headers)) {
    if (value === undefined || DROPPED_RESPONSE_HEADERS.has(key.toLowerCase())) continue;
    for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(key, String(item));
  }
  const noBody = method === 'HEAD' || response.statusCode === 204 || response.statusCode === 304;
  return new Response(noBody ? null : new Uint8Array(response.rawPayload), {
    status: response.statusCode,
    headers: responseHeaders,
  });
}
