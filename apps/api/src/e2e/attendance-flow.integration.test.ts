import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { hashPassword } from '@lasuatos/auth';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { StudentAuthService } from '../auth/service.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import { CourseEnrollmentService } from '../enrollment/service.js';
import { PostgresCourseEnrollmentRepository } from '../enrollment/postgres-repository.js';
import { AttendanceService } from '../attendance/service.js';
import { PostgresAttendanceRepository } from '../attendance/postgres-repository.js';
import type { VerificationEmail } from '../email/transport.js';

/**
 * Full end-to-end flow over HTTP (Fastify inject) against embedded PostgreSQL:
 * lecturer sign-in → offering → course code → student registration → email
 * verification → enrollment → attendance session → check-in → roster → close
 * → history. Uses the same production wiring as apps/api/src/index.ts.
 */

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const migrationDirectory = path.join(repositoryRoot, 'packages/database/drizzle/migrations');

const ids = {
  institution: 'c1111111-1111-4111-8111-111111111111',
  faculty: 'c2222222-2222-4222-8222-222222222222',
  department: 'c3333333-3333-4333-8333-333333333333',
  academicSession: 'c4444444-4444-4444-8444-444444444444',
  semester: 'c5555555-5555-4555-8555-555555555555',
  lecturer: 'c6666666-6666-4666-8666-666666666666',
} as const;

const INSTITUTION_SLUG = 'e2e-demo';
const LECTURER_EMAIL = 'lecturer@e2e.invalid';
const LECTURER_PASSWORD = 'e2e-lecturer-passphrase';
const STUDENT_EMAIL = 'student@e2e.invalid';
const STUDENT_PASSWORD = 'e2e-student-passphrase';

async function applyMigrations(client: PGlite): Promise<void> {
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

async function seedLecturerFixture(client: PGlite): Promise<void> {
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

function sessionCookie(headers: Record<string, unknown>): string {
  const value = headers['set-cookie'];
  const match = /lasuatos_session=([A-Za-z0-9_-]{43})/.exec(String(Array.isArray(value) ? value[0] : value ?? ''));
  if (!match) throw new Error('Expected a lasuatos_session cookie on the response.');
  return `lasuatos_session=${match[1]}`;
}

function jsonBody(response: { body: string }): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

it('runs the complete lecturer→student attendance flow over HTTP', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    await seedLecturerFixture(client);

    const database = drizzle(client) as unknown as DatabaseClient;
    const sentVerificationEmails: VerificationEmail[] = [];
    const server = buildServer({
      logger: false,
      secureCookies: false,
      auth: new StudentAuthService({
        repository: new PostgresAuthRepository(database),
        emailTransport: {
          sendVerification: async (email) => {
            sentVerificationEmails.push(email);
          },
          sendPasswordReset: async () => undefined,
          sendSecurityNotice: async () => undefined,
        },
        institutionSlug: INSTITUTION_SLUG,
      }),
      courseEnrollment: new CourseEnrollmentService({
        repository: new PostgresCourseEnrollmentRepository(database),
      }),
      attendance: new AttendanceService({
        repository: new PostgresAttendanceRepository(database),
      }),
    });

    // 1. Lecturer signs in and creates a course offering with a join code.
    const lecturerLogin = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: LECTURER_EMAIL, password: LECTURER_PASSWORD },
    });
    expect(lecturerLogin.statusCode).toBe(200);
    const lecturerCookie = sessionCookie(lecturerLogin.headers);

    const offeringResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/lecturer/course-offerings',
      headers: { cookie: lecturerCookie },
      payload: {
        courseCode: 'ECE-201',
        courseTitle: 'Circuit Theory',
        creditUnits: 3,
        semesterId: ids.semester,
        level: '200',
      },
    });
    expect(offeringResponse.statusCode).toBe(201);
    const offering = (jsonBody(offeringResponse).course ?? {}) as Record<string, unknown>;
    const courseOfferingId = String(offering.courseOfferingId);
    expect(courseOfferingId).toMatch(/^[0-9a-f-]{36}$/);

    const joinCodeResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/lecturer/course-offerings/${courseOfferingId}/join-code`,
      headers: { cookie: lecturerCookie },
    });
    expect(joinCodeResponse.statusCode).toBe(200);
    const courseJoinCode = String(jsonBody(joinCodeResponse).code);
    expect(courseJoinCode).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);

    // 2. Student registers, confirms email through the captured link token, then enrolls.
    const registration = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        displayName: 'E2E Student',
        email: STUDENT_EMAIL,
        matricNumber: 'E2E-0001',
        password: STUDENT_PASSWORD,
      },
    });
    expect(registration.statusCode).toBe(202);
    expect(sentVerificationEmails).toHaveLength(1);
    const verification = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token: sentVerificationEmails[0]?.token },
    });
    expect(verification.statusCode).toBe(200);
    const studentCookie = sessionCookie(verification.headers);

    const joinResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/enrollments/join',
      headers: { cookie: studentCookie },
      payload: { code: courseJoinCode },
    });
    expect(joinResponse.statusCode).toBe(200);
    expect(jsonBody(joinResponse).status).toBe('enrolled');

    // 3. Lecturer opens an attendance session; the student checks in with the session code.
    const sessionResponse = await server.inject({
      method: 'POST',
      url: '/api/v1/lecturer/attendance-sessions',
      headers: { cookie: lecturerCookie },
      payload: { courseOfferingId, title: 'Week 4 Lecture', durationMinutes: 60 },
    });
    expect(sessionResponse.statusCode).toBe(201);
    const created = jsonBody(sessionResponse);
    const sessionCode = String(created.code);
    const sessionId = String((created.session as Record<string, unknown>).id);
    expect(sessionCode).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);

    // Codes are distinct credentials: the course join code is not an attendance code.
    const wrongCredential = await server.inject({
      method: 'POST',
      url: '/api/v1/student/attendance/check-in',
      headers: { cookie: studentCookie },
      payload: { code: courseJoinCode },
    });
    expect(wrongCredential.statusCode).toBe(400);

    const checkIn = await server.inject({
      method: 'POST',
      url: '/api/v1/student/attendance/check-in',
      headers: { cookie: studentCookie },
      payload: { code: sessionCode },
    });
    expect(checkIn.statusCode).toBe(200);
    expect(jsonBody(checkIn).status).toBe('checked_in');

    // Case/spacing are normalized exactly like the web client path.
    const normalizedRetry = await server.inject({
      method: 'POST',
      url: '/api/v1/student/attendance/check-in',
      headers: { cookie: studentCookie },
      payload: { code: sessionCode.toLowerCase() },
    });
    expect(normalizedRetry.statusCode).toBe(200);
    expect(jsonBody(normalizedRetry).status).toBe('already_checked_in');

    // 4. Students see currently open sessions for enrolled courses (never the code).
    const openSessions = await server.inject({
      method: 'GET',
      url: '/api/v1/student/attendance/open',
      headers: { cookie: studentCookie },
    });
    expect(openSessions.statusCode).toBe(200);
    const openList = jsonBody(openSessions).sessions as Array<Record<string, unknown>>;
    expect(openList).toHaveLength(1);
    expect(openList[0]?.sessionTitle).toBe('Week 4 Lecture');
    expect(openList[0]?.courseCode).toBe('ECE-201');

    // 5. A verified student who never enrolled cannot check in while the session is open.
    await server.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: {
        displayName: 'Unenrolled Student',
        email: 'unenrolled@e2e.invalid',
        matricNumber: 'E2E-0002',
        password: STUDENT_PASSWORD,
      },
    });
    expect(sentVerificationEmails).toHaveLength(2);
    const unenrolledVerification = await server.inject({
      method: 'POST',
      url: '/api/v1/auth/verify-email',
      payload: { token: sentVerificationEmails[1]?.token },
    });
    const unenrolledCookie = sessionCookie(unenrolledVerification.headers);
    const unenrolledCheckIn = await server.inject({
      method: 'POST',
      url: '/api/v1/student/attendance/check-in',
      headers: { cookie: unenrolledCookie },
      payload: { code: sessionCode },
    });
    expect(unenrolledCheckIn.statusCode).toBe(403);

    // The unenrolled student does not see another course's open session either.
    const unenrolledOpen = await server.inject({
      method: 'GET',
      url: '/api/v1/student/attendance/open',
      headers: { cookie: unenrolledCookie },
    });
    expect(unenrolledOpen.statusCode).toBe(200);
    expect(jsonBody(unenrolledOpen).sessions).toEqual([]);

    // 6. Lecturer sees the roster over HTTP; student history shows the record.
    const detail = await server.inject({
      method: 'GET',
      url: `/api/v1/lecturer/attendance-sessions/${sessionId}`,
      headers: { cookie: lecturerCookie },
    });
    expect(detail.statusCode).toBe(200);
    const attendees = jsonBody(detail).attendees as Array<Record<string, unknown>>;
    expect(attendees).toHaveLength(1);
    expect(attendees[0]?.displayName).toBe('E2E Student');

    const closeResponse = await server.inject({
      method: 'POST',
      url: `/api/v1/lecturer/attendance-sessions/${sessionId}/close`,
      headers: { cookie: lecturerCookie },
    });
    expect(closeResponse.statusCode).toBe(200);
    expect(jsonBody(closeResponse).status).toBe('closed');

    // Once closed, the session no longer appears in the student's open list.
    const closedOpenSessions = await server.inject({
      method: 'GET',
      url: '/api/v1/student/attendance/open',
      headers: { cookie: studentCookie },
    });
    expect(jsonBody(closedOpenSessions).sessions).toEqual([]);

    const history = await server.inject({
      method: 'GET',
      url: '/api/v1/student/attendance',
      headers: { cookie: studentCookie },
    });
    expect(history.statusCode).toBe(200);
    const records = jsonBody(history).records as Array<Record<string, unknown>>;
    expect(records).toHaveLength(1);
    expect(records[0]?.courseCode).toBe('ECE-201');
    expect(records[0]?.sessionTitle).toBe('Week 4 Lecture');

    await server.close();
  } finally {
    await client.close();
  }
}, 60_000);
