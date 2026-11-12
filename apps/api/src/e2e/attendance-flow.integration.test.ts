import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
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
import {
  INSTITUTION_SLUG,
  LECTURER_EMAIL,
  LECTURER_PASSWORD,
  STUDENT_EMAIL,
  STUDENT_PASSWORD,
  applyMigrations,
  ids,
  jsonBody,
  seedLecturerFixture,
  sessionCookie,
} from './harness.js';

/**
 * Full end-to-end flow over HTTP (Fastify inject) against embedded PostgreSQL:
 * lecturer sign-in → offering → course code → student registration → email
 * verification → enrollment → attendance session → check-in → roster → close
 * → history. Uses the same production wiring as apps/api/src/index.ts.
 */

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
          sendStaffInvitation: async () => undefined,
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
        matricNumber: '240591001',
        password: STUDENT_PASSWORD,
        entryLevel: 200,
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

    // The level is read from the matric number's entry year plus the declared entry level.
    const profileResponse = await server.inject({
      method: 'GET',
      url: '/api/v1/student/profile',
      headers: { cookie: studentCookie },
    });
    expect(profileResponse.statusCode).toBe(200);
    const profile = jsonBody(profileResponse);
    expect(profile).toMatchObject({ matricNumber: '240591001', matricRecognized: true, entryYear: 2024, entryLevel: 200 });
    expect(['derived', 'extra_year']).toContain(profile.levelStatus);
    const entryLevelUpdate = await server.inject({
      method: 'POST',
      url: '/api/v1/student/profile/entry-level',
      headers: { cookie: studentCookie },
      payload: { entryLevel: 100 },
    });
    expect(entryLevelUpdate.statusCode).toBe(200);
    expect(jsonBody(entryLevelUpdate).entryLevel).toBe(100);
    const departmentOptions = await server.inject({
      method: 'GET',
      url: '/api/v1/student/profile/departments',
      headers: { cookie: studentCookie },
    });
    expect(departmentOptions.statusCode).toBe(200);
    const firstDepartment = (jsonBody(departmentOptions).departments as Array<Record<string, unknown>>)[0];
    expect(firstDepartment).toBeDefined();
    const departmentUpdate = await server.inject({
      method: 'POST',
      url: '/api/v1/student/profile/department',
      headers: { cookie: studentCookie },
      payload: { departmentId: firstDepartment?.id },
    });
    expect(departmentUpdate.statusCode).toBe(200);
    expect(jsonBody(departmentUpdate)).toMatchObject({ departmentId: firstDepartment?.id, departmentName: firstDepartment?.name });
    const unknownDepartment = await server.inject({
      method: 'POST',
      url: '/api/v1/student/profile/department',
      headers: { cookie: studentCookie },
      payload: { departmentId: '00000000-0000-4000-8000-000000000000' },
    });
    expect(unknownDepartment.statusCode).toBe(404);

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

    // QR-only: the lecturer switches typed codes off; the projected challenge still works.
    const qrOnly = await server.inject({
      method: 'POST',
      url: `/api/v1/lecturer/attendance-sessions/${sessionId}/settings`,
      headers: { cookie: lecturerCookie },
      payload: { qrOnly: true },
    });
    expect(qrOnly.statusCode).toBe(200);
    expect((jsonBody(qrOnly).session as Record<string, unknown>).qrOnly).toBe(true);
    const qrResponse = await server.inject({
      method: 'GET',
      url: `/api/v1/lecturer/attendance-sessions/${sessionId}/qr`,
      headers: { cookie: lecturerCookie },
    });
    expect(qrResponse.statusCode).toBe(200);
    const challenge = String(jsonBody(qrResponse).challenge);
    const scanned = await server.inject({
      method: 'POST',
      url: '/api/v1/student/attendance/check-in',
      headers: { cookie: studentCookie },
      payload: { challenge, deviceToken: 'e2e-device-token-0001' },
    });
    expect(scanned.statusCode).toBe(200);
    expect(jsonBody(scanned).status).toBe('already_checked_in');
    const qrOff = await server.inject({
      method: 'POST',
      url: `/api/v1/lecturer/attendance-sessions/${sessionId}/settings`,
      headers: { cookie: lecturerCookie },
      payload: { qrOnly: false },
    });
    expect(qrOff.statusCode).toBe(200);

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
    expect(attendees[0]?.studentNumber).toBe('240591001');
    expect(String(attendees[0]?.levelLabel)).toMatch(/Level/);
    expect(attendees[0]?.sharedDevice).toBe(false);

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
