import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { DatabaseClient } from '@lasuatos/database';
import { CreateAcademicSessionRequestSchema, CreateDepartmentRequestSchema } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import { applyMigrations, ids, seedAttendanceFixture } from '../attendance/integration-fixture.js';
import { PostgresStructureRepository } from './structure-postgres-repository.js';
import { StructureService } from './structure-service.js';

const base = {
  accountType: 'administrator' as const,
  email: 'admin@test.invalid',
  displayName: 'Admin',
  emailVerified: true as const,
  institutionId: ids.institution,
  institutionName: 'Demo Test',
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
};
const institutionAdmin: AdministratorSessionAccount = {
  ...base,
  id: ids.lecturer,
  role: 'institution_administrator',
  scope: { type: 'institution', id: ids.institution, label: 'Demo Test', institutionId: ids.institution },
};
const facultyAdmin: AdministratorSessionAccount = {
  ...base,
  id: ids.student,
  role: 'faculty_administrator',
  scope: { type: 'faculty', id: ids.faculty, label: 'Faculty', institutionId: ids.institution },
};
const departmentAdmin: AdministratorSessionAccount = {
  ...base,
  id: ids.notEnrolled,
  role: 'department_administrator',
  scope: { type: 'department', id: ids.department, label: 'Department', facultyName: 'Faculty', institutionId: ids.institution },
};

describe('academic structure editing', () => {
  it('scopes edits by administrator role and audits every change', async () => {
    const client = new PGlite();
    try {
      await applyMigrations(client);
      await seedAttendanceFixture(client, new Date('2026-11-02T09:00:00.000Z'));
      const database = drizzle(client) as unknown as DatabaseClient;
      const service = new StructureService({ repository: new PostgresStructureRepository(database) });

      // The institution administrator sees everything and may manage faculties and sessions.
      const initial = await service.getStructure(institutionAdmin);
      expect(initial.permissions).toEqual({ manageFaculties: true, manageSessions: true });
      expect(initial.faculties).toEqual([expect.objectContaining({
        id: ids.faculty,
        canAddDepartment: true,
        departments: [expect.objectContaining({ id: ids.department, programmeYears: 4, courseOfferingCount: 1, editable: true, canDeactivate: true })],
      })]);

      // Faculties: institution administrators only; codes are unique regardless of case.
      const scienceId = await service.createFaculty(institutionAdmin, { code: 'SCI', name: 'Faculty of Science' });
      await expect(service.createFaculty(institutionAdmin, { code: 'sci', name: 'Again' }))
        .rejects.toMatchObject({ statusCode: 409, name: 'StructureCodeTakenError' });
      await expect(service.createFaculty(facultyAdmin, { code: 'ART', name: 'Faculty of Arts' }))
        .rejects.toMatchObject({ statusCode: 403 });

      // Departments: a faculty administrator adds to their own faculty only.
      const physics = CreateDepartmentRequestSchema.parse({ facultyId: ids.faculty, code: 'phy', name: 'Physics' });
      expect(physics).toMatchObject({ code: 'PHY', programmeYears: 4 });
      const physicsId = await service.createDepartment(facultyAdmin, physics);
      await expect(service.createDepartment(facultyAdmin, { facultyId: scienceId, code: 'CHM', name: 'Chemistry', programmeYears: 4 }))
        .rejects.toMatchObject({ statusCode: 403 });
      // Department codes are unique across the institution, not just the faculty.
      await expect(service.createDepartment(institutionAdmin, { facultyId: scienceId, code: 'phy', name: 'Physics twin', programmeYears: 4 }))
        .rejects.toMatchObject({ statusCode: 409, name: 'StructureCodeTakenError' });

      // A department administrator may rename and set programme length, but not deactivate.
      await service.updateDepartment(departmentAdmin, ids.department, { name: 'Department of Testing', programmeYears: 5 });
      await expect(service.updateDepartment(departmentAdmin, ids.department, { isActive: false }))
        .rejects.toMatchObject({ statusCode: 403 });
      await expect(service.updateDepartment(departmentAdmin, physicsId, { name: 'Not mine at all' }))
        .rejects.toMatchObject({ statusCode: 403 });
      const departmentView = await service.getStructure(departmentAdmin);
      expect(departmentView.permissions).toEqual({ manageFaculties: false, manageSessions: false });
      expect(departmentView.faculties).toHaveLength(1);
      expect(departmentView.faculties[0]?.canAddDepartment).toBe(false);
      expect(departmentView.faculties[0]?.departments).toEqual([expect.objectContaining({
        id: ids.department,
        name: 'Department of Testing',
        programmeYears: 5,
        editable: true,
        canDeactivate: false,
      })]);

      // A faculty with active departments cannot be deactivated; deactivate departments first.
      await service.createDepartment(institutionAdmin, { facultyId: scienceId, code: 'CHM', name: 'Chemistry', programmeYears: 4 });
      await expect(service.updateFaculty(institutionAdmin, scienceId, { isActive: false }))
        .rejects.toMatchObject({ statusCode: 409, name: 'StructureFacultyInUseError' });
      const chemistry = (await service.getStructure(institutionAdmin)).faculties
        .find((faculty) => faculty.id === scienceId)?.departments[0];
      expect(chemistry?.code).toBe('CHM');
      await service.updateDepartment(institutionAdmin, chemistry!.id, { isActive: false });
      await service.updateFaculty(institutionAdmin, scienceId, { isActive: false });
      await expect(service.updateDepartment(institutionAdmin, chemistry!.id, { isActive: true }))
        .rejects.toMatchObject({ statusCode: 409, name: 'StructureFacultyInactiveError' });
      await expect(service.createDepartment(institutionAdmin, { facultyId: scienceId, code: 'BIO', name: 'Biology', programmeYears: 4 }))
        .rejects.toMatchObject({ statusCode: 404 });

      // Academic sessions: create the next one with semesters, then switch the current session.
      const next = CreateAcademicSessionRequestSchema.parse({
        code: '2027/2028',
        startsAt: '2027-09-01T00:00:00+01:00',
        endsAt: '2028-08-31T23:00:00+01:00',
        semesters: [
          { name: 'First Semester', startsAt: '2027-09-01T00:00:00+01:00', endsAt: '2028-01-31T23:00:00+01:00' },
          { name: 'Second Semester', startsAt: '2028-02-01T00:00:00+01:00', endsAt: '2028-07-31T23:00:00+01:00' },
        ],
      });
      await expect(service.createAcademicSession(facultyAdmin, next)).rejects.toMatchObject({ statusCode: 403 });
      const nextId = await service.createAcademicSession(institutionAdmin, next);
      await expect(service.createAcademicSession(institutionAdmin, next)).rejects.toMatchObject({ statusCode: 409 });
      await client.query('UPDATE academic_sessions SET is_current = true WHERE id = $1', [ids.academicSession]);
      await service.setCurrentSession(institutionAdmin, nextId);
      const sessions = (await service.getStructure(institutionAdmin)).academicSessions;
      expect(sessions.map((session) => [session.code, session.isCurrent])).toEqual([['2027/2028', true], ['2026/27', false]]);
      expect(sessions[0]?.semesters.map((semester) => semester.name)).toEqual(['First Semester', 'Second Semester']);

      // Every change is audited and the audit trail is append-only.
      const auditRows = await client.query<{ action: string; details: string }>(
        'SELECT action, details FROM structure_audit_events ORDER BY action',
      );
      expect(auditRows.rows.map((row) => row.action).sort()).toEqual([
        'academic_session_created',
        'academic_session_made_current',
        'department_created',
        'department_created',
        'department_updated',
        'department_updated',
        'faculty_created',
        'faculty_updated',
      ]);
      const rename = auditRows.rows.find((row) => row.details.includes('Department of Testing'));
      expect(JSON.parse(rename!.details)).toEqual({ name: ['Department', 'Department of Testing'], programmeYears: [4, 5] });
      await expect(client.query("UPDATE structure_audit_events SET action = 'x'")).rejects.toThrow(/append-only/);
      await expect(client.query('DELETE FROM structure_audit_events')).rejects.toThrow(/append-only/);
    } finally {
      await client.close();
    }
  }, 60_000);

  it('rejects overlapping semesters and mismatched session years', () => {
    const result = CreateAcademicSessionRequestSchema.safeParse({
      code: '2027/2029',
      startsAt: '2027-09-01T00:00:00+01:00',
      endsAt: '2028-08-31T23:00:00+01:00',
      semesters: [
        { name: 'First', startsAt: '2027-09-01T00:00:00+01:00', endsAt: '2028-02-15T00:00:00+01:00' },
        { name: 'Second', startsAt: '2028-02-01T00:00:00+01:00', endsAt: '2028-09-30T00:00:00+01:00' },
      ],
    });
    expect(result.success).toBe(false);
    const messages = result.error?.issues.map((issue) => issue.message) ?? [];
    expect(messages).toEqual(expect.arrayContaining([
      'The second year must follow the first, e.g. 2027/2028.',
      'Semesters must fall inside the session.',
      'Semesters must not overlap.',
    ]));
  });
});
