/**
 * Shared embedded-PostgreSQL (PGlite) fixture for attendance integration
 * tests: applies every migration in order and seeds a synthetic tenant.
 * Test support only; never imported by application code.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const migrationDirectory = path.join(repositoryRoot, 'packages/database/drizzle/migrations');
export const ids = {
  institution: '11111111-1111-4111-8111-111111111111',
  faculty: '22222222-2222-4222-8222-222222222222',
  department: '33333333-3333-4333-8333-333333333333',
  academicSession: '44444444-4444-4444-8444-444444444444',
  semester: '55555555-5555-4555-8555-555555555555',
  course: '66666666-6666-4666-8666-666666666666',
  offering: '77777777-7777-4777-8777-777777777777',
  lecturer: '88888888-8888-4888-8888-888888888888',
  student: '99999999-9999-4999-8999-999999999999',
  notEnrolled: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  unassignedLecturer: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  coLecturer: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  lateStudent: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
} as const;

export async function applyMigrations(client: PGlite) {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const migration = await readFile(path.join(migrationDirectory, file), 'utf8');
    const statements = migration
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await client.exec(statement);
  }
}

export async function seedAttendanceFixture(client: PGlite, now: Date) {
  await client.query('INSERT INTO institutions (id, slug, name) VALUES ($1, $2, $3)', [
    ids.institution,
    'demo-test',
    'Demo Test',
  ]);
  await client.query(
    'INSERT INTO faculties (id, institution_id, code, name) VALUES ($1, $2, $3, $4)',
    [ids.faculty, ids.institution, 'F1', 'Faculty'],
  );
  await client.query(
    'INSERT INTO departments (id, institution_id, faculty_id, code, name) VALUES ($1, $2, $3, $4, $5)',
    [ids.department, ids.institution, ids.faculty, 'D1', 'Department'],
  );
  await client.query(
    'INSERT INTO academic_sessions (id, institution_id, code, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5)',
    [ids.academicSession, ids.institution, '2026/27', '2026-09-01T00:00:00Z', '2027-08-31T23:00:00Z'],
  );
  await client.query(
    'INSERT INTO semesters (id, institution_id, academic_session_id, name, starts_at, ends_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [ids.semester, ids.institution, ids.academicSession, 'First', '2026-09-01T00:00:00Z', '2027-01-31T23:00:00Z'],
  );
  await client.query(
    'INSERT INTO users (id, institution_id, email, display_name, status, email_verified_at) VALUES ($1, $2, $3, $4, $5, $6), ($7, $2, $8, $9, $5, $6), ($10, $2, $11, $12, $5, $6)',
    [
      ids.lecturer,
      ids.institution,
      'lecturer@test.invalid',
      'Test Lecturer',
      'active',
      now,
      ids.student,
      'student@test.invalid',
      'Test Student',
      ids.notEnrolled,
      'other@test.invalid',
      'Other Student',
    ],
  );
  await client.query(
    'INSERT INTO lecturer_profiles (user_id, institution_id, department_id, staff_number) VALUES ($1, $2, $3, $4)',
    [ids.lecturer, ids.institution, ids.department, 'STAFF-1'],
  );
  await client.query(
    'INSERT INTO student_profiles (user_id, institution_id, department_id, student_number) VALUES ($1, $2, $3, $4), ($5, $2, $3, $6)',
    [ids.student, ids.institution, ids.department, 'STUDENT-1', ids.notEnrolled, 'STUDENT-2'],
  );
  await client.query(
    'INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id, department_id) VALUES ($1, $2, $3, $4, $5)',
    [ids.lecturer, 'lecturer', 'department', ids.institution, ids.department],
  );
  await client.query(
    'INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, $2, $3, $4), ($5, $2, $3, $4)',
    [ids.student, 'student', 'institution', ids.institution, ids.notEnrolled],
  );
  await client.query(
    'INSERT INTO courses (id, institution_id, code, title, credit_units) VALUES ($1, $2, $3, $4, $5)',
    [ids.course, ids.institution, 'DEMO-101', 'Demo Course', 3],
  );
  await client.query(
    'INSERT INTO course_offerings (id, institution_id, course_id, department_id, semester_id, level) VALUES ($1, $2, $3, $4, $5, $6)',
    [ids.offering, ids.institution, ids.course, ids.department, ids.semester, '100'],
  );
  await client.query(
    'INSERT INTO course_assignments (institution_id, course_offering_id, lecturer_user_id, assignment_type) VALUES ($1, $2, $3, $4)',
    [ids.institution, ids.offering, ids.lecturer, 'lecturer'],
  );
  await client.query(
    'INSERT INTO course_enrollments (institution_id, course_offering_id, student_user_id, status) VALUES ($1, $2, $3, $4)',
    [ids.institution, ids.offering, ids.student, 'active'],
  );
}

