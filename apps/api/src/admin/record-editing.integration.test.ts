import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { DatabaseClient } from '@lasuatos/database';
import { UpdateAcademicSessionRequestSchema } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import { applyMigrations, ids, seedAttendanceFixture } from '../attendance/integration-fixture.js';
import { CourseEnrollmentService } from '../enrollment/service.js';
import { PostgresCourseEnrollmentRepository } from '../enrollment/postgres-repository.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import { PostgresStaffRepository } from '../staff/postgres-repository.js';
import { StaffService } from '../staff/service.js';
import { PostgresVenueRepository } from '../venue/postgres-repository.js';
import { VenueService } from '../venue/service.js';
import { PostgresStructureRepository } from './structure-postgres-repository.js';
import { StructureService } from './structure-service.js';

/**
 * Corrections to records that could previously only be created: academic
 * sessions and their semesters, course offerings, venues, buildings and staff
 * details. Each edit is checked for scope, conflicts and its audit trail.
 */

const ADMIN_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const CAMPUS_ID = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
const SECOND_LECTURER = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2';

const institutionAdmin: AdministratorSessionAccount = {
  accountType: 'administrator',
  id: ADMIN_ID,
  email: 'admin@test.invalid',
  displayName: 'Admin',
  emailVerified: true,
  institutionId: ids.institution,
  institutionName: 'Demo Test',
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
  role: 'institution_administrator',
  scope: { type: 'institution', id: ids.institution, label: 'Demo Test', institutionId: ids.institution },
};
const departmentAdmin: AdministratorSessionAccount = {
  ...institutionAdmin,
  role: 'department_administrator',
  scope: { type: 'department', id: ids.department, label: 'Department', facultyName: 'Faculty', institutionId: ids.institution },
};

async function setup() {
  const client = new PGlite();
  await applyMigrations(client);
  await seedAttendanceFixture(client, new Date('2026-11-02T09:00:00.000Z'));
  await client.query(
    `INSERT INTO users (id, institution_id, email, display_name, status, email_verified_at)
     VALUES ($1, $2, 'admin@test.invalid', 'Admin', 'active', now()), ($3, $2, 'second@test.invalid', 'Second Lecturer', 'active', now())`,
    [ADMIN_ID, ids.institution, SECOND_LECTURER],
  );
  await client.query(
    `INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, 'institution_administrator', 'institution', $2)`,
    [ADMIN_ID, ids.institution],
  );
  await client.query(
    `INSERT INTO lecturer_profiles (user_id, institution_id, department_id, staff_number) VALUES ($1, $2, $3, 'STAFF-2')`,
    [SECOND_LECTURER, ids.institution, ids.department],
  );
  await client.query(
    `INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id, department_id) VALUES ($1, 'lecturer', 'department', $2, $3)`,
    [SECOND_LECTURER, ids.institution, ids.department],
  );
  await client.query(`INSERT INTO campuses (id, institution_id, code, name) VALUES ($1, $2, 'MAIN', 'Main Campus')`, [CAMPUS_ID, ids.institution]);
  const database = drizzle(client) as unknown as DatabaseClient;
  const audit = async (targetType: string) => (await client.query<{ action: string; details: string }>(
    'SELECT action, details FROM structure_audit_events WHERE target_type = $1 ORDER BY created_at',
    [targetType],
  )).rows;
  return { client, database, audit };
}

describe('editing existing records', () => {
  it('corrects an academic session, swaps semester names and adds a semester', async () => {
    const { client, database, audit } = await setup();
    try {
      const service = new StructureService({ repository: new PostgresStructureRepository(database) });
      const otherId = await service.createAcademicSession(institutionAdmin, {
        code: '2027/2028', startsAt: '2027-09-01T00:00:00Z', endsAt: '2028-08-31T00:00:00Z', makeCurrent: false,
        semesters: [{ name: 'First', startsAt: '2027-09-01T00:00:00Z', endsAt: '2028-01-31T00:00:00Z' }],
      });

      // Add a second semester, then swap the two names in one save.
      const withSecond = UpdateAcademicSessionRequestSchema.parse({
        code: '2026/2027', startsAt: '2026-09-01T00:00:00Z', endsAt: '2027-08-31T23:00:00Z',
        semesters: [
          { id: ids.semester, name: 'First', startsAt: '2026-09-01T00:00:00Z', endsAt: '2027-01-31T23:00:00Z' },
          { name: 'Second', startsAt: '2027-02-15T00:00:00Z', endsAt: '2027-07-31T00:00:00Z' },
        ],
      });
      await service.updateAcademicSession(institutionAdmin, ids.academicSession, withSecond);
      let snapshot = (await service.getStructure(institutionAdmin)).academicSessions.find((item) => item.id === ids.academicSession)!;
      expect(snapshot.code).toBe('2026/2027');
      expect(snapshot.semesters.map((semester) => semester.name)).toEqual(['First', 'Second']);
      const secondId = snapshot.semesters.find((semester) => semester.name === 'Second')!.id;

      await service.updateAcademicSession(institutionAdmin, ids.academicSession, {
        code: '2026/2027', startsAt: '2026-09-01T00:00:00Z', endsAt: '2027-08-31T23:00:00Z',
        semesters: [
          { id: ids.semester, name: 'Harmattan', startsAt: '2026-09-01T00:00:00Z', endsAt: '2027-01-31T23:00:00Z' },
          { id: secondId, name: 'First', startsAt: '2027-02-15T00:00:00Z', endsAt: '2027-07-31T00:00:00Z' },
        ],
      });
      snapshot = (await service.getStructure(institutionAdmin)).academicSessions.find((item) => item.id === ids.academicSession)!;
      expect(snapshot.semesters.map((semester) => semester.name)).toEqual(['Harmattan', 'First']);

      // A semester cannot be dropped (offerings point at it), codes stay unique, and only institution admins edit.
      await expect(service.updateAcademicSession(institutionAdmin, ids.academicSession, {
        code: '2026/2027', startsAt: '2026-09-01T00:00:00Z', endsAt: '2027-08-31T23:00:00Z',
        semesters: [{ id: secondId, name: 'Only', startsAt: '2027-02-15T00:00:00Z', endsAt: '2027-07-31T00:00:00Z' }],
      })).rejects.toMatchObject({ statusCode: 409, name: 'StructureSemesterRemovedError' });
      await expect(service.updateAcademicSession(institutionAdmin, otherId, {
        code: '2026/2027', startsAt: '2027-09-01T00:00:00Z', endsAt: '2028-08-31T00:00:00Z',
        semesters: [{ name: 'Extra', startsAt: '2027-09-01T00:00:00Z', endsAt: '2027-12-31T00:00:00Z' }],
      })).rejects.toMatchObject({ statusCode: 409 });
      await expect(service.updateAcademicSession(departmentAdmin, ids.academicSession, withSecond)).rejects.toMatchObject({ statusCode: 403 });

      // Overlapping or out-of-range semesters are rejected before reaching the service.
      expect(UpdateAcademicSessionRequestSchema.safeParse({
        code: '2026/2027', startsAt: '2026-09-01T00:00:00Z', endsAt: '2027-08-31T23:00:00Z',
        semesters: [
          { id: ids.semester, name: 'A', startsAt: '2026-09-01T00:00:00Z', endsAt: '2027-03-01T00:00:00Z' },
          { name: 'B', startsAt: '2027-02-01T00:00:00Z', endsAt: '2027-07-01T00:00:00Z' },
        ],
      }).success).toBe(false);

      const events = await audit('academic_session');
      expect(events.filter((event) => event.action === 'academic_session_updated')).toHaveLength(2);
      expect(JSON.parse(events.at(-1)!.details)).toMatchObject({ semesters: [{ id: ids.semester, name: ['First', 'Harmattan'] }, { id: secondId, name: ['Second', 'First'] }] });
    } finally {
      await client.close();
    }
  });

  it('lets the assigned lecturer correct a course offering', async () => {
    const { client, database } = await setup();
    try {
      const service = new CourseEnrollmentService({
        repository: new PostgresCourseEnrollmentRepository(database),
        now: () => new Date('2026-11-02T09:00:00.000Z'),
      });
      const updated = await service.updateCourseOffering(ids.lecturer, ids.offering, { courseTitle: ' Demo   Course  II ', creditUnits: 2, level: '200' });
      expect(updated).toMatchObject({ courseCode: 'DEMO-101', courseTitle: 'Demo Course II', creditUnits: 2, level: '200' });
      // Another lecturer, or a student, cannot touch it.
      await expect(service.updateCourseOffering(SECOND_LECTURER, ids.offering, { level: '300' })).rejects.toMatchObject({ statusCode: 404 });
      await expect(service.updateCourseOffering(ids.student, ids.offering, { level: '300' })).rejects.toMatchObject({ statusCode: 404 });

      // Moving to a level where the same course is already offered is refused.
      await client.query(
        `INSERT INTO course_offerings (institution_id, course_id, department_id, semester_id, level) VALUES ($1, $2, $3, $4, '300')`,
        [ids.institution, ids.course, ids.department, ids.semester],
      );
      await expect(service.updateCourseOffering(ids.lecturer, ids.offering, { level: '300' })).rejects.toMatchObject({ statusCode: 409 });
    } finally {
      await client.close();
    }
  });

  it('corrects venues and buildings with an audit trail', async () => {
    const { client, database, audit } = await setup();
    try {
      const service = new VenueService({ repository: new PostgresVenueRepository(database) });
      const building = await service.createBuilding(institutionAdmin, { campusId: CAMPUS_ID, code: 'ENG', name: 'Engineering' });
      await service.createBuilding(institutionAdmin, { campusId: CAMPUS_ID, code: 'SCI', name: 'Science' });
      const venue = await service.createVenue(institutionAdmin, { campusId: CAMPUS_ID, code: 'LT1', name: 'Lecture Theatre', venueType: 'lecture_theatre', locationRequired: true });
      await service.createVenue(institutionAdmin, { campusId: CAMPUS_ID, code: 'LT2', name: 'Other Theatre', venueType: 'lecture_theatre', locationRequired: true });

      const updated = await service.updateVenue(institutionAdmin, venue.id, {
        name: ' Lecture Theatre 1 ', code: 'lt-01', buildingId: building.id, capacity: 450, floorLabel: ' ', sectionLabel: 'North wing',
      });
      expect(updated).toMatchObject({ name: 'Lecture Theatre 1', code: 'LT-01', buildingId: building.id, buildingName: 'Engineering', capacity: 450, floorLabel: null, sectionLabel: 'North wing' });
      const cleared = await service.updateVenue(institutionAdmin, venue.id, { buildingId: null, capacity: null });
      expect(cleared).toMatchObject({ buildingId: null, capacity: null });
      await expect(service.updateVenue(institutionAdmin, venue.id, { code: 'LT2' })).rejects.toMatchObject({ statusCode: 409 });
      await expect(service.updateVenue(institutionAdmin, venue.id, { buildingId: 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0' })).rejects.toMatchObject({ statusCode: 404 });
      await expect(service.updateVenue(departmentAdmin, venue.id, { name: 'Mine now' })).rejects.toMatchObject({ statusCode: 403 });

      const renamed = await service.updateBuilding(institutionAdmin, building.id, { name: 'Faculty of Engineering Complex', code: 'feng' });
      expect(renamed).toMatchObject({ code: 'FENG', name: 'Faculty of Engineering Complex' });
      await expect(service.updateBuilding(institutionAdmin, building.id, { code: 'SCI' })).rejects.toMatchObject({ statusCode: 409 });

      const venueEvents = await audit('venue');
      expect(venueEvents.map((event) => event.action)).toEqual(['venue_updated', 'venue_updated']);
      expect(JSON.parse(venueEvents[0]!.details)).toMatchObject({ code: ['LT1', 'LT-01'], capacity: [null, 450] });
      expect((await audit('building')).map((event) => event.action)).toEqual(['building_updated']);
    } finally {
      await client.close();
    }
  });

  it('corrects staff names and staff numbers', async () => {
    const { client, database } = await setup();
    try {
      const repository = new PostgresStaffRepository(database);
      const service = new StaffService({ repository, authRepository: new PostgresAuthRepository(database) });
      await service.updateMember(institutionAdmin, ids.lecturer, { displayName: 'Dr. Test Lecturer', staffNumber: 'LASU/0042' });
      const member = await repository.findMember(ids.institution, ids.lecturer);
      expect(member).toMatchObject({ displayName: 'Dr. Test Lecturer', staffNumber: 'LASU/0042' });
      await expect(service.updateMember(institutionAdmin, ids.lecturer, { staffNumber: 'STAFF-2' })).rejects.toMatchObject({ statusCode: 409 });
      // Administrators have no staff number; unknown people are not found.
      await expect(service.updateMember(institutionAdmin, ADMIN_ID, { staffNumber: 'X-1' })).rejects.toMatchObject({ statusCode: 400 });
      await expect(service.updateMember(institutionAdmin, ids.student, { displayName: 'Not staff' })).rejects.toMatchObject({ statusCode: 404 });
      const events = (await client.query<{ action: string; reason: string }>(
        `SELECT action, reason FROM staff_audit_events WHERE target_user_id = $1`,
        [ids.lecturer],
      )).rows;
      expect(events).toEqual([{ action: 'staff_updated', reason: 'Name: Test Lecturer → Dr. Test Lecturer; Staff number: STAFF-1 → LASU/0042' }]);
    } finally {
      await client.close();
    }
  });
});
