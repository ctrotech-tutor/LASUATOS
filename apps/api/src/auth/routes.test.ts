import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthenticatedSessionSchema, ApiProblemSchema } from '@lasuatos/contracts';
import { buildServer } from '../server.js';
import { EmailDeliveryDeferredError, InvalidLoginError } from './service.js';
import type { AuthRouteService } from './routes.js';
import type { LecturerSessionAccount, StudentSessionAccount } from './repository.js';

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

const servers: ReturnType<typeof buildServer>[] = [];

function createAuth(
  account: StudentSessionAccount | LecturerSessionAccount = student,
): AuthRouteService {
  return {
    registerStudent: vi.fn(async () => undefined),
    resendVerification: vi.fn(async () => undefined),
    verifyEmail: vi.fn(async () => ({ token: sessionToken, student })),
    login: vi.fn(async () => ({ token: sessionToken, account })),
    getSession: vi.fn(async () => account),
    logout: vi.fn(async () => undefined),
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
