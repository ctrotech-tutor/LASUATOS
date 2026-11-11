import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiProblemSchema } from '@lasuatos/contracts';
import { buildServer, type ServerOptions } from '../server.js';
import type { AuthRouteService } from '../auth/routes.js';
import { InvalidLoginError } from '../auth/service.js';
import { MemoryRateLimitStore, RateLimiter } from './rate-limit.js';
import { RATE_LIMIT_POLICIES } from './rate-limit-policies.js';
import { LOG_REDACT_CENSOR, LOG_REDACT_PATHS } from './headers.js';

const servers: ReturnType<typeof buildServer>[] = [];

function createAuth(): AuthRouteService {
  return {
    registerStudent: vi.fn(async () => undefined),
    resendVerification: vi.fn(async () => undefined),
    verifyEmail: vi.fn(async () => { throw new Error('not used'); }),
    login: vi.fn(async () => { throw new InvalidLoginError(); }),
    getSession: vi.fn(async () => null),
    logout: vi.fn(async () => undefined),
    requestPasswordReset: vi.fn(async () => undefined),
    completePasswordReset: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => 0),
    listSessions: vi.fn(async () => []),
    revokeOtherSessions: vi.fn(async () => 0),
  };
}

function createServer(options: Partial<ServerOptions> = {}) {
  const server = buildServer({ logger: false, auth: createAuth(), ...options });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const login = (email: string, headers: Record<string, string> = {}) => ({
  method: 'POST' as const,
  url: '/api/v1/auth/login',
  headers,
  payload: { email, password: 'wrong password' },
});

describe('security headers', () => {
  it('sends a locked-down policy on success and error responses, without HSTS by default', async () => {
    const server = createServer();
    for (const url of ['/api/v1/health', '/api/v1/does-not-exist']) {
      const response = await server.inject({ method: 'GET', url });
      expect(response.headers['content-security-policy']).toContain("default-src 'none'");
      expect(response.headers['content-security-policy']).toContain("frame-ancestors 'none'");
      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['referrer-policy']).toBe('no-referrer');
      expect(response.headers['permissions-policy']).toContain('geolocation=()');
      expect(response.headers['strict-transport-security']).toBeUndefined();
    }
  });

  it('adds HSTS when the deployment is served over HTTPS', async () => {
    const response = await createServer({ hsts: true }).inject({ method: 'GET', url: '/api/v1/health' });
    expect(response.headers['strict-transport-security']).toBe('max-age=31536000; includeSubDomains');
  });
});

describe('cross-origin mutation guard', () => {
  it('blocks cross-site cookie-bearing mutations with a clear problem response', async () => {
    const server = createServer({ trustedOrigins: ['https://attendance.example.edu'] });
    const response = await server.inject(login('a@example.net', {
      'sec-fetch-site': 'cross-site',
      origin: 'https://evil.example',
      cookie: `lasuatos_session=${'t'.repeat(43)}`,
    }));

    expect(response.statusCode).toBe(403);
    const problem = ApiProblemSchema.parse(response.json());
    expect(problem.detail).toContain('did not come from the LASUATOS app');
    expect(response.headers['x-frame-options']).toBe('DENY');
  });

  it('allows the app’s own origin and same-origin fetches', async () => {
    const server = createServer({ trustedOrigins: ['https://attendance.example.edu'] });
    const fromOrigin = await server.inject(login('a@example.net', { origin: 'https://attendance.example.edu' }));
    const sameOrigin = await server.inject(login('a@example.net', { 'sec-fetch-site': 'same-origin' }));
    expect(fromOrigin.statusCode).toBe(401);
    expect(sameOrigin.statusCode).toBe(401);
  });
});

describe('rate limiting', () => {
  it('limits sign-in attempts per email regardless of letter case, with Retry-After', async () => {
    const limit = RATE_LIMIT_POLICIES['POST /api/v1/auth/login']!.find((policy) => policy.subject === 'email')!.limit;
    const server = createServer({ rateLimiter: new RateLimiter({ store: new MemoryRateLimitStore() }) });

    for (let attempt = 0; attempt < limit; attempt += 1) {
      const response = await server.inject(login(attempt % 2 ? 'Amina@Example.net' : ' amina@example.net'));
      expect(response.statusCode).toBe(401);
    }
    const limited = await server.inject(login('amina@example.net'));
    const otherAccount = await server.inject(login('someone.else@example.net'));

    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(ApiProblemSchema.parse(limited.json()).detail).toMatch(/Too many attempts/);
    expect(otherAccount.statusCode).toBe(401);
  });

  it('limits a single address that cycles through many emails', async () => {
    const limit = RATE_LIMIT_POLICIES['POST /api/v1/auth/login']!.find((policy) => policy.subject === 'ip')!.limit;
    const server = createServer({ rateLimiter: new RateLimiter({ store: new MemoryRateLimitStore() }) });
    for (let attempt = 0; attempt < limit; attempt += 1) {
      await server.inject(login(`user${attempt}@example.net`));
    }
    const limited = await server.inject(login('fresh@example.net'));
    expect(limited.statusCode).toBe(429);
  });

  it('uses the forwarded client address only from a trusted proxy', async () => {
    const limit = RATE_LIMIT_POLICIES['POST /api/v1/auth/login']!.find((policy) => policy.subject === 'ip')!.limit;
    const server = createServer({
      trustProxy: ['127.0.0.1'],
      rateLimiter: new RateLimiter({ store: new MemoryRateLimitStore() }),
    });
    for (let attempt = 0; attempt < limit; attempt += 1) {
      await server.inject({ ...login(`user${attempt}@example.net`, { 'x-forwarded-for': '203.0.113.7' }) });
    }
    const sameClient = await server.inject(login('next@example.net', { 'x-forwarded-for': '203.0.113.7' }));
    const differentClient = await server.inject(login('next@example.net', { 'x-forwarded-for': '198.51.100.9' }));
    expect(sameClient.statusCode).toBe(429);
    expect(differentClient.statusCode).toBe(401);
  });

  it('limits check-in per session rather than per shared campus address', async () => {
    const policy = RATE_LIMIT_POLICIES['POST /api/v1/student/attendance/check-in']!;
    expect(policy.map((limit) => limit.subject)).toEqual(['session']);
    const server = createServer({ rateLimiter: new RateLimiter({ store: new MemoryRateLimitStore() }) });
    const checkIn = (token: string) => server.inject({
      method: 'POST',
      url: '/api/v1/student/attendance/check-in',
      headers: { cookie: `lasuatos_session=${token}` },
      payload: { code: 'ABC234' },
    });
    for (let attempt = 0; attempt < policy[0]!.limit; attempt += 1) await checkIn('a'.repeat(43));
    expect((await checkIn('a'.repeat(43))).statusCode).toBe(429);
    expect((await checkIn('b'.repeat(43))).statusCode).not.toBe(429);
  });

  it('does not count unrelated routes', async () => {
    const store = new MemoryRateLimitStore();
    const hit = vi.spyOn(store, 'hit');
    const server = createServer({ rateLimiter: new RateLimiter({ store }) });
    await server.inject({ method: 'GET', url: '/api/v1/health' });
    await server.inject({ method: 'GET', url: '/api/v1/auth/session' });
    expect(hit).not.toHaveBeenCalled();
  });
});

describe('log redaction', () => {
  it('accepts the shared redact list and censors password fields and cookies', async () => {
    const lines: string[] = [];
    const stream = new Writable({ write(chunk, _encoding, callback) { lines.push(String(chunk)); callback(); } });
    const server = buildServer({
      auth: createAuth(),
      logger: { level: 'info', stream, redact: { paths: [...LOG_REDACT_PATHS], censor: LOG_REDACT_CENSOR } },
    });
    servers.push(server);
    server.addHook('preHandler', async (request) => {
      request.log.info({ req: { body: request.body, headers: request.headers } }, 'probe');
    });
    await server.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: { cookie: `lasuatos_session=${'x'.repeat(43)}` },
      payload: { currentPassword: 'secret-current-1', newPassword: 'secret-new-12345' },
    });
    const output = lines.join('');
    expect(output).toContain('probe');
    expect(output).not.toContain('secret-current-1');
    expect(output).not.toContain('secret-new-12345');
    expect(output).not.toContain('x'.repeat(43));
  });

  it('builds with the default logger configuration', async () => {
    const server = buildServer();
    servers.push(server);
    await expect(server.ready()).resolves.toBeDefined();
  });
});
