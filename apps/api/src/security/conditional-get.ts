import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/**
 * Conditional GETs: every JSON answer to a GET carries a weak ETag (a hash of the body), and a
 * request that sends the same tag back in If-None-Match gets `304 Not Modified` with no body.
 *
 * Live screens poll (the register every few seconds while a class is open, the disputes list,
 * the face-check queue): a poll where nothing changed then costs a few hundred bytes instead
 * of the whole register, which matters on students' and lecturers' mobile data. The browser
 * never stores these answers (`cache-control: no-store` stays); the web app keeps its own last
 * answer per URL in memory and sends the tag itself.
 *
 * The tag is derived from the bytes the account would receive, so it can only match the same
 * account's own previous answer; it reveals nothing the body would not.
 */
export function etagOf(body: string | Buffer): string {
  return `W/"${createHash('sha256').update(body).digest('base64url').slice(0, 27)}"`;
}

/** True when an If-None-Match header lists `tag` (or `*`). Weak comparison, as RFC 9110 asks for GET. */
export function matchesIfNoneMatch(header: string | undefined, tag: string): boolean {
  if (!header) return false;
  const bare = tag.replace(/^W\//, '');
  return header.split(',').some((part) => {
    const candidate = part.trim();
    return candidate === '*' || candidate.replace(/^W\//, '') === bare;
  });
}

export function registerConditionalGet(server: FastifyInstance): void {
  server.addHook('onSend', async (request, reply, payload) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return payload;
    if (reply.statusCode !== 200) return payload;
    if (typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
    const type = String(reply.getHeader('content-type') ?? '');
    if (!type.includes('json')) return payload;
    const tag = etagOf(payload);
    reply.header('etag', tag);
    if (!matchesIfNoneMatch(request.headers['if-none-match'], tag)) return payload;
    reply.code(304);
    reply.removeHeader('content-type');
    reply.removeHeader('content-length');
    return '';
  });
}
