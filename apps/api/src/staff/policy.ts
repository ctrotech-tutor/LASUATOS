import type { StaffRole } from '@lasuatos/contracts';

/**
 * Who may invite or manage whom. The rule is "at or below your own level,
 * inside your own area":
 *
 * - Institution administrators: every staff role anywhere in the institution.
 * - Faculty administrators: faculty administrators of their own faculty, and
 *   department administrators and lecturers of departments in that faculty.
 * - Department administrators: department administrators and lecturers of
 *   their own department.
 *
 * Nobody manages themselves, and nobody can grant a role broader than their own.
 */

export type ActorScope =
  | { readonly type: 'institution'; readonly institutionId: string }
  | { readonly type: 'faculty'; readonly institutionId: string; readonly facultyId: string }
  | { readonly type: 'department'; readonly institutionId: string; readonly departmentId: string };

/** Where a staff position sits; `facultyId` is the department's faculty for department-level roles. */
export interface StaffPosition {
  readonly institutionId: string;
  readonly role: StaffRole;
  readonly facultyId: string | null;
  readonly departmentId: string | null;
}

const ROLE_RANK: Readonly<Record<StaffRole, number>> = {
  lecturer: 0,
  department_administrator: 1,
  faculty_administrator: 2,
  institution_administrator: 3,
};

export function rolesGrantableBy(actor: ActorScope): StaffRole[] {
  switch (actor.type) {
    case 'institution':
      return ['lecturer', 'department_administrator', 'faculty_administrator', 'institution_administrator'];
    case 'faculty':
      return ['lecturer', 'department_administrator', 'faculty_administrator'];
    case 'department':
      return ['lecturer', 'department_administrator'];
  }
}

export function canManagePosition(actor: ActorScope, target: StaffPosition): boolean {
  if (actor.institutionId !== target.institutionId) return false;
  if (!rolesGrantableBy(actor).includes(target.role)) return false;
  switch (actor.type) {
    case 'institution':
      return true;
    case 'faculty':
      return target.facultyId === actor.facultyId;
    case 'department':
      return ROLE_RANK[target.role] <= ROLE_RANK.department_administrator && target.departmentId === actor.departmentId;
  }
}
