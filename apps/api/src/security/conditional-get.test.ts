import { afterEach, describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { buildServer } from '../server.js';
import { etagOf, matchesIfNoneMatch, registerConditionalGet } from './conditional-get.js';

const servers: { close(): Promise<unknown> }[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function tiny() {
  const server = Fastify({ logger: false });
  servers.push(server);
  registerConditionalGet(server);
  let roster = ['Ada', 'Bola'];
  server.get('/roster', async () => ({ roster }));
  server.post('/roster', async () => {
    roster = [...roster, 'Chidi'];
    return { roster };
  });
  server.get('/csv', async (_request, reply) => reply.type('text/csv').send('a,b\n'));
  server.get('/missing', async (_request, reply) => reply.code(404).send({ title: 'Not found' }));
  return server;
}

describe('conditional GETs', () => {
  it('tags JSON answers and answers 304 with no body when nothing changed', async () => {
    const server = tiny();
    const first = await server.inject({ method: 'GET', url: '/roster' });
    expect(first.statusCode).toBe(200);
    const tag = first.headers.etag as string;
    expect(tag).toMatch(/^W\/"[A-Za-z0-9_-]{27}"$/);
    expect(tag).toBe(etagOf(first.body));

    const again = await server.inject({ method: 'GET', url: '/roster', headers: { 'if-none-match': tag } });
    expect(again.statusCode).toBe(304);
    expect(again.body).toBe('');
    expect(again.headers['content-type']).toBeUndefined();
    expect(again.headers.etag).toBe(tag);

    // A change gives a new tag and the full body again.
    await server.inject({ method: 'POST', url: '/roster' });
    const changed = await server.inject({ method: 'GET', url: '/roster', headers: { 'if-none-match': tag } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ roster: ['Ada', 'Bola', 'Chidi'] });
    expect(changed.headers.etag).not.toBe(tag);
  });

  it('leaves writes, errors and non-JSON alone', async () => {
    const server = tiny();
    const post = await server.inject({ method: 'POST', url: '/roster', headers: { 'if-none-match': '*' } });
    expect(post.statusCode).toBe(200);
    expect(post.headers.etag).toBeUndefined();
    const missing = await server.inject({ method: 'GET', url: '/missing', headers: { 'if-none-match': '*' } });
    expect(missing.statusCode).toBe(404);
    expect(missing.headers.etag).toBeUndefined();
    const csv = await server.inject({ method: 'GET', url: '/csv' });
    expect(csv.headers.etag).toBeUndefined();
  });

  it('compares weakly and accepts a list of tags', () => {
    const tag = 'W/"abc"';
    expect(matchesIfNoneMatch('"abc"', tag)).toBe(true);
    expect(matchesIfNoneMatch('W/"zzz", W/"abc"', tag)).toBe(true);
    expect(matchesIfNoneMatch('*', tag)).toBe(true);
    expect(matchesIfNoneMatch('W/"abd"', tag)).toBe(false);
    expect(matchesIfNoneMatch(undefined, tag)).toBe(false);
  });

  it('is on for the real API (readiness answers 304 to its own tag, still no-store)', async () => {
    const server = buildServer({ logger: false, checkDatabase: async () => undefined });
    servers.push(server);
    const first = await server.inject({ method: 'GET', url: '/api/v1/ready' });
    expect(first.statusCode).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const again = await server.inject({ method: 'GET', url: '/api/v1/ready', headers: { 'if-none-match': first.headers.etag as string } });
    expect(again.statusCode).toBe(304);
    expect(again.headers['cache-control']).toBe('no-store');
  });
});
