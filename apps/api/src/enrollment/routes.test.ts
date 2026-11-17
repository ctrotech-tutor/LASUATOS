import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CourseOfferingSummary } from '@lasuatos/contracts';
import { buildServer } from '../server.js';
import type { AuthRouteService } from '../auth/routes.js';
import type { LecturerSessionAccount, StudentSessionAccount } from '../auth/repository.js';
import type { CourseEnrollmentRouteOptions } from './routes.js';

const sessionToken = 's'.repeat(43);
const semesterId = '3d9f7a67-15f6-46e3-a849-00aa1c509822';
const student: StudentSessionAccount = {
  accountType: 'student',
  id: 'a938d6d9-5f40-45c9-876e-4f971acbb79a',
  email: 'student@example.net',
  displayName: 'Example Student',
  matricNumber: '00000001',
  matricNumberVerified: false,
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
};
const lecturer: LecturerSessionAccount = {
  accountType: 'lecturer',
  id: 'c19ca6fe-1355-4ed7-a54d-2b6bb11824fe',
  email: 'lecturer@example.net',
  displayName: 'Example Lecturer',
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
};
const course: CourseOfferingSummary = {
  courseOfferingId: 'b3aa9508-2ead-444c-8b8f-3051fe8d14df',
  courseCode: 'DEMO-101',
  courseTitle: 'Demonstration course',
  departmentName: 'Demonstration department',
  semesterName: 'Demonstration semester',
  level: '100',
  semesterEndsAt: '2027-04-30T23:59:59.000Z',
};

const servers: ReturnType<typeof buildServer>[] = [];

function createAuth(account: StudentSessionAccount | LecturerSessionAccount = student): AuthRouteService {
  return {
    registerStudent: vi.fn(async () => ({ token: sessionToken, student })),
    resendVerification: vi.fn(async () => undefined),
    verifyEmail: vi.fn(async () => ({ token: sessionToken, student })),
    login: vi.fn(async () => ({ token: sessionToken, account })),
    getSession: vi.fn(async () => account),
    logout: vi.fn(async () => undefined),
    requestPasswordReset: vi.fn(async () => undefined),
    completePasswordReset: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => 0),
    listSessions: vi.fn(async () => []),
    revokeOtherSessions: vi.fn(async () => 0),
  };
}

function createEnrollment(): NonNullable<CourseEnrollmentRouteOptions['enrollment']> {
  return {
    listAvailableSemesters: vi.fn(async () => [{
      id: semesterId,
      name: 'Demonstration semester',
      startsAt: new Date('2026-09-01T00:00:00.000Z'),
      endsAt: new Date(course.semesterEndsAt),
    }]),
    createCourseOffering: vi.fn(async () => ({
      status: 'created' as const,
      course: { ...course, semesterEndsAt: new Date(course.semesterEndsAt) },
    })),
    listLecturerOfferings: vi.fn(async () => [{
      ...course,
      semesterEndsAt: new Date(course.semesterEndsAt),
      joinCodeActive: true,
      joinCodeIssuedAt: new Date('2026-10-02T09:30:00.000Z'),
      creditUnits: 3,
      semesterStartsAt: new Date('2026-09-01T00:00:00.000Z'),
      students: 41,
      sessions: 6,
      openDisputes: 1,
      canEditCourse: true,
    }]),
    updateCourseOffering: vi.fn(async () => ({
      ...course,
      courseTitle: 'Corrected title',
      semesterEndsAt: new Date(course.semesterEndsAt),
      joinCodeActive: false,
      creditUnits: 2,
      joinCodeIssuedAt: null,
      semesterStartsAt: new Date('2026-09-01T00:00:00.000Z'),
      students: 0,
      sessions: 0,
      openDisputes: 0,
      canEditCourse: false,
    })),
    issueJoinCode: vi.fn(async () => ({
      code: 'ABCDEFGHJK23',
      expiresAt: new Date(course.semesterEndsAt),
      rotated: true,
    })),
    revokeJoinCode: vi.fn(async () => undefined),
    joinWithCode: vi.fn(async () => ({ status: 'enrolled' as const, course: {
      ...course,
      semesterEndsAt: new Date(course.semesterEndsAt),
    } })),
    listStudentEnrollments: vi.fn(async () => [{
      ...course,
      semesterEndsAt: new Date(course.semesterEndsAt),
      enrolledAt: new Date('2026-11-11T12:00:00.000Z'),
    }]),
    getStudentAcademicProfile: vi.fn(async () => academicProfile),
  };
}

const academicProfile = {
  matricNumber: '240591001',
  matricNumberVerified: false,
  matricRecognized: true,
  departmentId: null,
  departmentName: null,
  programmeYears: 4,
  entryYear: 2024,
  entryLevel: 100 as const,
  sessionLabel: '2026/2027',
  yearOfStudy: 3,
  level: 300,
  levelStatus: 'derived' as const,
  levelLabel: '300 Level',
  onClassList: true,
  setLabel: '2024/2025 set',
  classReps: [{ name: 'Ada Obi', role: 'hoc' as const }],
};

function createServer(
  auth: AuthRouteService = createAuth(),
  enrollment = createEnrollment(),
) {
  const server = buildServer({ logger: false, auth, courseEnrollment: enrollment });
  servers.push(server);
  return { server, enrollment };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('course enrollment routes', () => {
  it('requires an authenticated student for code redemption', async () => {
    const { server } = createServer();
    const response = await server.inject({ method: 'POST', url: '/api/v1/enrollments/join', payload: { code: 'ABCDEFGHJK23' } });
    expect(response.statusCode).toBe(401);
  });

  it('accepts a lecturer-issued code for self-enrollment without an approval route', async () => {
    const { server, enrollment } = createServer();
    const response = await server.inject({
      method: 'POST',
      url: '/api/v1/enrollments/join',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
      payload: { code: 'abcd-efgh-jk23' },
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).toEqual({ status: 'enrolled', course });
    expect(enrollment.joinWithCode).toHaveBeenCalledWith(student.id, 'ABCDEFGHJK23');
  });

  it('rejects lecturers from student enrollment and lists only the requesting student records', async () => {
    const lecturerServer = createServer(createAuth(lecturer));
    const deniedJoin = await lecturerServer.server.inject({
      method: 'POST',
      url: '/api/v1/enrollments/join',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
      payload: { code: 'ABCDEFGHJK23' },
    });
    expect(deniedJoin.statusCode).toBe(403);
    expect(lecturerServer.enrollment.joinWithCode).not.toHaveBeenCalled();

    const studentServer = createServer();
    const response = await studentServer.server.inject({
      method: 'GET',
      url: '/api/v1/enrollments',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ enrollments: [{ ...course, enrolledAt: '2026-11-11T12:00:00.000Z' }] });
    expect(studentServer.enrollment.listStudentEnrollments).toHaveBeenCalledWith(student.id);
  });

  it('limits semester and offering creation routes to provisioned lecturer sessions', async () => {
    const lecturerServer = createServer(createAuth(lecturer));
    const semesters = await lecturerServer.server.inject({
      method: 'GET',
      url: '/api/v1/lecturer/semesters',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });
    const created = await lecturerServer.server.inject({
      method: 'POST',
      url: '/api/v1/lecturer/course-offerings',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
      payload: { courseCode: 'demo-101', courseTitle: 'Demonstration course', creditUnits: 3, semesterId, level: '100' },
    });
    expect(semesters.statusCode).toBe(200);
    expect(semesters.json().semesters).toEqual([{
      id: semesterId,
      name: 'Demonstration semester',
      startsAt: '2026-09-01T00:00:00.000Z',
      endsAt: course.semesterEndsAt,
    }]);
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({ status: 'created', course });
    // Codes are tidied the way the course list spells them.
    expect(lecturerServer.enrollment.createCourseOffering).toHaveBeenCalledWith(expect.objectContaining({ id: lecturer.id }), {
      courseCode: 'DEMO 101', courseTitle: 'Demonstration course', creditUnits: 3, semesterId, level: '100',
    });

    const studentServer = createServer();
    const denied = await studentServer.server.inject({
      method: 'POST',
      url: '/api/v1/lecturer/course-offerings',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
      payload: { courseCode: 'DEMO-101', courseTitle: 'Demonstration course', creditUnits: 3, semesterId, level: '100' },
    });
    expect(denied.statusCode).toBe(403);
    expect(studentServer.enrollment.createCourseOffering).not.toHaveBeenCalled();
  });

  it('lists assigned offerings and returns an expiring rotating join code once', async () => {
    const { server, enrollment } = createServer(createAuth(lecturer));
    const offerings = await server.inject({
      method: 'GET',
      url: '/api/v1/lecturer/course-offerings',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });
    const issued = await server.inject({
      method: 'POST',
      url: `/api/v1/lecturer/course-offerings/${course.courseOfferingId}/join-code`,
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });
    expect(offerings.statusCode).toBe(200);
    expect(offerings.json().offerings).toEqual([{
      ...course,
      joinCodeActive: true,
      joinCodeIssuedAt: '2026-10-02T09:30:00.000Z',
      creditUnits: 3,
      semesterStartsAt: '2026-09-01T00:00:00.000Z',
      students: 41,
      sessions: 6,
      openDisputes: 1,
      canEditCourse: true,
    }]);
    expect(issued.statusCode).toBe(200);
    expect(issued.json()).toEqual({ status: 'issued', code: 'ABCDEFGHJK23', expiresAt: course.semesterEndsAt, rotated: true });
    expect(issued.headers['cache-control']).toBe('no-store');
    expect(enrollment.issueJoinCode).toHaveBeenCalledWith(lecturer.id, course.courseOfferingId);
  });

  it('lets a lecturer correct an assigned offering and validates the change', async () => {
    const { server, enrollment } = createServer(createAuth(lecturer));
    const headers = { cookie: `lasuatos_session=${sessionToken}` };
    const url = `/api/v1/lecturer/course-offerings/${course.courseOfferingId}`;
    const updated = await server.inject({ method: 'POST', url, headers, payload: { courseTitle: 'Corrected title', creditUnits: 2 } });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ status: 'updated', offering: { courseTitle: 'Corrected title', creditUnits: 2, joinCodeActive: false } });
    expect(enrollment.updateCourseOffering).toHaveBeenCalledWith(lecturer.id, course.courseOfferingId, { courseTitle: 'Corrected title', creditUnits: 2 });
    expect((await server.inject({ method: 'POST', url, headers, payload: {} })).statusCode).toBe(400);
    expect((await server.inject({ method: 'POST', url, headers, payload: { creditUnits: 99 } })).statusCode).toBe(400);
    expect((await server.inject({ method: 'POST', url, headers, payload: { courseCode: 'NEW-1' } })).statusCode).toBe(400);
    const asStudent = createServer(createAuth(student));
    expect((await asStudent.server.inject({ method: 'POST', url, headers, payload: { level: '200' } })).statusCode).toBe(403);
  });

  it('supports assigned lecturer revocation and denies student lecturer tools', async () => {
    const studentServer = createServer();
    const headers = { cookie: `lasuatos_session=${sessionToken}` };
    const deniedList = await studentServer.server.inject({ method: 'GET', url: '/api/v1/lecturer/course-offerings', headers });
    const deniedSemester = await studentServer.server.inject({ method: 'GET', url: '/api/v1/lecturer/semesters', headers });
    expect(deniedList.statusCode).toBe(403);
    expect(deniedSemester.statusCode).toBe(403);
    expect(studentServer.enrollment.listLecturerOfferings).not.toHaveBeenCalled();
    expect(studentServer.enrollment.listAvailableSemesters).not.toHaveBeenCalled();

    const lecturerServer = createServer(createAuth(lecturer));
    const revoked = await lecturerServer.server.inject({
      method: 'DELETE',
      url: `/api/v1/lecturer/course-offerings/${course.courseOfferingId}/join-code`,
      headers,
    });
    expect(revoked.statusCode).toBe(204);
    expect(lecturerServer.enrollment.revokeJoinCode).toHaveBeenCalledWith(lecturer.id, course.courseOfferingId);
  });

  it('rejects malformed codes, IDs and offering forms', async () => {
    const { server, enrollment } = createServer(createAuth(lecturer));
    const badCode = await server.inject({
      method: 'POST', url: '/api/v1/enrollments/join', headers: { cookie: `lasuatos_session=${sessionToken}` },
      payload: { code: 'not-a-code' },
    });
    const badId = await server.inject({
      method: 'POST', url: '/api/v1/lecturer/course-offerings/not-a-uuid/join-code',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });
    const badOffering = await server.inject({
      method: 'POST', url: '/api/v1/lecturer/course-offerings',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
      payload: { courseCode: 'DEMO-101', courseTitle: 'Demo', creditUnits: 0, semesterId, level: '100' },
    });
    expect(badCode.statusCode).toBe(400);
    expect(badId.statusCode).toBe(400);
    expect(badOffering.statusCode).toBe(400);
    expect(enrollment.joinWithCode).not.toHaveBeenCalled();
    expect(enrollment.issueJoinCode).not.toHaveBeenCalled();
    expect(enrollment.createCourseOffering).not.toHaveBeenCalled();
  });

  it('returns the student academic profile, with the reps who correct it', async () => {
    const { server, enrollment } = createServer();
    const profile = await server.inject({
      method: 'GET',
      url: '/api/v1/student/profile',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.headers['cache-control']).toBe('no-store');
    expect(profile.json()).toEqual(academicProfile);
    expect(enrollment.getStudentAcademicProfile).toHaveBeenCalledWith(student.id);

    // Students no longer change their own department or entry route: their HOC does, on the class list.
    for (const [method, url] of [['POST', '/api/v1/student/profile/entry-level'], ['GET', '/api/v1/student/profile/departments'], ['POST', '/api/v1/student/profile/department']] as const) {
      const gone = await server.inject({ method, url, headers: { cookie: `lasuatos_session=${sessionToken}` }, ...(method === 'POST' ? { payload: {} } : {}) });
      expect(gone.statusCode).toBe(404);
    }
  });

  it('keeps the academic profile to student sessions', async () => {
    const anonymous = createServer();
    const unauthenticated = await anonymous.server.inject({ method: 'GET', url: '/api/v1/student/profile' });
    expect(unauthenticated.statusCode).toBe(401);

    const { server, enrollment } = createServer(createAuth(lecturer));
    const read = await server.inject({
      method: 'GET',
      url: '/api/v1/student/profile',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });
    expect(read.statusCode).toBe(403);
    expect(enrollment.getStudentAcademicProfile).not.toHaveBeenCalled();
  });
});
