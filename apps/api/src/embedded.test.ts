import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { clientAddress, handleApiRequest } from './embedded.js';

describe('embedded API client address', () => {
  it('prefers the platform-set x-real-ip, then the first forwarded hop', () => {
    expect(clientAddress(new Headers({ 'x-real-ip': '203.0.113.9', 'x-forwarded-for': '198.51.100.1' }))).toBe('203.0.113.9');
    expect(clientAddress(new Headers({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }))).toBe('198.51.100.1');
    expect(clientAddress(new Headers())).toBe('127.0.0.1');
  });
});

describe('embedded API request handling', () => {
  beforeAll(() => {
    // No database: only the health and readiness routes exist, which is enough to exercise the adapter.
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('LOG_LEVEL', 'silent');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('translates Web requests to the Fastify app and back, with API security headers', async () => {
    const response = await handleApiRequest(new Request('https://app.example.edu/api/v1/health?probe=1'));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ status: 'ok', service: 'lasuatos-api' });
  });

  it('reports readiness honestly and sends no body for HEAD', async () => {
    const ready = await handleApiRequest(new Request('https://app.example.edu/api/v1/ready'));
    expect(ready.status).toBe(503);
    expect(await ready.json()).toMatchObject({ checks: { database: 'not_configured' } });

    const head = await handleApiRequest(new Request('https://app.example.edu/api/v1/health', { method: 'HEAD' }));
    expect(head.status).toBe(200);
    expect(await head.text()).toBe('');
  });

  it('passes request bodies through and keeps unknown routes as 404', async () => {
    const response = await handleApiRequest(new Request('https://app.example.edu/api/v1/not-a-route', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hello: 'world' }),
    }));
    expect(response.status).toBe(404);
  });
});
