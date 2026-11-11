import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../server.js';
import type { AuthRouteService } from '../auth/routes.js';
import type {
  AdministratorSessionAccount,
  StudentSessionAccount,
} from '../auth/repository.js';
import type { AdministratorRouteOptions } from './routes.js';

const sessionToken = 'a'.repeat(43);
const student: StudentSessionAccount = {
  accountType: 'student',
  id: '3c4ad7b8-377d-4ea9-a7bf-f7db874f388c',
  email: 'student@example.net',
  displayName: 'Example Student',
  matricNumber: '12345',
  matricNumberVerified: false,
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
const metrics = {
  metrics: {
    departments: 1,
    activeStudents: 86,
    activeLecturers: 12,
    courseOfferings: 14,
    activeEnrollments: 263,
  },
};
const servers: ReturnType<typeof buildServer>[] = [];

function createAuth(account: AdministratorSessionAccount | StudentSessionAccount | null): AuthRouteService {
  return {
    registerStudent: vi.fn(async () => undefined),
    resendVerification: vi.fn(async () => undefined),
    verifyEmail: vi.fn(async () => ({ token: sessionToken, student })),
    login: vi.fn(async () => ({ token: sessionToken, account: student })),
    getSession: vi.fn(async () => account),
    logout: vi.fn(async () => undefined),
  };
}

function createServer(options: Partial<AdministratorRouteOptions> = {}) {
  const server = buildServer({
    logger: false,
    ...(options.auth ? { auth: options.auth as AuthRouteService } : {}),
    ...(options.overview ? { administratorOverview: options.overview } : {}),
  });
  servers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('administrator overview route', () => {
  it('requires an authenticated administrator and returns only assigned-scope metrics', async () => {
    const overview = { getOverview: vi.fn(async () => metrics) };
    const server = createServer({ auth: createAuth(administrator), overview });
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual(metrics);
    expect(overview.getOverview).toHaveBeenCalledWith(administrator);
  });

  it('rejects student sessions and unauthenticated requests', async () => {
    const overview = { getOverview: vi.fn(async () => metrics) };
    const studentServer = createServer({ auth: createAuth(student), overview });
    const denied = await studentServer.inject({
      method: 'GET',
      url: '/api/v1/admin/overview',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });
    const noCookie = await studentServer.inject({ method: 'GET', url: '/api/v1/admin/overview' });

    expect(denied.statusCode).toBe(403);
    expect(noCookie.statusCode).toBe(401);
    expect(overview.getOverview).not.toHaveBeenCalled();
  });

  it('serves the scope-filtered attendance overview to administrators only', async () => {
    const attendance = {
      generatedAt: new Date('2026-11-10T12:00:00.000Z'),
      totals: {
        offeringsWithSessions: 1,
        sessionsHeld: 4,
        expectedCheckIns: 40,
        presentCheckIns: 30,
        inconclusiveCheckIns: 3,
        manualCheckIns: 2,
        revokedCheckIns: 1,
        rate: 75,
      },
      offerings: [{
        courseOfferingId: '2b9d64a7-0d47-4d8a-8d2e-5b0b3c9d1a10',
        courseCode: 'EEE 301',
        courseTitle: 'Circuit Theory',
        departmentName: 'Electrical and Electronics Engineering',
        semesterLabel: '2026/27 First',
        sessionsHeld: 4,
        activeEnrollments: 10,
        expectedCheckIns: 40,
        presentCheckIns: 30,
        inconclusiveCheckIns: 3,
        manualCheckIns: 2,
        revokedCheckIns: 1,
        rate: 75,
        lastSessionAt: new Date('2026-11-09T09:00:00.000Z'),
      }],
    };
    const overview = { getOverview: vi.fn(async () => metrics), getAttendanceOverview: vi.fn(async () => attendance) };
    const server = createServer({ auth: createAuth(administrator), overview });
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/admin/attendance',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const { AdministratorAttendanceOverviewSchema } = await import('@lasuatos/contracts');
    const parsed = AdministratorAttendanceOverviewSchema.parse(response.json());
    expect(parsed.offerings[0]?.lastSessionAt).toBe('2026-11-09T09:00:00.000Z');
    expect(overview.getAttendanceOverview).toHaveBeenCalledWith(administrator);

    const studentOverview = { getOverview: vi.fn(async () => metrics), getAttendanceOverview: vi.fn(async () => attendance) };
    const studentServer = createServer({ auth: createAuth(student), overview: studentOverview });
    const denied = await studentServer.inject({
      method: 'GET',
      url: '/api/v1/admin/attendance',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });
    expect(denied.statusCode).toBe(403);
    expect(studentOverview.getAttendanceOverview).not.toHaveBeenCalled();

    const anonymous = createServer({ auth: createAuth(null), overview });
    expect((await anonymous.inject({ method: 'GET', url: '/api/v1/admin/attendance' })).statusCode).toBe(401);
  });
});
