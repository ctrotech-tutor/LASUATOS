import { z } from 'zod';
import {
  CreateAcademicSessionRequestSchema,
  CreateDepartmentRequestSchema,
  CreateFacultyRequestSchema,
  UpdateDepartmentRequestSchema,
  UpdateFacultyRequestSchema,
  type StructureChangeResponse,
} from '@lasuatos/contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import type { StudentAuthService } from '../auth/service.js';
import { notAuthenticated, readSessionToken, unavailable, wrongAccountType } from '../attendance/route-helpers.js';
import type { StructureService } from './structure-service.js';

const facultyParams = z.object({ facultyId: z.uuid() }).strict();
const departmentParams = z.object({ departmentId: z.uuid() }).strict();
const sessionParams = z.object({ sessionId: z.uuid() }).strict();

function invalid(): Error {
  return Object.assign(new Error('Invalid request.'), { statusCode: 400 });
}

export interface StructureRouteOptions {
  readonly auth?: Pick<StudentAuthService, 'getSession'>;
  readonly structure?: Pick<
    StructureService,
    'getStructure' | 'createFaculty' | 'updateFaculty' | 'createDepartment' | 'updateDepartment' | 'createAcademicSession' | 'setCurrentSession'
  >;
}

export function registerStructureRoutes(server: FastifyInstance, options: StructureRouteOptions): void {
  async function requireAdministrator(request: FastifyRequest): Promise<AdministratorSessionAccount> {
    if (!options.auth) throw Object.assign(new Error('Authentication is unavailable.'), { statusCode: 503 });
    const token = readSessionToken(request);
    if (!token) throw notAuthenticated();
    const account = await options.auth.getSession(token);
    if (!account) throw notAuthenticated();
    if (account.accountType !== 'administrator') throw wrongAccountType();
    return account;
  }

  const saved = (id: string): StructureChangeResponse => ({ status: 'saved', id });

  server.get('/api/v1/admin/structure', async (request, reply) => {
    if (!options.structure) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    return reply.header('cache-control', 'no-store').send(await options.structure.getStructure(account));
  });

  server.post('/api/v1/admin/structure/faculties', async (request, reply) => {
    const body = CreateFacultyRequestSchema.safeParse(request.body);
    if (!body.success) throw invalid();
    if (!options.structure) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const id = await options.structure.createFaculty(account, body.data);
    return reply.code(201).header('cache-control', 'no-store').send(saved(id));
  });

  server.post('/api/v1/admin/structure/faculties/:facultyId', async (request, reply) => {
    const params = facultyParams.safeParse(request.params);
    const body = UpdateFacultyRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) throw invalid();
    if (!options.structure) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const id = await options.structure.updateFaculty(account, params.data.facultyId, body.data);
    return reply.header('cache-control', 'no-store').send(saved(id));
  });

  server.post('/api/v1/admin/structure/departments', async (request, reply) => {
    const body = CreateDepartmentRequestSchema.safeParse(request.body);
    if (!body.success) throw invalid();
    if (!options.structure) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const id = await options.structure.createDepartment(account, body.data);
    return reply.code(201).header('cache-control', 'no-store').send(saved(id));
  });

  server.post('/api/v1/admin/structure/departments/:departmentId', async (request, reply) => {
    const params = departmentParams.safeParse(request.params);
    const body = UpdateDepartmentRequestSchema.safeParse(request.body);
    if (!params.success || !body.success) throw invalid();
    if (!options.structure) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const id = await options.structure.updateDepartment(account, params.data.departmentId, body.data);
    return reply.header('cache-control', 'no-store').send(saved(id));
  });

  server.post('/api/v1/admin/structure/academic-sessions', async (request, reply) => {
    const body = CreateAcademicSessionRequestSchema.safeParse(request.body);
    if (!body.success) throw invalid();
    if (!options.structure) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const id = await options.structure.createAcademicSession(account, body.data);
    return reply.code(201).header('cache-control', 'no-store').send(saved(id));
  });

  server.post('/api/v1/admin/structure/academic-sessions/:sessionId/current', async (request, reply) => {
    const params = sessionParams.safeParse(request.params);
    if (!params.success) throw invalid();
    if (!options.structure) return unavailable(request, reply);
    const account = await requireAdministrator(request);
    const id = await options.structure.setCurrentSession(account, params.data.sessionId);
    return reply.header('cache-control', 'no-store').send(saved(id));
  });
}
