import {
  CreateAcademicSessionRequestSchema,
  CreateDepartmentRequestSchema,
  CreateFacultyRequestSchema,
  InstitutionStructureSchema,
  StructureChangeResponseSchema,
  UpdateDepartmentRequestSchema,
  UpdateFacultyRequestSchema,
} from '@lasuatos/contracts';
import { requestJson } from './course-api';

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
});

export function loadInstitutionStructure(signal?: AbortSignal) {
  return requestJson('/api/v1/admin/structure', InstitutionStructureSchema, signal ? { signal } : undefined);
}

export function createFaculty(input: unknown) {
  return requestJson('/api/v1/admin/structure/faculties', StructureChangeResponseSchema, post(CreateFacultyRequestSchema.parse(input)));
}

export function updateFaculty(facultyId: string, input: unknown) {
  return requestJson(
    `/api/v1/admin/structure/faculties/${encodeURIComponent(facultyId)}`,
    StructureChangeResponseSchema,
    post(UpdateFacultyRequestSchema.parse(input)),
  );
}

export function createDepartment(input: unknown) {
  return requestJson('/api/v1/admin/structure/departments', StructureChangeResponseSchema, post(CreateDepartmentRequestSchema.parse(input)));
}

export function updateDepartment(departmentId: string, input: unknown) {
  return requestJson(
    `/api/v1/admin/structure/departments/${encodeURIComponent(departmentId)}`,
    StructureChangeResponseSchema,
    post(UpdateDepartmentRequestSchema.parse(input)),
  );
}

export function createAcademicSession(input: unknown) {
  return requestJson(
    '/api/v1/admin/structure/academic-sessions',
    StructureChangeResponseSchema,
    post(CreateAcademicSessionRequestSchema.parse(input)),
  );
}

export function setCurrentAcademicSession(sessionId: string) {
  return requestJson(
    `/api/v1/admin/structure/academic-sessions/${encodeURIComponent(sessionId)}/current`,
    StructureChangeResponseSchema,
    post(),
  );
}
