import { afterEach, describe, expect, it } from 'vitest';
import { ApiHealthSchema, ApiProblemSchema, ApiReadinessSchema } from '@lasuatos/contracts';
import { buildServer } from './server.js';

const servers: ReturnType<typeof buildServer>[] = [];

function createServer(options?: Parameters<typeof buildServer>[0]) {
  const server = buildServer({ logger: false, ...options });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('API health routes', () => {
  it('reports liveness without exposing environment or database details', async () => {
    const server = createServer();
    const response = await server.inject({ method: 'GET', url: '/api/v1/health' });

    expect(response.statusCode).toBe(200);
    expect(ApiHealthSchema.safeParse(response.json()).success).toBe(true);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('reports not ready when PostgreSQL is not configured', async () => {
    const server = createServer();
    const response = await server.inject({ method: 'GET', url: '/api/v1/ready' });

    expect(response.statusCode).toBe(503);
    expect(ApiReadinessSchema.parse(response.json())).toEqual({
      status: 'not_ready',
      checks: { database: 'not_configured' },
    });
  });

  it('reports ready only after the database health check succeeds', async () => {
    const server = createServer({ checkDatabase: async () => undefined });
    const response = await server.inject({ method: 'GET', url: '/api/v1/ready' });

    expect(response.statusCode).toBe(200);
    expect(ApiReadinessSchema.parse(response.json())).toEqual({
      status: 'ready',
      checks: { database: 'up' },
    });
  });

  it('does not leak database errors through the readiness response', async () => {
    const server = createServer({
      checkDatabase: async () => {
        throw new Error('sensitive connection detail');
      },
    });
    const response = await server.inject({ method: 'GET', url: '/api/v1/ready' });

    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain('sensitive connection detail');
    expect(ApiReadinessSchema.parse(response.json())).toEqual({
      status: 'not_ready',
      checks: { database: 'down' },
    });
  });

  it('returns a typed problem response for client errors', async () => {
    const server = createServer();
    server.get('/test/bad-request', async () => {
      throw Object.assign(new Error('The submitted value is invalid.'), { statusCode: 400 });
    });
    const response = await server.inject({ method: 'GET', url: '/test/bad-request' });
    const problem = ApiProblemSchema.parse(response.json());

    expect(response.statusCode).toBe(400);
    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).not.toContain('The submitted value is invalid.');
    expect(problem).toMatchObject({
      type: 'about:blank',
      title: 'Bad request',
      status: 400,
      detail: 'The request is invalid.',
    });
    expect(problem.requestId).toBeTruthy();
  });

  it('hides unexpected server errors from clients', async () => {
    const server = createServer();
    server.get('/test/server-error', async () => {
      throw new Error('private internal detail');
    });
    const response = await server.inject({ method: 'GET', url: '/test/server-error' });
    const problem = ApiProblemSchema.parse(response.json());

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('private internal detail');
    expect(problem.detail).toBeUndefined();
    expect(problem.title).toBe('Internal server error');
  });
});
