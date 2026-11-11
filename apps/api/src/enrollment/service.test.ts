import { describe, expect, it, vi } from 'vitest';
import { hashOpaqueToken } from '@lasuatos/auth';
import type { CourseEnrollmentRepository, CourseOfferingRecord } from './repository.js';
import {
  CourseEnrollmentConflictError,
  CourseEnrollmentForbiddenError,
  CourseEnrollmentService,
  CourseLecturerUnavailableError,
  CourseMetadataConflictError,
  CourseOfferingConflictError,
  CourseOfferingUnavailableError,
  CourseSemesterClosedError,
  CourseSemesterUnavailableError,
  InvalidCourseJoinCodeError,
} from './service.js';

const now = new Date('2026-11-11T12:00:00.000Z');
const expiresAt = new Date('2027-04-30T23:59:59.000Z');
const semesterId = '3d9f7a67-15f6-46e3-a849-00aa1c509822';
const course: CourseOfferingRecord = {
  courseOfferingId: 'b3aa9508-2ead-444c-8b8f-3051fe8d14df',
  courseCode: 'DEMO-101',
  courseTitle: 'Demonstration course',
  departmentName: 'Demonstration department',
  semesterName: 'Demonstration semester',
  level: '100',
  semesterEndsAt: expiresAt,
};

function repository(overrides: Partial<CourseEnrollmentRepository> = {}): CourseEnrollmentRepository {
  return {
    listAvailableSemesters: async () => [],
    createCourseOffering: async () => ({ kind: 'created', course }),
    listLecturerOfferings: async () => [],
    issueJoinCode: async () => ({ kind: 'issued', expiresAt, rotated: false }),
    revokeJoinCode: async () => 'revoked',
    joinWithCode: async () => ({ kind: 'enrolled', course }),
    listStudentEnrollments: async () => [],
    ...overrides,
  };
}

describe('course enrollment service', () => {
  it('normalizes copied codes and stores only their hash', async () => {
    let inserted: Parameters<CourseEnrollmentRepository['issueJoinCode']>[0] | undefined;
    const service = new CourseEnrollmentService({
      repository: repository({
        issueJoinCode: async (input) => {
          inserted = input;
          return { kind: 'issued', expiresAt, rotated: false };
        },
      }),
      now: () => now,
    });
    const result = await service.issueJoinCode('lecturer-id', course.courseOfferingId);

    expect(result.code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(inserted).toMatchObject({
      lecturerUserId: 'lecturer-id',
      courseOfferingId: course.courseOfferingId,
      codeHash: hashOpaqueToken(result.code),
      now,
    });
    expect(inserted?.codeHash).not.toBe(result.code);
    await expect(service.joinWithCode('student-id', ` ${result.code.slice(0, 4)}-${result.code.slice(4)} `))
      .resolves.toMatchObject({ status: 'enrolled', course });
  });

  it('reports when rotation replaces a previous code and rejects unassigned/closed offerings', async () => {
    const service = new CourseEnrollmentService({
      repository: repository({ issueJoinCode: async () => ({ kind: 'issued', expiresAt, rotated: true }) }),
      now: () => now,
    });
    await expect(service.issueJoinCode('lecturer-id', course.courseOfferingId))
      .resolves.toMatchObject({ rotated: true, expiresAt });

    const unassigned = new CourseEnrollmentService({
      repository: repository({ issueJoinCode: async () => ({ kind: 'not_assigned' }) }),
      now: () => now,
    });
    const ended = new CourseEnrollmentService({
      repository: repository({ issueJoinCode: async () => ({ kind: 'semester_closed' }) }),
      now: () => now,
    });
    await expect(unassigned.issueJoinCode('other-lecturer', course.courseOfferingId))
      .rejects.toBeInstanceOf(CourseOfferingUnavailableError);
    await expect(ended.issueJoinCode('lecturer-id', course.courseOfferingId))
      .rejects.toBeInstanceOf(CourseSemesterClosedError);
  });

  it('lists available semesters and creates an offering with server-owned lecturer and timestamp', async () => {
    const startsAt = new Date('2026-09-01T00:00:00.000Z');
    const listAvailableSemesters = vi.fn(async () => [{ id: semesterId, name: 'Demonstration semester', startsAt, endsAt: expiresAt }]);
    const createCourseOffering = vi.fn(async () => ({ kind: 'created' as const, course }));
    const service = new CourseEnrollmentService({
      repository: repository({ listAvailableSemesters, createCourseOffering }),
      now: () => now,
    });
    await expect(service.listAvailableSemesters('lecturer-id')).resolves.toMatchObject([{ id: semesterId, endsAt: expiresAt }]);
    await expect(service.createCourseOffering('lecturer-id', {
      courseCode: 'DEMO-101',
      courseTitle: 'Demonstration course',
      creditUnits: 3,
      semesterId,
      level: '100',
    })).resolves.toEqual({ status: 'created', course });
    expect(listAvailableSemesters).toHaveBeenCalledWith('lecturer-id', now);
    expect(createCourseOffering).toHaveBeenCalledWith({
      lecturerUserId: 'lecturer-id',
      courseCode: 'DEMO-101',
      courseTitle: 'Demonstration course',
      creditUnits: 3,
      semesterId,
      level: '100',
      now,
    });
  });

  it('maps offering creation conflicts without revealing another lecturer assignment', async () => {
    const cases = [
      ['lecturer_unavailable', CourseLecturerUnavailableError],
      ['semester_unavailable', CourseSemesterUnavailableError],
      ['course_metadata_conflict', CourseMetadataConflictError],
      ['offering_exists', CourseOfferingConflictError],
    ] as const;
    for (const [kind, error] of cases) {
      const service = new CourseEnrollmentService({
        repository: repository({ createCourseOffering: async () => ({ kind }) }),
        now: () => now,
      });
      await expect(service.createCourseOffering('lecturer-id', {
        courseCode: 'DEMO-101', courseTitle: 'Demonstration course', creditUnits: 3, semesterId, level: '100',
      })).rejects.toBeInstanceOf(error);
    }
  });

  it('returns already-enrolled for a repeat code and rejects invalid/non-student/closed joins', async () => {
    const repeated = new CourseEnrollmentService({
      repository: repository({ joinWithCode: async () => ({ kind: 'already_enrolled', course }) }),
      now: () => now,
    });
    await expect(repeated.joinWithCode('student-id', 'ABCDEFGHJK23')).resolves.toMatchObject({
      status: 'already_enrolled', course,
    });

    const invalid = new CourseEnrollmentService({
      repository: repository({ joinWithCode: async () => ({ kind: 'invalid_code' }) }),
      now: () => now,
    });
    await expect(invalid.joinWithCode('student-id', 'bad')).rejects.toBeInstanceOf(InvalidCourseJoinCodeError);
    await expect(invalid.joinWithCode('student-id', 'ABCDEFGHJK23')).rejects.toBeInstanceOf(InvalidCourseJoinCodeError);

    const notStudent = new CourseEnrollmentService({
      repository: repository({ joinWithCode: async () => ({ kind: 'not_student' }) }),
      now: () => now,
    });
    const closed = new CourseEnrollmentService({
      repository: repository({ joinWithCode: async () => ({ kind: 'closed_enrollment' }) }),
      now: () => now,
    });
    await expect(notStudent.joinWithCode('lecturer-id', 'ABCDEFGHJK23'))
      .rejects.toBeInstanceOf(CourseEnrollmentForbiddenError);
    await expect(closed.joinWithCode('student-id', 'ABCDEFGHJK23'))
      .rejects.toBeInstanceOf(CourseEnrollmentConflictError);
  });

  it('revokes a join code without exposing its hash', async () => {
    const revokeJoinCode = vi.fn(async () => 'revoked' as const);
    const service = new CourseEnrollmentService({ repository: repository({ revokeJoinCode }), now: () => now });
    await expect(service.revokeJoinCode('lecturer-id', course.courseOfferingId)).resolves.toBeUndefined();
    expect(revokeJoinCode).toHaveBeenCalledWith({ lecturerUserId: 'lecturer-id', courseOfferingId: course.courseOfferingId, now });
    const unavailable = new CourseEnrollmentService({ repository: repository({ revokeJoinCode: async () => 'missing' }), now: () => now });
    await expect(unavailable.revokeJoinCode('lecturer-id', course.courseOfferingId))
      .rejects.toBeInstanceOf(CourseOfferingUnavailableError);
  });
});
