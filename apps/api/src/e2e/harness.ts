import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PGlite } from '@electric-sql/pglite';
import { hashPassword } from '@lasuatos/auth';

/** Shared embedded-PostgreSQL fixtures for the HTTP integration tests. */

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const migrationDirectory = path.join(repositoryRoot, 'packages/database/drizzle/migrations');

export const ids = {
  institution: 'c1111111-1111-4111-8111-111111111111',
  faculty: 'c2222222-2222-4222-8222-222222222222',
  department: 'c3333333-3333-4333-8333-333333333333',
  academicSession: 'c4444444-4444-4444-8444-444444444444',
  semester: 'c5555555-5555-4555-8555-555555555555',
  lecturer: 'c6666666-6666-4666-8666-666666666666',
} as const;

export const INSTITUTION_SLUG = 'e2e-demo';
export const LECTURER_EMAIL = 'lecturer@e2e.invalid';
export const LECTURER_PASSWORD = 'e2e-lecturer-passphrase';
export const STUDENT_EMAIL = 'student@e2e.invalid';
export const STUDENT_PASSWORD = 'e2e-student-passphrase';

export async function applyMigrations(client: PGlite): Promise<void> {
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

export async function seedLecturerFixture(client: PGlite): Promise<void> {
  await client.query('INSERT INTO institutions (id, slug, name) VALUES ($1, $2, $3)', [
    ids.institution,
    INSTITUTION_SLUG,
    'E2E Demo Institution',
  ]);
  await client.query(
    'INSERT INTO faculties (id, institution_id, code, name) VALUES ($1, $2, $3, $4)',
    [ids.faculty, ids.institution, 'ENG', 'Faculty of Engineering'],
  );
  await client.query(
    'INSERT INTO departments (id, institution_id, faculty_id, code, name) VALUES ($1, $2, $3, $4, $5)',
    [ids.department, ids.institution, ids.faculty, 'ECE', 'Electronic and Computer Engineering'],
  );
  await client.query(
    `INSERT INTO academic_sessions (id, institution_id, code, starts_at, ends_at)
     VALUES ($1, $2, $3, CURRENT_TIMESTAMP - interval '60 days', CURRENT_TIMESTAMP + interval '300 days')`,
    [ids.academicSession, ids.institution, '2026/27'],
  );
  await client.query(
    `INSERT INTO semesters (id, institution_id, academic_session_id, name, starts_at, ends_at)
     VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP - interval '30 days', CURRENT_TIMESTAMP + interval '90 days')`,
    [ids.semester, ids.institution, ids.academicSession, 'First Semester'],
  );
  await client.query(
    `INSERT INTO users (id, institution_id, email, display_name, password_hash, status, email_verified_at)
     VALUES ($1, $2, $3, $4, $5, 'active', CURRENT_TIMESTAMP)`,
    [ids.lecturer, ids.institution, LECTURER_EMAIL, 'E2E Lecturer', await hashPassword(LECTURER_PASSWORD)],
  );
  await client.query(
    'INSERT INTO lecturer_profiles (user_id, institution_id, department_id, staff_number) VALUES ($1, $2, $3, $4)',
    [ids.lecturer, ids.institution, ids.department, 'E2E-STAFF-1'],
  );
  await client.query(
    'INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id, department_id) VALUES ($1, $2, $3, $4, $5)',
    [ids.lecturer, 'lecturer', 'department', ids.institution, ids.department],
  );
}

export function sessionCookie(headers: Record<string, unknown>): string {
  const value = headers['set-cookie'];
  const match = /lasuatos_session=([A-Za-z0-9_-]{43})/.exec(String(Array.isArray(value) ? value[0] : value ?? ''));
  if (!match) throw new Error('Expected a lasuatos_session cookie on the response.');
  return `lasuatos_session=${match[1]}`;
}

export function jsonBody(response: { body: string }): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}
