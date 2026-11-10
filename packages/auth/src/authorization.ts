import type { UserRole } from '@lasuatos/contracts';

export type AccessScope =
  | { readonly type: 'system' }
  | { readonly type: 'institution'; readonly institutionId: string }
  | {
      readonly type: 'faculty';
      readonly institutionId: string;
      readonly facultyId: string;
    }
  | {
      readonly type: 'department';
      readonly institutionId: string;
      readonly facultyId: string;
      readonly departmentId: string;
    };

export type AdministrativeRole = Extract<
  UserRole,
  | 'department_administrator'
  | 'faculty_administrator'
  | 'institution_administrator'
  | 'system_administrator'
>;

export interface AccessGrant {
  readonly role: UserRole;
  readonly scope: AccessScope;
}

const administrativeScopeByRole: Readonly<Record<AdministrativeRole, AccessScope['type']>> = {
  department_administrator: 'department',
  faculty_administrator: 'faculty',
  institution_administrator: 'institution',
  system_administrator: 'system',
};

function grantCoversTarget(grant: AccessGrant, target: AccessScope): boolean {
  if (!(grant.role in administrativeScopeByRole)) {
    return false;
  }

  const role = grant.role as AdministrativeRole;
  if (administrativeScopeByRole[role] !== grant.scope.type) {
    return false;
  }

  switch (grant.scope.type) {
    case 'system':
      return target.type !== 'system' || role === 'system_administrator';
    case 'institution':
      return target.type !== 'system' && target.institutionId === grant.scope.institutionId;
    case 'faculty':
      return (
        (target.type === 'faculty' || target.type === 'department') &&
        target.institutionId === grant.scope.institutionId &&
        target.facultyId === grant.scope.facultyId
      );
    case 'department':
      return (
        target.type === 'department' &&
        target.institutionId === grant.scope.institutionId &&
        target.facultyId === grant.scope.facultyId &&
        target.departmentId === grant.scope.departmentId
      );
  }
}

/**
 * Checks administrative scope only. This is a server-side authorization
 * primitive, not a replacement for authenticating the caller or checking
 * course assignments and student ownership.
 */
export function canAdministerScope(
  grants: readonly AccessGrant[],
  target: AccessScope,
): boolean {
  return grants.some((grant) => grantCoversTarget(grant, target));
}
