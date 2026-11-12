import { describe, expect, it } from 'vitest';
import { canManagePosition, rolesGrantableBy, type ActorScope, type StaffPosition } from './policy.js';
import { RATE_LIMIT_POLICIES } from '../security/rate-limit-policies.js';

const INSTITUTION = 'i-1';
const institutionAdmin: ActorScope = { type: 'institution', institutionId: INSTITUTION };
const engineeringAdmin: ActorScope = { type: 'faculty', institutionId: INSTITUTION, facultyId: 'f-eng' };
const eceAdmin: ActorScope = { type: 'department', institutionId: INSTITUTION, departmentId: 'd-ece' };

const at = (role: StaffPosition['role'], facultyId: string | null, departmentId: string | null, institutionId = INSTITUTION): StaffPosition => ({
  institutionId, role, facultyId, departmentId,
});

describe('staff scope policy', () => {
  it('grants only roles at or below the actor level', () => {
    expect(rolesGrantableBy(institutionAdmin)).toContain('institution_administrator');
    expect(rolesGrantableBy(engineeringAdmin)).not.toContain('institution_administrator');
    expect(rolesGrantableBy(eceAdmin)).toEqual(['lecturer', 'department_administrator']);
  });

  it('keeps faculty and department administrators inside their own area', () => {
    expect(canManagePosition(institutionAdmin, at('faculty_administrator', 'f-sci', null))).toBe(true);
    expect(canManagePosition(institutionAdmin, at('lecturer', 'f-eng', 'd-ece', 'other-institution'))).toBe(false);

    expect(canManagePosition(engineeringAdmin, at('lecturer', 'f-eng', 'd-ece'))).toBe(true);
    expect(canManagePosition(engineeringAdmin, at('faculty_administrator', 'f-eng', null))).toBe(true);
    expect(canManagePosition(engineeringAdmin, at('lecturer', 'f-sci', 'd-csc'))).toBe(false);
    expect(canManagePosition(engineeringAdmin, at('faculty_administrator', 'f-sci', null))).toBe(false);
    expect(canManagePosition(engineeringAdmin, at('institution_administrator', null, null))).toBe(false);

    expect(canManagePosition(eceAdmin, at('lecturer', 'f-eng', 'd-ece'))).toBe(true);
    expect(canManagePosition(eceAdmin, at('department_administrator', 'f-eng', 'd-ece'))).toBe(true);
    expect(canManagePosition(eceAdmin, at('lecturer', 'f-eng', 'd-mech'))).toBe(false);
    expect(canManagePosition(eceAdmin, at('faculty_administrator', 'f-eng', null))).toBe(false);
  });

  it('rate-limits invitation creation, resend, preview and accept', () => {
    for (const key of [
      'POST /api/v1/admin/staff/invitations',
      'POST /api/v1/admin/staff/invitations/:invitationId/resend',
      'POST /api/v1/staff-invitations/preview',
      'POST /api/v1/staff-invitations/accept',
    ]) expect(RATE_LIMIT_POLICIES[key]?.length).toBeGreaterThan(0);
  });
});
