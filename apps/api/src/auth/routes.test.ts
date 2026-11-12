import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountSessionsSchema, AuthenticatedSessionSchema, ApiProblemSchema } from '@lasuatos/contracts';
import { buildServer } from '../server.js';
import { EmailDeliveryDeferredError, InvalidLoginError } from './service.js';
import type { AuthRouteService } from './routes.js';
import type {
  AdministratorSessionAccount,
  LecturerSessionAccount,
  StudentSessionAccount,
} from './repository.js';

const sessionToken = 't'.repeat(43);
const student: StudentSessionAccount = {
  accountType: 'student',
  id: '3c4ad7b8-377d-4ea9-a7bf-f7db874f388c',
  email: 'amina@example.net',
  displayName: 'Amina Student',
  matricNumber: '00012345',
  matricNumberVerified: false,
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
};

const lecturer: LecturerSessionAccount = {
  accountType: 'lecturer',
  id: '9888b9df-8921-4f55-b3f9-8c5ddf18ac05',
  email: 'lecturer@example.net',
  displayName: 'Example Lecturer',
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
};
const administrator: AdministratorSessionAccount = {
  accountType: 'administrator',
  id: '33c7c76b-59a6-453d-b5a8-45ba1c985999',
  email: 'admin@example.net',
  displayName: 'Engineering Administrator',
  emailVerified: true,
  institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
  institutionName: 'Lagos State University',
  role: 'department_administrator',
  scope: {
    type: 'department',
    id: '45080b73-21f3-4d38-85df-b9b2a45d0134',
    label: 'Electrical and Electronics Engineering',
    facultyName: 'Faculty of Engineering',
    institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
  },
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
};

const servers: ReturnType<typeof buildServer>[] = [];

function createAuth(
  account: StudentSessionAccount | LecturerSessionAccount | AdministratorSessionAccount = student,
): AuthRouteService {
  return {
    registerStudent: vi.fn(async () => undefined),
    resendVerification: vi.fn(async () => undefined),
    verifyEmail: vi.fn(async () => ({ token: sessionToken, student })),
    login: vi.fn(async () => ({ token: sessionToken, account })),
    getSession: vi.fn(async () => account),
    logout: vi.fn(async () => undefined),
    requestPasswordReset: vi.fn(async () => undefined),
    completePasswordReset: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => 0),
    listSessions: vi.fn(async () => []),
    revokeOtherSessions: vi.fn(async () => 0),
  };
}

function createServer(auth?: AuthRouteService, secureCookies = false) {
  const server = buildServer({ logger: false, ...(auth ? { auth } : {}), secureCookies });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('student account routes', () => {
  it('does not create accounts when database-backed authentication is unavailable', async () => {
    const server = createServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        displayName: 'Amina Student',
        email: 'amina@example.net',
        matricNumber: '00012345',
        password: 'a sufficiently long password',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(ApiProblemSchema.parse(response.json()).status).toBe(503);
  });

  it('accepts a non-school email while refusing public role assignment', async () => {
    const auth = createAuth();
    const server = createServer(auth);
    const rejected = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        displayName: 'Amina Student',
        email: 'amina@example.net',
        matricNumber: '00012345',
        password: 'a sufficiently long password',
        role: 'system_administrator',
      },
    });
    const accepted = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        displayName: '  Amina Student  ',
        email: '  Amina@Example.NET  ',
        matricNumber: '  00012345  ',
        password: 'a sufficiently long password',
      },
    });

    expect(rejected.statusCode).toBe(400);
    expect(auth.registerStudent).toHaveBeenCalledTimes(1);
    expect(auth.registerStudent).toHaveBeenCalledWith({
      displayName: 'Amina Student',
      email: 'amina@example.net',
      matricNumber: '00012345',
      password: 'a sufficiently long password',
    });
    expect(accepted.statusCode).toBe(202);
    expect(accepted.headers['cache-control']).toBe('no-store');
    expect(accepted.body).not.toContain('amina@example.net');
  });

  it('accepts an optional Direct Entry level and rejects anything else', async () => {
    const auth = createAuth();
    const server = createServer(auth);
    const base = {
      displayName: 'Tunde Student',
      email: 'tunde@example.net',
      matricNumber: '250591002',
      password: 'a sufficiently long password',
    };
    const directEntry = await server.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { ...base, entryLevel: 200 } });
    expect(directEntry.statusCode).toBe(202);
    expect(auth.registerStudent).toHaveBeenCalledWith({ ...base, entryLevel: 200 });

    for (const entryLevel of [400, '200', 0]) {
      const rejected = await server.inject({ method: 'POST', url: '/api/v1/auth/register', payload: { ...base, entryLevel } });
      expect(rejected.statusCode).toBe(400);
    }
    expect(auth.registerStudent).toHaveBeenCalledTimes(1);
  });

  it('keeps delivery failures indistinguishable from duplicate registration', async () => {
    const auth = createAuth();
    vi.mocked(auth.registerStudent).mockRejectedValue(new EmailDeliveryDeferredError());
    const server = createServer(auth);
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        displayName: 'Amina Student',
        email: 'amina@example.net',
        matricNumber: '00012345',
        password: 'a sufficiently long password',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(response.body).not.toContain('delivery');
    expect(response.body).not.toContain('amina@example.net');
  });

  it('sets an HttpOnly secure session cookie after one-time email verification', async () => {
    const auth = createAuth();
    const server = createServer(auth, true);
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token: 'v'.repeat(43) },
    });
    const cookie = String(response.headers['set-cookie']);

    expect(response.statusCode).toBe(200);
    expect(cookie).toContain('lasuatos_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Secure');
    expect(response.body).not.toContain(sessionToken);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json().student.matricNumberVerified).toBe(false);
  });

  it('returns only the authenticated student account from the session route', async () => {
    const auth = createAuth();
    const server = createServer(auth);
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(AuthenticatedSessionSchema.parse(response.json()).account).toMatchObject({
      email: 'amina@example.net',
      accountType: 'student',
      emailVerified: true,
      matricNumber: '00012345',
      matricNumberVerified: false,
    });
    expect(auth.getSession).toHaveBeenCalledWith(sessionToken);
  });

  it('uses a generic response for unaccepted credentials', async () => {
    const auth = createAuth();
    vi.mocked(auth.login).mockRejectedValue(new InvalidLoginError());
    const server = createServer(auth);
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'amina@example.net', password: 'incorrect password' },
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toContain('amina@example.net');
    expect(response.body).not.toContain('incorrect password');
  });

  it('returns a safe lecturer account from login and session lookup', async () => {
    const auth = createAuth(lecturer);
    const server = createServer(auth);
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: lecturer.email, password: 'a sufficiently long password' },
    });
    const session = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });

    expect(login.statusCode).toBe(200);
    expect(AuthenticatedSessionSchema.parse(login.json()).account).toMatchObject({
      accountType: 'lecturer',
      email: lecturer.email,
      displayName: lecturer.displayName,
    });
    expect(login.json().account.matricNumber).toBeUndefined();
    expect(String(login.headers['set-cookie'])).toContain('HttpOnly');
    expect(AuthenticatedSessionSchema.parse(session.json()).account.accountType).toBe('lecturer');
  });

  it('returns an administrator account with its server-assigned scope', async () => {
    const server = createServer(createAuth(administrator));
    const login = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: administrator.email, password: 'a sufficiently long password' },
    });
    const session = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/session',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });

    expect(login.statusCode).toBe(200);
    expect(AuthenticatedSessionSchema.parse(login.json()).account).toMatchObject({
      accountType: 'administrator',
      role: 'department_administrator',
      institutionName: 'Lagos State University',
      scope: {
        type: 'department',
        label: 'Electrical and Electronics Engineering',
        facultyName: 'Faculty of Engineering',
      },
    });
    expect(AuthenticatedSessionSchema.parse(session.json()).account.accountType).toBe('administrator');
  });

  it('revokes the server session and clears the cookie on logout', async () => {
    const auth = createAuth();
    const server = createServer(auth);
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });

    expect(response.statusCode).toBe(204);
    expect(auth.logout).toHaveBeenCalledWith(sessionToken);
    expect(String(response.headers['set-cookie'])).toContain('Max-Age=0');
  });
});

describe('password recovery and session management routes', () => {
  const resetToken = 'r'.repeat(43);

  it('answers every reset request with the same generic 202, including deferred delivery', async () => {
    const auth = createAuth();
    const server = createServer(auth);
    const accepted = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email: ' Amina@Example.NET ' },
    });
    vi.mocked(auth.requestPasswordReset).mockRejectedValueOnce(new EmailDeliveryDeferredError());
    const deferred = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/request',
      payload: { email: 'unknown@example.net' },
    });

    expect(accepted.statusCode).toBe(202);
    expect(deferred.statusCode).toBe(202);
    expect(deferred.json()).toEqual(accepted.json());
    expect(accepted.headers['cache-control']).toBe('no-store');
    expect(auth.requestPasswordReset).toHaveBeenNthCalledWith(1, 'amina@example.net');
  });

  it('rejects malformed reset requests before reaching the service', async () => {
    const auth = createAuth();
    const server = createServer(auth);
    const responses = await Promise.all([
      server.inject({ method: 'POST', url: '/api/v1/auth/password-reset/request', payload: { email: 'not-an-email' } }),
      server.inject({ method: 'POST', url: '/api/v1/auth/password-reset/request', payload: { email: 'a@example.net', role: 'admin' } }),
      server.inject({ method: 'POST', url: '/api/v1/auth/password-reset/complete', payload: { token: 'short', password: 'a sufficiently long password' } }),
      server.inject({ method: 'POST', url: '/api/v1/auth/password-reset/complete', payload: { token: resetToken, password: 'too short' } }),
      server.inject({ method: 'POST', url: '/api/v1/auth/password-reset/complete', payload: { token: resetToken, password: 'x'.repeat(129) } }),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([400, 400, 400, 400, 400]);
    expect(auth.requestPasswordReset).not.toHaveBeenCalled();
    expect(auth.completePasswordReset).not.toHaveBeenCalled();
  });

  it('completes a reset, clears this browser’s cookie and explains that every device was signed out', async () => {
    const auth = createAuth();
    const server = createServer(auth, true);
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/password-reset/complete',
      payload: { token: resetToken, password: 'a brand new passphrase' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'password_reset' });
    expect(auth.completePasswordReset).toHaveBeenCalledWith(resetToken, 'a brand new passphrase');
    expect(String(response.headers['set-cookie'])).toMatch(/lasuatos_session=; .*Max-Age=0.*Secure/);
  });

  it('requires a session to change the password and reports how many other sessions were signed out', async () => {
    const auth = createAuth();
    vi.mocked(auth.changePassword).mockResolvedValueOnce(2);
    const server = createServer(auth);
    const payload = { currentPassword: 'old passphrase here', newPassword: 'a brand new passphrase' };

    const anonymous = await server.inject({ method: 'POST', url: '/api/v1/auth/password', payload });
    const invalid = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
      payload: { ...payload, newPassword: 'short' },
    });
    const changed = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/password',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
      payload,
    });

    expect(anonymous.statusCode).toBe(401);
    expect(invalid.statusCode).toBe(400);
    expect(changed.statusCode).toBe(200);
    expect(changed.json()).toEqual({ status: 'password_changed', revokedSessions: 2 });
    expect(auth.changePassword).toHaveBeenCalledTimes(1);
    expect(auth.changePassword).toHaveBeenCalledWith(sessionToken, payload.currentPassword, payload.newPassword);
  });

  it('lists sessions without exposing tokens and marks the current one', async () => {
    const auth = createAuth();
    vi.mocked(auth.listSessions).mockResolvedValueOnce([
      {
        id: '7f1c3a52-5d0e-4a8b-9c61-2f4e8d7b6a10',
        createdAt: new Date('2026-11-01T08:00:00.000Z'),
        lastSeenAt: new Date('2026-11-10T08:00:00.000Z'),
        expiresAt: new Date('2026-12-01T08:00:00.000Z'),
        current: true,
      },
      {
        id: '0b9d2e41-8c7f-4f3a-a6b5-1e2d3c4b5a69',
        createdAt: new Date('2026-10-20T08:00:00.000Z'),
        lastSeenAt: null,
        expiresAt: new Date('2026-11-19T08:00:00.000Z'),
        current: false,
      },
    ]);
    const server = createServer(auth);
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/auth/sessions',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = AccountSessionsSchema.parse(response.json());
    expect(body.sessions.map((session) => session.current)).toEqual([true, false]);
    expect(body.sessions[1]?.lastSeenAt).toBeNull();
    expect(response.body).not.toContain(sessionToken);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('signs out other sessions, or one chosen session, and 404s when nothing was revoked', async () => {
    const auth = createAuth();
    const server = createServer(auth);
    const cookie = { cookie: `lasuatos_session=${sessionToken}` };
    const sessionId = '0b9d2e41-8c7f-4f3a-a6b5-1e2d3c4b5a69';

    vi.mocked(auth.revokeOtherSessions).mockResolvedValueOnce(3);
    const others = await server.inject({ method: 'POST', url: '/api/v1/auth/sessions/revoke-others', headers: cookie });
    const withBody = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/sessions/revoke-others',
      headers: cookie,
      payload: { userId: 'someone-else' },
    });
    vi.mocked(auth.revokeOtherSessions).mockResolvedValueOnce(1);
    const one = await server.inject({ method: 'DELETE', url: `/api/v1/auth/sessions/${sessionId}`, headers: cookie });
    vi.mocked(auth.revokeOtherSessions).mockResolvedValueOnce(0);
    const missing = await server.inject({ method: 'DELETE', url: `/api/v1/auth/sessions/${sessionId}`, headers: cookie });
    const badId = await server.inject({ method: 'DELETE', url: '/api/v1/auth/sessions/not-a-uuid', headers: cookie });
    const anonymous = await server.inject({ method: 'POST', url: '/api/v1/auth/sessions/revoke-others' });

    expect(others.json()).toEqual({ revokedSessions: 3 });
    expect(withBody.statusCode).toBe(400);
    expect(one.json()).toEqual({ revokedSessions: 1 });
    expect(auth.revokeOtherSessions).toHaveBeenCalledWith(sessionToken, sessionId);
    expect(missing.statusCode).toBe(404);
    expect(badId.statusCode).toBe(400);
    expect(anonymous.statusCode).toBe(401);
  });
});
