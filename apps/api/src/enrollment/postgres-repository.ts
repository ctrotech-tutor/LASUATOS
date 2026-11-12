import { and, eq, gt, isNull, or, sql } from 'drizzle-orm';
import {
  courseAssignments,
  courseEnrollmentCodes,
  courseEnrollments,
  courseOfferings,
  courses,
  departments,
  faculties,
  lecturerProfiles,
  semesters,
  studentProfiles,
  userRoleAssignments,
  users,
  type DatabaseClient,
} from '@lasuatos/database';
import type {
  CourseEnrollmentRepository,
  CourseOfferingRecord,
  CreateCourseOfferingInput,
  CreateCourseOfferingResult,
  IssueCourseJoinCodeResult,
  JoinCourseByCodeResult,
  LecturerCourseOfferingRecord,
  LecturerSemesterRecord,
  RevokeCourseJoinCodeResult,
  StudentAcademicProfileRecord,
  StudentDepartmentOptionRecord,
  StudentEnrollmentRecord,
} from './repository.js';
import { currentSessionStartYear } from '../academic/student-level.js';

function lecturerScopeForOffering() {
  return and(
    eq(userRoleAssignments.role, 'lecturer'),
    eq(userRoleAssignments.institutionId, courseOfferings.institutionId),
    or(
      eq(userRoleAssignments.scopeType, 'institution'),
      and(
        eq(userRoleAssignments.scopeType, 'faculty'),
        eq(userRoleAssignments.facultyId, departments.facultyId),
      ),
      and(
        eq(userRoleAssignments.scopeType, 'department'),
        eq(userRoleAssignments.departmentId, courseOfferings.departmentId),
      ),
    ),
  );
}

function lecturerScopeForDepartment() {
  return and(
    eq(userRoleAssignments.role, 'lecturer'),
    eq(userRoleAssignments.institutionId, lecturerProfiles.institutionId),
    or(
      eq(userRoleAssignments.scopeType, 'institution'),
      and(
        eq(userRoleAssignments.scopeType, 'faculty'),
        eq(userRoleAssignments.facultyId, departments.facultyId),
      ),
      and(
        eq(userRoleAssignments.scopeType, 'department'),
        eq(userRoleAssignments.departmentId, lecturerProfiles.departmentId),
      ),
    ),
  );
}

function courseSummary(row: CourseOfferingRecord): CourseOfferingRecord {
  return {
    courseOfferingId: row.courseOfferingId,
    courseCode: row.courseCode,
    courseTitle: row.courseTitle,
    departmentName: row.departmentName,
    semesterName: row.semesterName,
    level: row.level,
    semesterEndsAt: row.semesterEndsAt,
  };
}

export class PostgresCourseEnrollmentRepository implements CourseEnrollmentRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listAvailableSemesters(lecturerUserId: string, now: Date): Promise<LecturerSemesterRecord[]> {
    return this.database
      .selectDistinct({
        id: semesters.id,
        name: semesters.name,
        startsAt: semesters.startsAt,
        endsAt: semesters.endsAt,
      })
      .from(lecturerProfiles)
      .innerJoin(users, and(
        eq(lecturerProfiles.userId, users.id),
        eq(lecturerProfiles.institutionId, users.institutionId),
      ))
      .innerJoin(departments, and(
        eq(lecturerProfiles.departmentId, departments.id),
        eq(lecturerProfiles.institutionId, departments.institutionId),
      ))
      .innerJoin(userRoleAssignments, and(
        eq(userRoleAssignments.userId, lecturerUserId),
        lecturerScopeForDepartment(),
      ))
      .innerJoin(semesters, and(
        eq(semesters.institutionId, lecturerProfiles.institutionId),
        gt(semesters.endsAt, now),
      ))
      .where(and(
        eq(lecturerProfiles.userId, lecturerUserId),
        eq(departments.isActive, true),
        eq(users.status, 'active'),
      ))
      .orderBy(semesters.startsAt, semesters.name)
      .limit(100);
  }

  async createCourseOffering(input: CreateCourseOfferingInput): Promise<CreateCourseOfferingResult> {
    return this.database.transaction(async (transaction) => {
      const [lecturer] = await transaction
        .select({
          institutionId: lecturerProfiles.institutionId,
          departmentId: lecturerProfiles.departmentId,
          departmentName: departments.name,
        })
        .from(lecturerProfiles)
        .innerJoin(users, and(
          eq(lecturerProfiles.userId, users.id),
          eq(lecturerProfiles.institutionId, users.institutionId),
        ))
        .innerJoin(departments, and(
          eq(lecturerProfiles.departmentId, departments.id),
          eq(lecturerProfiles.institutionId, departments.institutionId),
        ))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, input.lecturerUserId),
          lecturerScopeForDepartment(),
        ))
        .where(and(
          eq(lecturerProfiles.userId, input.lecturerUserId),
          eq(departments.isActive, true),
          eq(users.status, 'active'),
        ))
        .for('update', { of: lecturerProfiles })
        .limit(1);
      if (!lecturer) return { kind: 'lecturer_unavailable' };

      const [semester] = await transaction
        .select({ id: semesters.id, name: semesters.name, endsAt: semesters.endsAt })
        .from(semesters)
        .where(and(
          eq(semesters.id, input.semesterId),
          eq(semesters.institutionId, lecturer.institutionId),
          gt(semesters.endsAt, input.now),
        ))
        .limit(1);
      if (!semester) return { kind: 'semester_unavailable' };

      let [course] = await transaction
        .select({ id: courses.id, code: courses.code, title: courses.title, creditUnits: courses.creditUnits })
        .from(courses)
        .where(and(
          eq(courses.institutionId, lecturer.institutionId),
          sql`lower(${courses.code}) = ${input.courseCode.toLowerCase()}`,
        ))
        .limit(1);
      if (course && (course.title !== input.courseTitle || course.creditUnits !== input.creditUnits)) {
        return { kind: 'course_metadata_conflict' };
      }
      if (!course) {
        const [insertedCourse] = await transaction
          .insert(courses)
          .values({
            institutionId: lecturer.institutionId,
            code: input.courseCode,
            title: input.courseTitle,
            creditUnits: input.creditUnits,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing()
          .returning({ id: courses.id, code: courses.code, title: courses.title, creditUnits: courses.creditUnits });
        course = insertedCourse ?? (await transaction
          .select({ id: courses.id, code: courses.code, title: courses.title, creditUnits: courses.creditUnits })
          .from(courses)
          .where(and(
            eq(courses.institutionId, lecturer.institutionId),
            sql`lower(${courses.code}) = ${input.courseCode.toLowerCase()}`,
          ))
          .limit(1))[0];
      }
      if (!course || course.title !== input.courseTitle || course.creditUnits !== input.creditUnits) {
        return { kind: 'course_metadata_conflict' };
      }

      const findOffering = () => transaction
        .select({
          courseOfferingId: courseOfferings.id,
          courseCode: courses.code,
          courseTitle: courses.title,
          departmentName: departments.name,
          semesterName: semesters.name,
          level: courseOfferings.level,
          semesterEndsAt: semesters.endsAt,
        })
        .from(courseOfferings)
        .innerJoin(courses, and(
          eq(courseOfferings.courseId, courses.id),
          eq(courseOfferings.institutionId, courses.institutionId),
        ))
        .innerJoin(departments, and(
          eq(courseOfferings.departmentId, departments.id),
          eq(courseOfferings.institutionId, departments.institutionId),
        ))
        .innerJoin(semesters, and(
          eq(courseOfferings.semesterId, semesters.id),
          eq(courseOfferings.institutionId, semesters.institutionId),
        ))
        .where(and(
          eq(courseOfferings.institutionId, lecturer.institutionId),
          eq(courseOfferings.courseId, course.id),
          eq(courseOfferings.departmentId, lecturer.departmentId),
          eq(courseOfferings.semesterId, semester.id),
          eq(courseOfferings.level, input.level),
        ))
        .limit(1);

      let [offering] = await findOffering();
      if (!offering) {
        const [insertedOffering] = await transaction
          .insert(courseOfferings)
          .values({
            institutionId: lecturer.institutionId,
            courseId: course.id,
            departmentId: lecturer.departmentId,
            semesterId: semester.id,
            level: input.level,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .onConflictDoNothing()
          .returning({ id: courseOfferings.id });
        if (insertedOffering) {
          await transaction
            .insert(courseAssignments)
            .values({
              institutionId: lecturer.institutionId,
              courseOfferingId: insertedOffering.id,
              lecturerUserId: input.lecturerUserId,
              assignmentType: 'lecturer',
              assignedAt: input.now,
            })
            .onConflictDoNothing();
          return {
            kind: 'created',
            course: {
              courseOfferingId: insertedOffering.id,
              courseCode: course.code,
              courseTitle: course.title,
              departmentName: lecturer.departmentName,
              semesterName: semester.name,
              level: input.level,
              semesterEndsAt: semester.endsAt,
            },
          };
        }
        [offering] = await findOffering();
      }
      if (!offering) return { kind: 'offering_exists' };

      const [assignment] = await transaction
        .select({ id: courseAssignments.id })
        .from(courseAssignments)
        .where(and(
          eq(courseAssignments.courseOfferingId, offering.courseOfferingId),
          eq(courseAssignments.institutionId, lecturer.institutionId),
          eq(courseAssignments.lecturerUserId, input.lecturerUserId),
          eq(courseAssignments.assignmentType, 'lecturer'),
        ))
        .limit(1);
      return assignment
        ? { kind: 'already_assigned', course: courseSummary(offering) }
        : { kind: 'offering_exists' };
    });
  }

  async listLecturerOfferings(lecturerUserId: string, now: Date): Promise<LecturerCourseOfferingRecord[]> {
    const rows = await this.database
      .selectDistinct({
        courseOfferingId: courseOfferings.id,
        courseCode: courses.code,
        courseTitle: courses.title,
        departmentName: departments.name,
        semesterName: semesters.name,
        level: courseOfferings.level,
        semesterEndsAt: semesters.endsAt,
        joinCodeActive: sql<boolean>`exists (
          select 1 from course_enrollment_codes as join_codes
          where join_codes.course_offering_id = ${courseOfferings.id}
            and join_codes.revoked_at is null
            and join_codes.expires_at > ${now}
        )`,
      })
      .from(courseAssignments)
      .innerJoin(courseOfferings, eq(courseAssignments.courseOfferingId, courseOfferings.id))
      .innerJoin(courses, and(
        eq(courseOfferings.courseId, courses.id),
        eq(courseOfferings.institutionId, courses.institutionId),
      ))
      .innerJoin(departments, and(
        eq(courseOfferings.departmentId, departments.id),
        eq(courseOfferings.institutionId, departments.institutionId),
      ))
      .innerJoin(semesters, and(
        eq(courseOfferings.semesterId, semesters.id),
        eq(courseOfferings.institutionId, semesters.institutionId),
      ))
      .innerJoin(lecturerProfiles, and(
        eq(courseAssignments.lecturerUserId, lecturerProfiles.userId),
        eq(courseAssignments.institutionId, lecturerProfiles.institutionId),
      ))
      .innerJoin(users, eq(lecturerProfiles.userId, users.id))
      .innerJoin(userRoleAssignments, and(
        eq(userRoleAssignments.userId, lecturerUserId),
        lecturerScopeForOffering(),
      ))
      .where(and(
        eq(courseAssignments.lecturerUserId, lecturerUserId),
        eq(courseAssignments.assignmentType, 'lecturer'),
        eq(users.status, 'active'),
        eq(departments.isActive, true),
      ))
      .orderBy(semesters.endsAt, courses.code)
      .limit(500);
    return rows.map((row) => ({ ...courseSummary(row), joinCodeActive: row.joinCodeActive }));
  }

  async issueJoinCode(input: {
    readonly lecturerUserId: string;
    readonly courseOfferingId: string;
    readonly codeHash: string;
    readonly now: Date;
  }): Promise<IssueCourseJoinCodeResult> {
    return this.database.transaction(async (transaction) => {
      const [offering] = await transaction
        .select({ institutionId: courseOfferings.institutionId, semesterEndsAt: semesters.endsAt })
        .from(courseAssignments)
        .innerJoin(courseOfferings, eq(courseAssignments.courseOfferingId, courseOfferings.id))
        .innerJoin(departments, and(
          eq(courseOfferings.departmentId, departments.id),
          eq(courseOfferings.institutionId, departments.institutionId),
        ))
        .innerJoin(semesters, and(
          eq(courseOfferings.semesterId, semesters.id),
          eq(courseOfferings.institutionId, semesters.institutionId),
        ))
        .innerJoin(lecturerProfiles, and(
          eq(courseAssignments.lecturerUserId, lecturerProfiles.userId),
          eq(courseAssignments.institutionId, lecturerProfiles.institutionId),
        ))
        .innerJoin(users, eq(lecturerProfiles.userId, users.id))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, input.lecturerUserId),
          lecturerScopeForOffering(),
        ))
        .where(and(
          eq(courseAssignments.lecturerUserId, input.lecturerUserId),
          eq(courseAssignments.assignmentType, 'lecturer'),
          eq(courseOfferings.id, input.courseOfferingId),
          eq(users.status, 'active'),
          eq(departments.isActive, true),
        ))
        .for('update', { of: courseOfferings })
        .limit(1);
      if (!offering) return { kind: 'not_assigned' };
      if (offering.semesterEndsAt <= input.now) return { kind: 'semester_closed' };

      const [previousCode] = await transaction
        .select({ id: courseEnrollmentCodes.id })
        .from(courseEnrollmentCodes)
        .where(and(
          eq(courseEnrollmentCodes.courseOfferingId, input.courseOfferingId),
          eq(courseEnrollmentCodes.institutionId, offering.institutionId),
          isNull(courseEnrollmentCodes.revokedAt),
        ))
        .for('update')
        .limit(1);
      await transaction
        .update(courseEnrollmentCodes)
        .set({ revokedAt: input.now })
        .where(and(
          eq(courseEnrollmentCodes.courseOfferingId, input.courseOfferingId),
          eq(courseEnrollmentCodes.institutionId, offering.institutionId),
          isNull(courseEnrollmentCodes.revokedAt),
        ));
      await transaction.insert(courseEnrollmentCodes).values({
        institutionId: offering.institutionId,
        courseOfferingId: input.courseOfferingId,
        lecturerUserId: input.lecturerUserId,
        codeHash: input.codeHash,
        expiresAt: offering.semesterEndsAt,
        createdAt: input.now,
      });
      return {
        kind: 'issued',
        expiresAt: offering.semesterEndsAt,
        rotated: Boolean(previousCode),
      };
    });
  }

  async revokeJoinCode(input: {
    readonly lecturerUserId: string;
    readonly courseOfferingId: string;
    readonly now: Date;
  }): Promise<RevokeCourseJoinCodeResult> {
    return this.database.transaction(async (transaction) => {
      const [offering] = await transaction
        .select({ institutionId: courseOfferings.institutionId })
        .from(courseAssignments)
        .innerJoin(courseOfferings, eq(courseAssignments.courseOfferingId, courseOfferings.id))
        .innerJoin(departments, and(
          eq(courseOfferings.departmentId, departments.id),
          eq(courseOfferings.institutionId, departments.institutionId),
        ))
        .innerJoin(lecturerProfiles, and(
          eq(courseAssignments.lecturerUserId, lecturerProfiles.userId),
          eq(courseAssignments.institutionId, lecturerProfiles.institutionId),
        ))
        .innerJoin(users, eq(lecturerProfiles.userId, users.id))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, input.lecturerUserId),
          lecturerScopeForOffering(),
        ))
        .where(and(
          eq(courseAssignments.lecturerUserId, input.lecturerUserId),
          eq(courseAssignments.assignmentType, 'lecturer'),
          eq(courseOfferings.id, input.courseOfferingId),
          eq(users.status, 'active'),
          eq(departments.isActive, true),
        ))
        .for('update', { of: courseOfferings })
        .limit(1);
      if (!offering) return 'not_assigned';

      const [revoked] = await transaction
        .update(courseEnrollmentCodes)
        .set({ revokedAt: input.now })
        .where(and(
          eq(courseEnrollmentCodes.courseOfferingId, input.courseOfferingId),
          eq(courseEnrollmentCodes.institutionId, offering.institutionId),
          isNull(courseEnrollmentCodes.revokedAt),
        ))
        .returning({ id: courseEnrollmentCodes.id });
      return revoked ? 'revoked' : 'missing';
    });
  }

  async joinWithCode(input: {
    readonly studentUserId: string;
    readonly codeHash: string;
    readonly now: Date;
  }): Promise<JoinCourseByCodeResult> {
    return this.database.transaction(async (transaction) => {
      const [code] = await transaction
        .select({
          institutionId: courseEnrollmentCodes.institutionId,
          courseOfferingId: courseOfferings.id,
          courseCode: courses.code,
          courseTitle: courses.title,
          departmentName: departments.name,
          semesterName: semesters.name,
          level: courseOfferings.level,
          semesterEndsAt: semesters.endsAt,
        })
        .from(courseEnrollmentCodes)
        .innerJoin(courseOfferings, and(
          eq(courseEnrollmentCodes.courseOfferingId, courseOfferings.id),
          eq(courseEnrollmentCodes.institutionId, courseOfferings.institutionId),
        ))
        .innerJoin(courses, and(
          eq(courseOfferings.courseId, courses.id),
          eq(courseOfferings.institutionId, courses.institutionId),
        ))
        .innerJoin(departments, and(
          eq(courseOfferings.departmentId, departments.id),
          eq(courseOfferings.institutionId, departments.institutionId),
        ))
        .innerJoin(semesters, and(
          eq(courseOfferings.semesterId, semesters.id),
          eq(courseOfferings.institutionId, semesters.institutionId),
        ))
        .where(and(
          eq(courseEnrollmentCodes.codeHash, input.codeHash),
          isNull(courseEnrollmentCodes.revokedAt),
          gt(courseEnrollmentCodes.expiresAt, input.now),
          gt(semesters.endsAt, input.now),
        ))
        .for('share', { of: courseEnrollmentCodes })
        .limit(1);
      if (!code) return { kind: 'invalid_code' };

      const [student] = await transaction
        .select({ userId: studentProfiles.userId })
        .from(studentProfiles)
        .innerJoin(users, and(
          eq(studentProfiles.userId, users.id),
          eq(studentProfiles.institutionId, users.institutionId),
        ))
        .innerJoin(userRoleAssignments, and(
          eq(userRoleAssignments.userId, users.id),
          eq(userRoleAssignments.role, 'student'),
          eq(userRoleAssignments.scopeType, 'institution'),
          eq(userRoleAssignments.institutionId, users.institutionId),
        ))
        .where(and(
          eq(studentProfiles.userId, input.studentUserId),
          eq(studentProfiles.institutionId, code.institutionId),
          eq(users.status, 'active'),
        ))
        .limit(1);
      if (!student) return { kind: 'not_student' };

      const [enrollment] = await transaction
        .insert(courseEnrollments)
        .values({
          institutionId: code.institutionId,
          courseOfferingId: code.courseOfferingId,
          studentUserId: input.studentUserId,
          status: 'active',
          enrolledAt: input.now,
          updatedAt: input.now,
        })
        .onConflictDoNothing()
        .returning({ id: courseEnrollments.id });

      const summary: CourseOfferingRecord = {
        courseOfferingId: code.courseOfferingId,
        courseCode: code.courseCode,
        courseTitle: code.courseTitle,
        departmentName: code.departmentName,
        semesterName: code.semesterName,
        level: code.level,
        semesterEndsAt: code.semesterEndsAt,
      };
      if (enrollment) return { kind: 'enrolled', course: summary };

      const [existingEnrollment] = await transaction
        .select({ status: courseEnrollments.status })
        .from(courseEnrollments)
        .where(and(
          eq(courseEnrollments.courseOfferingId, code.courseOfferingId),
          eq(courseEnrollments.studentUserId, input.studentUserId),
          eq(courseEnrollments.institutionId, code.institutionId),
        ))
        .limit(1);
      return existingEnrollment?.status === 'active'
        ? { kind: 'already_enrolled', course: summary }
        : { kind: 'closed_enrollment' };
    });
  }

  async listStudentEnrollments(studentUserId: string): Promise<StudentEnrollmentRecord[]> {
    return this.database
      .select({
        courseOfferingId: courseOfferings.id,
        courseCode: courses.code,
        courseTitle: courses.title,
        departmentName: departments.name,
        semesterName: semesters.name,
        level: courseOfferings.level,
        semesterEndsAt: semesters.endsAt,
        enrolledAt: courseEnrollments.enrolledAt,
      })
      .from(courseEnrollments)
      .innerJoin(courseOfferings, and(
        eq(courseEnrollments.courseOfferingId, courseOfferings.id),
        eq(courseEnrollments.institutionId, courseOfferings.institutionId),
      ))
      .innerJoin(courses, and(
        eq(courseOfferings.courseId, courses.id),
        eq(courseOfferings.institutionId, courses.institutionId),
      ))
      .innerJoin(departments, and(
        eq(courseOfferings.departmentId, departments.id),
        eq(courseOfferings.institutionId, departments.institutionId),
      ))
      .innerJoin(semesters, and(
        eq(courseOfferings.semesterId, semesters.id),
        eq(courseOfferings.institutionId, semesters.institutionId),
      ))
      .innerJoin(studentProfiles, and(
        eq(courseEnrollments.studentUserId, studentProfiles.userId),
        eq(courseEnrollments.institutionId, studentProfiles.institutionId),
      ))
      .where(and(
        eq(courseEnrollments.studentUserId, studentUserId),
        eq(courseEnrollments.status, 'active'),
      ))
      .orderBy(semesters.endsAt, courses.code)
      .limit(500);
  }

  async getStudentAcademicProfile(studentUserId: string, now: Date): Promise<StudentAcademicProfileRecord | null> {
    const [profile] = await this.database
      .select({
        institutionId: studentProfiles.institutionId,
        studentNumber: studentProfiles.studentNumber,
        studentNumberVerifiedAt: studentProfiles.studentNumberVerifiedAt,
        entryYear: studentProfiles.entryYear,
        entryLevel: studentProfiles.entryLevel,
        departmentId: departments.id,
        departmentName: departments.name,
        programmeYears: departments.programmeYears,
      })
      .from(studentProfiles)
      .leftJoin(departments, and(
        eq(studentProfiles.departmentId, departments.id),
        eq(studentProfiles.institutionId, departments.institutionId),
      ))
      .where(eq(studentProfiles.userId, studentUserId))
      .limit(1);
    if (!profile) return null;
    return {
      studentNumber: profile.studentNumber,
      studentNumberVerified: profile.studentNumberVerifiedAt !== null,
      departmentId: profile.departmentId,
      departmentName: profile.departmentName,
      programmeYears: profile.programmeYears,
      entryYear: profile.entryYear,
      entryLevel: profile.entryLevel,
      sessionStartYear: await currentSessionStartYear(this.database, profile.institutionId, now),
    };
  }

  async updateStudentEntryLevel(studentUserId: string, entryLevel: 100 | 200 | 300): Promise<boolean> {
    const updated = await this.database
      .update(studentProfiles)
      .set({ entryLevel })
      .where(eq(studentProfiles.userId, studentUserId))
      .returning({ userId: studentProfiles.userId });
    return updated.length > 0;
  }

  async listStudentDepartmentOptions(studentUserId: string): Promise<StudentDepartmentOptionRecord[]> {
    return this.database
      .select({
        id: departments.id,
        name: departments.name,
        facultyName: faculties.name,
        programmeYears: departments.programmeYears,
      })
      .from(studentProfiles)
      .innerJoin(departments, and(
        eq(departments.institutionId, studentProfiles.institutionId),
        eq(departments.isActive, true),
      ))
      .innerJoin(faculties, and(
        eq(faculties.id, departments.facultyId),
        eq(faculties.institutionId, departments.institutionId),
      ))
      .where(eq(studentProfiles.userId, studentUserId))
      .orderBy(faculties.name, departments.name)
      .limit(500);
  }

  async updateStudentDepartment(
    studentUserId: string,
    departmentId: string,
  ): Promise<'updated' | 'not_student' | 'department_unavailable'> {
    return this.database.transaction(async (transaction) => {
      const [profile] = await transaction
        .select({ institutionId: studentProfiles.institutionId })
        .from(studentProfiles)
        .where(eq(studentProfiles.userId, studentUserId))
        .limit(1);
      if (!profile) return 'not_student';
      const [department] = await transaction
        .select({ id: departments.id })
        .from(departments)
        .where(and(
          eq(departments.id, departmentId),
          eq(departments.institutionId, profile.institutionId),
          eq(departments.isActive, true),
        ))
        .limit(1);
      if (!department) return 'department_unavailable';
      await transaction
        .update(studentProfiles)
        .set({ departmentId: department.id })
        .where(eq(studentProfiles.userId, studentUserId));
      return 'updated';
    });
  }
}
