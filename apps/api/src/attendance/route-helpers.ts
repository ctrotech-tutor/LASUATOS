import type { ApiProblem } from '@lasuatos/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

const COOKIE_NAME = 'lasuatos_session';
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

export function readSessionToken(request: FastifyRequest): string | undefined {
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

export function unavailable(request: FastifyRequest, reply: FastifyReply): FastifyReply {
  const problem: ApiProblem = {
    type: 'about:blank',
    title: 'Service unavailable',
    status: 503,
    detail: 'The request could not be processed.',
    instance: request.routeOptions.url ?? '/unknown',
    requestId: request.id,
  };
  return reply.header('cache-control', 'no-store')
    .code(503)
    .type('application/problem+json')
    .send(problem);
}

export function notAuthenticated(): Error {
  return Object.assign(new Error('Authentication is required.'), { statusCode: 401 });
}

export function wrongAccountType(): Error {
  return Object.assign(new Error('This account cannot perform the requested action.'), { statusCode: 403 });
}

export function invalidRequest(): Error {
  return Object.assign(new Error('Invalid request.'), { statusCode: 400 });
}
