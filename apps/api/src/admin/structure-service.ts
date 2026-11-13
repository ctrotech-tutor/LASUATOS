import type { InstitutionStructure } from '@lasuatos/contracts';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import type { StructureRepository } from './structure-repository.js';

/**
 * Administrator edits to faculties, departments and academic sessions.
 *
 * Who may do what:
 * - institution administrators: everything;
 * - faculty administrators: add departments to their faculty and edit or
 *   deactivate any department in it;
 * - department administrators: rename their own department and set its
 *   programme length (not deactivate it).
 * Academic sessions and faculties are institution-level.
 */

function structureError(statusCode: number, name: string, message: string): Error {
  return Object.assign(new Error(message), { statusCode, name, exposeDetail: true });
}

const forbidden = () => structureError(403, 'StructureForbiddenError', 'Your administrator role does not cover that change.');
const notFound = (what: string) => structureError(404, 'StructureNotFoundError', `That ${what} was not found.`);

export class StructureService {
  readonly #repository: StructureRepository;

  constructor(options: { readonly repository: StructureRepository }) {
    this.#repository = options.repository;
  }

  async getStructure(account: AdministratorSessionAccount): Promise<InstitutionStructure> {
    const snapshot = await this.#repository.getStructure(account.institutionId);
    const institutionWide = account.role === 'institution_administrator';
    const facultyScope = account.scope.type === 'faculty' ? account.scope.id : null;
    const departmentScope = account.scope.type === 'department' ? account.scope.id : null;
    const departmentFaculty = departmentScope
      ? snapshot.departments.find((department) => department.id === departmentScope)?.facultyId ?? null
      : null;

    const faculties = snapshot.faculties
      .filter((faculty) => institutionWide || faculty.id === facultyScope || faculty.id === departmentFaculty)
      .map((faculty) => {
        const canManageFaculty = institutionWide || faculty.id === facultyScope;
        return {
          id: faculty.id,
          code: faculty.code,
          name: faculty.name,
          isActive: faculty.isActive,
          canAddDepartment: canManageFaculty && faculty.isActive,
          departments: snapshot.departments
            .filter((department) => department.facultyId === faculty.id)
            .filter((department) => canManageFaculty || department.id === departmentScope)
            .map((department) => ({
              id: department.id,
              code: department.code,
              name: department.name,
              isActive: department.isActive,
              programmeYears: department.programmeYears,
              studentCount: department.studentCount,
              courseOfferingCount: department.courseOfferingCount,
              editable: canManageFaculty || department.id === departmentScope,
              canDeactivate: canManageFaculty,
            })),
        };
      });

    return {
      permissions: { manageFaculties: institutionWide, manageSessions: institutionWide },
      faculties,
      academicSessions: snapshot.academicSessions.map((session) => ({
        id: session.id,
        code: session.code,
        startsAt: session.startsAt.toISOString(),
        endsAt: session.endsAt.toISOString(),
        isCurrent: session.isCurrent,
        semesters: session.semesters.map((semester) => ({
          id: semester.id,
          name: semester.name,
          startsAt: semester.startsAt.toISOString(),
          endsAt: semester.endsAt.toISOString(),
        })),
      })),
    };
  }

  async createFaculty(account: AdministratorSessionAccount, input: { readonly code: string; readonly name: string }) {
    if (account.role !== 'institution_administrator') throw forbidden();
    const result = await this.#repository.createFaculty({ institutionId: account.institutionId, actorUserId: account.id, ...input });
    if (result.kind === 'code_taken') throw structureError(409, 'StructureCodeTakenError', `A faculty with the code ${input.code} already exists.`);
    return result.id;
  }

  async updateFaculty(
    account: AdministratorSessionAccount,
    facultyId: string,
    input: { readonly name?: string | undefined; readonly isActive?: boolean | undefined },
  ) {
    if (account.role !== 'institution_administrator') throw forbidden();
    const result = await this.#repository.updateFaculty({
      institutionId: account.institutionId,
      actorUserId: account.id,
      facultyId,
      name: input.name,
      isActive: input.isActive,
    });
    if (result === 'not_found') throw notFound('faculty');
    if (result === 'has_active_departments') {
      throw structureError(409, 'StructureFacultyInUseError', 'Deactivate the faculty’s departments first.');
    }
    return facultyId;
  }

  async createDepartment(account: AdministratorSessionAccount, input: {
    readonly facultyId: string;
    readonly code: string;
    readonly name: string;
    readonly programmeYears: number;
  }) {
    const allowed = account.role === 'institution_administrator'
      || (account.scope.type === 'faculty' && account.scope.id === input.facultyId);
    if (!allowed) throw forbidden();
    const result = await this.#repository.createDepartment({ institutionId: account.institutionId, actorUserId: account.id, ...input });
    if (result.kind === 'faculty_unavailable') throw notFound('faculty');
    if (result.kind === 'code_taken') {
      throw structureError(409, 'StructureCodeTakenError', `A department with the code ${input.code} already exists. Department codes are unique across the university.`);
    }
    return result.id;
  }

  async updateDepartment(
    account: AdministratorSessionAccount,
    departmentId: string,
    input: { readonly name?: string | undefined; readonly programmeYears?: number | undefined; readonly isActive?: boolean | undefined },
  ) {
    const facultyId = await this.#repository.getDepartmentFaculty(account.institutionId, departmentId);
    if (!facultyId) throw notFound('department');
    const managesFaculty = account.role === 'institution_administrator'
      || (account.scope.type === 'faculty' && account.scope.id === facultyId);
    const ownsDepartment = account.scope.type === 'department' && account.scope.id === departmentId;
    if (!managesFaculty && !ownsDepartment) throw forbidden();
    if (input.isActive !== undefined && !managesFaculty) throw forbidden();
    const result = await this.#repository.updateDepartment({
      institutionId: account.institutionId,
      actorUserId: account.id,
      departmentId,
      name: input.name,
      programmeYears: input.programmeYears,
      isActive: input.isActive,
    });
    if (result === 'not_found') throw notFound('department');
    if (result === 'faculty_inactive') {
      throw structureError(409, 'StructureFacultyInactiveError', 'Reactivate the faculty before reactivating its departments.');
    }
    return departmentId;
  }

  async createAcademicSession(account: AdministratorSessionAccount, input: {
    readonly code: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly makeCurrent: boolean;
    readonly semesters: readonly { readonly name: string; readonly startsAt: string; readonly endsAt: string }[];
  }) {
    if (account.role !== 'institution_administrator') throw forbidden();
    const result = await this.#repository.createAcademicSession({
      institutionId: account.institutionId,
      actorUserId: account.id,
      code: input.code,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      makeCurrent: input.makeCurrent,
      semesters: input.semesters.map((semester) => ({
        name: semester.name,
        startsAt: new Date(semester.startsAt),
        endsAt: new Date(semester.endsAt),
      })),
    });
    if (result.kind === 'code_taken') throw structureError(409, 'StructureCodeTakenError', `The ${input.code} session already exists.`);
    return result.id;
  }

  async updateAcademicSession(account: AdministratorSessionAccount, sessionId: string, input: {
    readonly code: string;
    readonly startsAt: string;
    readonly endsAt: string;
    readonly semesters: readonly { readonly id?: string | undefined; readonly name: string; readonly startsAt: string; readonly endsAt: string }[];
  }) {
    if (account.role !== 'institution_administrator') throw forbidden();
    const result = await this.#repository.updateAcademicSession({
      institutionId: account.institutionId,
      actorUserId: account.id,
      sessionId,
      code: input.code,
      startsAt: new Date(input.startsAt),
      endsAt: new Date(input.endsAt),
      semesters: input.semesters.map((semester) => ({
        id: semester.id,
        name: semester.name,
        startsAt: new Date(semester.startsAt),
        endsAt: new Date(semester.endsAt),
      })),
    });
    if (result === 'not_found') throw notFound('academic session');
    if (result === 'code_taken') throw structureError(409, 'StructureCodeTakenError', `The ${input.code} session already exists.`);
    if (result === 'semester_unknown') throw notFound('semester');
    if (result === 'semester_removed') {
      throw structureError(409, 'StructureSemesterRemovedError', 'Semesters cannot be removed, because courses may already be attached. Rename it or change its dates instead.');
    }
    return sessionId;
  }

  async setCurrentSession(account: AdministratorSessionAccount, sessionId: string) {
    if (account.role !== 'institution_administrator') throw forbidden();
    const result = await this.#repository.setCurrentSession({ institutionId: account.institutionId, actorUserId: account.id, sessionId });
    if (result === 'not_found') throw notFound('academic session');
    return sessionId;
  }
}
