import { describe, expect, it } from 'vitest';
import { canAdministerScope, type AccessGrant, type AccessScope } from './authorization.js';

const institutionScope: AccessScope = { type: 'institution', institutionId: 'inst-1' };
const engineeringScope: AccessScope = {
  type: 'faculty',
  institutionId: 'inst-1',
  facultyId: 'faculty-eng',
};
const electricalScope: AccessScope = {
  type: 'department',
  institutionId: 'inst-1',
  facultyId: 'faculty-eng',
  departmentId: 'department-ece',
};

const grant = (role: AccessGrant['role'], scope: AccessScope): AccessGrant => ({ role, scope });

describe('canAdministerScope', () => {
  it('allows an institution administrator within their institution and descendants', () => {
    const grants = [grant('institution_administrator', institutionScope)];

    expect(canAdministerScope(grants, institutionScope)).toBe(true);
    expect(canAdministerScope(grants, engineeringScope)).toBe(true);
    expect(canAdministerScope(grants, electricalScope)).toBe(true);
    expect(
      canAdministerScope(grants, { type: 'institution', institutionId: 'inst-2' }),
    ).toBe(false);
  });

  it('keeps faculty administrators inside their faculty', () => {
    const grants = [grant('faculty_administrator', engineeringScope)];

    expect(canAdministerScope(grants, engineeringScope)).toBe(true);
    expect(canAdministerScope(grants, electricalScope)).toBe(true);
    expect(
      canAdministerScope(grants, {
        type: 'faculty',
        institutionId: 'inst-1',
        facultyId: 'faculty-science',
      }),
    ).toBe(false);
  });

  it('does not let a department administrator reach a sibling department', () => {
    const grants = [grant('department_administrator', electricalScope)];

    expect(canAdministerScope(grants, electricalScope)).toBe(true);
    expect(
      canAdministerScope(grants, {
        ...electricalScope,
        departmentId: 'department-mechanical',
      }),
    ).toBe(false);
    expect(canAdministerScope(grants, engineeringScope)).toBe(false);
  });

  it('does not treat student or lecturer roles as administrative grants', () => {
    const grants = [
      grant('student', electricalScope),
      grant('lecturer', electricalScope),
      grant('course_coordinator', electricalScope),
    ];

    expect(canAdministerScope(grants, electricalScope)).toBe(false);
  });

  it('rejects a role paired with a broader or mismatched scope', () => {
    const grants = [grant('department_administrator', engineeringScope)];

    expect(canAdministerScope(grants, electricalScope)).toBe(false);
  });

  it('allows a system administrator with a system-wide grant', () => {
    expect(canAdministerScope([grant('system_administrator', { type: 'system' })], electricalScope))
      .toBe(true);
  });
});
