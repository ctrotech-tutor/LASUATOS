import { NextRequest } from 'next/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxy } from './proxy';
import { safeNextPath, workspacePath } from './lib/workspace';

const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde';

function request(path: string, cookie = `lasuatos_session=${TOKEN}`): NextRequest {
  return new NextRequest(new URL(path, 'https://lasuatos.example'), { headers: cookie ? { cookie } : {} });
}

function sessionReply(status: number, accountType?: string) {
  const body = accountType ? { status: 'authenticated', account: { accountType } } : { title: 'nope' };
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('safeNextPath', () => {
  it('keeps same-site paths', () => {
    expect(safeNextPath('/class-list')).toBe('/class-list');
    expect(safeNextPath('/sessions?tab=registers#top')).toBe('/sessions?tab=registers#top');
  });

  it('refuses other sites and tricks', () => {
    for (const value of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/a\\b', 'class-list', `/${'x'.repeat(300)}`, '/a\nb']) {
      expect(safeNextPath(value)).toBeNull();
    }
  });

  it('refuses the signed-out pages, so a signed-in visitor cannot loop', () => {
    for (const value of ['/sign-in', '/sign-up/', '/SIGN-IN?next=/x', '/forgot-password', '/reset-password#token=x', '/verify-email', '/accept-invitation']) {
      expect(safeNextPath(value)).toBeNull();
    }
  });
});

describe('workspacePath', () => {
  it('sends each account home', () => {
    expect(workspacePath('student')).toBe('/attendance');
    expect(workspacePath('lecturer')).toBe('/sessions');
    expect(workspacePath('administrator')).toBe('/admin');
  });
});

describe('proxy', () => {
  it('lets visitors without a session cookie through without asking the server', async () => {
    const fetchMock = sessionReply(200, 'student');
    vi.stubGlobal('fetch', fetchMock);
    const response = await proxy(request('/sign-in', ''));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('redirects a signed-in visitor from sign in to their workspace', async () => {
    const fetchMock = sessionReply(200, 'lecturer');
    vi.stubGlobal('fetch', fetchMock);
    const response = await proxy(request('/sign-in'));
    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('https://lasuatos.example/sessions');
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe('https://lasuatos.example/api/v1/auth/session');
    expect((init.headers as Record<string, string>).cookie).toBe(`lasuatos_session=${TOKEN}`);
  });

  it('honours a safe next path and ignores an unsafe one', async () => {
    vi.stubGlobal('fetch', sessionReply(200, 'student'));
    const safe = await proxy(request('/sign-up?next=%2Fcheck-in'));
    expect(safe.headers.get('location')).toBe('https://lasuatos.example/check-in');
    const unsafe = await proxy(request('/sign-in?next=%2F%2Fevil.example'));
    expect(unsafe.headers.get('location')).toBe('https://lasuatos.example/attendance');
  });

  it('shows the signed-in password help at /forgot-password without changing the address', async () => {
    vi.stubGlobal('fetch', sessionReply(200, 'administrator'));
    const response = await proxy(request('/forgot-password'));
    expect(response.headers.get('x-middleware-rewrite')).toBe('https://lasuatos.example/forgot-password/signed-in');
  });

  it('serves the form and drops a stale cookie when the session has ended', async () => {
    vi.stubGlobal('fetch', sessionReply(401));
    const response = await proxy(request('/sign-in'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
    expect(response.headers.get('set-cookie')).toMatch(/lasuatos_session=;/);
  });

  it('never treats a server problem as signed out: the page is served and the cookie kept', async () => {
    vi.stubGlobal('fetch', sessionReply(503));
    const busy = await proxy(request('/sign-in'));
    expect(busy.headers.get('x-middleware-next')).toBe('1');
    expect(busy.headers.get('set-cookie')).toBeNull();

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const offline = await proxy(request('/sign-up'));
    expect(offline.headers.get('x-middleware-next')).toBe('1');
  });

  it('does not trust a reply that is not an authenticated session', async () => {
    vi.stubGlobal('fetch', sessionReply(200, 'superuser'));
    const response = await proxy(request('/sign-in'));
    expect(response.headers.get('x-middleware-next')).toBe('1');
  });
});
