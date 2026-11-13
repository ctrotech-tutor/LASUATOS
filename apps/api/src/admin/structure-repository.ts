/**
 * Data access for administrator edits to the academic structure. Every write
 * runs in a transaction together with an append-only audit row.
 */

export interface StructureDepartmentRecord {
  readonly id: string;
  readonly facultyId: string;
  readonly code: string;
  readonly name: string;
  readonly isActive: boolean;
  readonly programmeYears: number;
  readonly studentCount: number;
  readonly courseOfferingCount: number;
}

export interface StructureFacultyRecord {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly isActive: boolean;
}

export interface StructureSessionRecord {
  readonly id: string;
  readonly code: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly isCurrent: boolean;
  readonly semesters: readonly { readonly id: string; readonly name: string; readonly startsAt: Date; readonly endsAt: Date }[];
}

export interface StructureSnapshot {
  readonly faculties: readonly StructureFacultyRecord[];
  readonly departments: readonly StructureDepartmentRecord[];
  readonly academicSessions: readonly StructureSessionRecord[];
}

interface Actor {
  readonly institutionId: string;
  readonly actorUserId: string;
}

export type CreateResult = { readonly kind: 'created'; readonly id: string } | { readonly kind: 'code_taken' };

export interface StructureRepository {
  getStructure(institutionId: string): Promise<StructureSnapshot>;
  /** The faculty a department belongs to, for permission checks; null when not in this institution. */
  getDepartmentFaculty(institutionId: string, departmentId: string): Promise<string | null>;
  createFaculty(input: Actor & { readonly code: string; readonly name: string }): Promise<CreateResult>;
  updateFaculty(input: Actor & {
    readonly facultyId: string;
    readonly name?: string | undefined;
    readonly isActive?: boolean | undefined;
  }): Promise<'updated' | 'not_found' | 'has_active_departments'>;
  createDepartment(input: Actor & {
    readonly facultyId: string;
    readonly code: string;
    readonly name: string;
    readonly programmeYears: number;
  }): Promise<CreateResult | { readonly kind: 'faculty_unavailable' }>;
  updateDepartment(input: Actor & {
    readonly departmentId: string;
    readonly name?: string | undefined;
    readonly programmeYears?: number | undefined;
    readonly isActive?: boolean | undefined;
  }): Promise<'updated' | 'not_found' | 'faculty_inactive'>;
  createAcademicSession(input: Actor & {
    readonly code: string;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly makeCurrent: boolean;
    readonly semesters: readonly { readonly name: string; readonly startsAt: Date; readonly endsAt: Date }[];
  }): Promise<CreateResult>;
  setCurrentSession(input: Actor & { readonly sessionId: string }): Promise<'updated' | 'not_found'>;
  /**
   * Corrects a session's code, dates and semesters. Semesters with an id are
   * updated, those without are added; none can be removed.
   */
  updateAcademicSession(input: Actor & {
    readonly sessionId: string;
    readonly code: string;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly semesters: readonly { readonly id?: string | undefined; readonly name: string; readonly startsAt: Date; readonly endsAt: Date }[];
  }): Promise<'updated' | 'not_found' | 'code_taken' | 'semester_unknown' | 'semester_removed'>;
}
