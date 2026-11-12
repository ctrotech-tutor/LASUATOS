import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../server.js';
import type { AuthRouteService } from '../auth/routes.js';
import type { AdministratorSessionAccount, StudentSessionAccount } from '../auth/repository.js';
import type { StructureRouteOptions } from './structure-routes.js';

const sessionToken = 'b'.repeat(43);
const cookie = `lasuatos_session=${sessionToken}`;
const facultyId = '5b1b8f0e-7c55-4a3e-9d6f-0f2f9d2c1a11';
const student: StudentSessionAccount = {
  accountType: 'student',
  id: '3c4ad7b8-377d-4ea9-a7bf-f7db874f388c',
  email: 'student@example.net',
  displayName: 'Example Student',
  matricNumber: '240591001',
  matricNumberVerified: false,
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
};
const administrator: AdministratorSessionAccount = {
  accountType: 'administrator',
  id: '33c7c76b-59a6-453d-b5a8-45ba1c985999',
  email: 'admin@example.net',
  displayName: 'Institution Administrator',
  emailVerified: true,
  institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
  institutionName: 'Lagos State University',
  role: 'institution_administrator',
  scope: { type: 'institution', id: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8', label: 'LASU', institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8' },
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
};
const servers: ReturnType<typeof buildServer>[] = [];

function createAuth(account: AdministratorSessionAccount | StudentSessionAccount | null): AuthRouteService {
  return {
    registerStudent: vi.fn(async () => ({ token: sessionToken, student })),
    resendVerification: vi.fn(async () => undefined),
    verifyEmail: vi.fn(async () => ({ token: sessionToken, student })),
    login: vi.fn(async () => ({ token: sessionToken, account: student })),
    getSession: vi.fn(async () => account),
    logout: vi.fn(async () => undefined),
    requestPasswordReset: vi.fn(async () => undefined),
    completePasswordReset: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => 0),
    listSessions: vi.fn(async () => []),
    revokeOtherSessions: vi.fn(async () => 0),
  };
}

function createStructure() {
  return {
    getStructure: vi.fn(async () => ({ permissions: { manageFaculties: true, manageSessions: true }, faculties: [], academicSessions: [] })),
    createFaculty: vi.fn(async () => facultyId),
    updateFaculty: vi.fn(async () => facultyId),
    createDepartment: vi.fn(async () => facultyId),
    updateDepartment: vi.fn(async (_account: AdministratorSessionAccount, departmentId: string) => departmentId),
    createAcademicSession: vi.fn(async () => facultyId),
    setCurrentSession: vi.fn(async (_account: AdministratorSessionAccount, sessionId: string) => sessionId),
  } satisfies NonNullable<StructureRouteOptions['structure']>;
}

function createServer(account: AdministratorSessionAccount | StudentSessionAccount | null, structure = createStructure()) {
  const server = buildServer({ logger: false, auth: createAuth(account), structure });
  servers.push(server);
  return { server, structure };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('academic structure routes', () => {
  it('serves the structure to administrators only', async () => {
    const { server, structure } = createServer(administrator);
    const response = await server.inject({ method: 'GET', url: '/api/v1/admin/structure', headers: { cookie } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(structure.getStructure).toHaveBeenCalledWith(administrator);

    const { server: studentServer, structure: untouched } = createServer(student);
    expect((await studentServer.inject({ method: 'GET', url: '/api/v1/admin/structure', headers: { cookie } })).statusCode).toBe(403);
    expect((await studentServer.inject({ method: 'GET', url: '/api/v1/admin/structure' })).statusCode).toBe(401);
    expect(untouched.getStructure).not.toHaveBeenCalled();
  });

  it('validates and normalises department input before calling the service', async () => {
    const { server, structure } = createServer(administrator);
    const created = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/structure/departments',
      headers: { cookie },
      payload: { facultyId, code: 'csc', name: '  Computer Science ', programmeYears: 4 },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ status: 'saved', id: facultyId });
    expect(structure.createDepartment).toHaveBeenCalledWith(administrator, { facultyId, code: 'CSC', name: 'Computer Science', programmeYears: 4 });

    const tooLong = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/structure/departments',
      headers: { cookie },
      payload: { facultyId, code: 'CSC', name: 'Computer Science', programmeYears: 9 },
    });
    const empty = await server.inject({
      method: 'POST',
      url: `/api/v1/admin/structure/departments/${facultyId}`,
      headers: { cookie },
      payload: {},
    });
    const badId = await server.inject({
      method: 'POST',
      url: '/api/v1/admin/structure/faculties/not-a-uuid',
      headers: { cookie },
      payload: { name: 'Faculty of Science' },
    });
    expect([tooLong.statusCode, empty.statusCode, badId.statusCode]).toEqual([400, 400, 400]);
    expect(structure.updateDepartment).not.toHaveBeenCalled();
    expect(structure.updateFaculty).not.toHaveBeenCalled();
  });

  it('switches the current academic session', async () => {
    const { server, structure } = createServer(administrator);
    const response = await server.inject({
      method: 'POST',
      url: `/api/v1/admin/structure/academic-sessions/${facultyId}/current`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    expect(structure.setCurrentSession).toHaveBeenCalledWith(administrator, facultyId);
  });
});
