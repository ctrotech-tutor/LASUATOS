import { randomBytes } from 'node:crypto';
import { hashOpaqueToken } from '@lasuatos/auth';
import type {
  CourseEnrollmentRepository,
  CourseOfferingRecord,
  CreateCourseOfferingInput,
  LecturerCourseOfferingRecord,
  LecturerSemesterRecord,
  StudentAcademicProfileRecord,
  StudentEnrollmentRecord,
} from './repository.js';
import {
  DEFAULT_PROGRAMME_YEARS,
  isLasuMatricNumber,
  type EntryLevel,
  type StudentAcademicProfile,
} from '@lasuatos/contracts';
import { studentLevelFor } from '../academic/student-level.js';

const JOIN_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const JOIN_CODE_LENGTH = 12;
const JOIN_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/;

export class InvalidCourseJoinCodeError extends Error {
  readonly statusCode = 400;
  constructor() {
    super('The course code is invalid, expired or no longer active.');
    this.name = 'InvalidCourseJoinCodeError';
  }
}

export class CourseEnrollmentForbiddenError extends Error {
  readonly statusCode = 403;
  constructor() {
    super('This account cannot join the course.');
    this.name = 'CourseEnrollmentForbiddenError';
  }
}

export class CourseEnrollmentConflictError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('This course enrollment is closed. Contact the assigned lecturer if you need help.');
    this.name = 'CourseEnrollmentConflictError';
  }
}

export class CourseOfferingUnavailableError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('The course offering is not available to this lecturer.');
    this.name = 'CourseOfferingUnavailableError';
  }
}

export class CourseSemesterClosedError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('A join code cannot be issued for an ended semester.');
    this.name = 'CourseSemesterClosedError';
  }
}

export class CourseLecturerUnavailableError extends Error {
  readonly statusCode = 403;
  constructor() {
    super('The lecturer account cannot create course offerings.');
    this.name = 'CourseLecturerUnavailableError';
  }
}

export class CourseSemesterUnavailableError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('The selected semester is not available.');
    this.name = 'CourseSemesterUnavailableError';
  }
}

export class CourseMetadataConflictError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('This course code already exists with different course details. Contact your department administrator.');
    this.name = 'CourseMetadataConflictError';
  }
}

export class CourseOfferingConflictError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('This course offering already exists but is not assigned to this lecturer. Contact your department administrator.');
    this.name = 'CourseOfferingConflictError';
  }
}

export function normalizeCourseJoinCode(value: string): string | null {
  const normalized = value.replace(/[\s-]/g, '').toUpperCase();
  return JOIN_CODE_PATTERN.test(normalized) ? normalized : null;
}

function createCourseJoinCode(): string {
  const bytes = randomBytes(JOIN_CODE_LENGTH);
  return [...bytes].map((byte) => JOIN_CODE_ALPHABET[byte & 31]).join('');
}

export class CourseEnrollmentService {
  readonly #repository: CourseEnrollmentRepository;
  readonly #now: () => Date;

  constructor(options: { readonly repository: CourseEnrollmentRepository; readonly now?: () => Date }) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
  }

  async listAvailableSemesters(lecturerUserId: string): Promise<LecturerSemesterRecord[]> {
    return this.#repository.listAvailableSemesters(lecturerUserId, this.#now());
  }

  async createCourseOffering(
    lecturerUserId: string,
    details: Omit<CreateCourseOfferingInput, 'lecturerUserId' | 'now'>,
  ): Promise<{ readonly status: 'created' | 'already_assigned'; readonly course: CourseOfferingRecord }> {
    const result = await this.#repository.createCourseOffering({ ...details, lecturerUserId, now: this.#now() });
    if (result.kind === 'lecturer_unavailable') throw new CourseLecturerUnavailableError();
    if (result.kind === 'semester_unavailable') throw new CourseSemesterUnavailableError();
    if (result.kind === 'course_metadata_conflict') throw new CourseMetadataConflictError();
    if (result.kind === 'offering_exists') throw new CourseOfferingConflictError();
    return { status: result.kind, course: result.course };
  }

  async listLecturerOfferings(lecturerUserId: string): Promise<LecturerCourseOfferingRecord[]> {
    return this.#repository.listLecturerOfferings(lecturerUserId, this.#now());
  }

  async issueJoinCode(lecturerUserId: string, courseOfferingId: string): Promise<{
    readonly code: string;
    readonly expiresAt: Date;
    readonly rotated: boolean;
  }> {
    const code = createCourseJoinCode();
    const result = await this.#repository.issueJoinCode({
      lecturerUserId,
      courseOfferingId,
      codeHash: hashOpaqueToken(code),
      now: this.#now(),
    });
    if (result.kind === 'not_assigned') throw new CourseOfferingUnavailableError();
    if (result.kind === 'semester_closed') throw new CourseSemesterClosedError();
    return { code, expiresAt: result.expiresAt, rotated: result.rotated };
  }

  async revokeJoinCode(lecturerUserId: string, courseOfferingId: string): Promise<void> {
    const result = await this.#repository.revokeJoinCode({
      lecturerUserId,
      courseOfferingId,
      now: this.#now(),
    });
    if (result === 'not_assigned' || result === 'missing') throw new CourseOfferingUnavailableError();
  }

  async joinWithCode(studentUserId: string, suppliedCode: string): Promise<{
    readonly status: 'enrolled' | 'already_enrolled';
    readonly course: CourseOfferingRecord;
  }> {
    const code = normalizeCourseJoinCode(suppliedCode);
    if (!code) throw new InvalidCourseJoinCodeError();
    const result = await this.#repository.joinWithCode({
      studentUserId,
      codeHash: hashOpaqueToken(code),
      now: this.#now(),
    });
    if (result.kind === 'invalid_code') throw new InvalidCourseJoinCodeError();
    if (result.kind === 'not_student') throw new CourseEnrollmentForbiddenError();
    if (result.kind === 'closed_enrollment') throw new CourseEnrollmentConflictError();
    return { status: result.kind, course: result.course };
  }

  async listStudentEnrollments(studentUserId: string): Promise<StudentEnrollmentRecord[]> {
    return this.#repository.listStudentEnrollments(studentUserId);
  }

  /** The student's matric-derived level and the inputs behind it; null without a student profile. */
  async getStudentAcademicProfile(studentUserId: string): Promise<StudentAcademicProfile | null> {
    const record = await this.#repository.getStudentAcademicProfile(studentUserId, this.#now());
    return record ? academicProfileFrom(record) : null;
  }

  /** Records the self-declared entry level (100 UTME; 200/300 Direct Entry). */
  async updateStudentEntryLevel(studentUserId: string, entryLevel: EntryLevel): Promise<StudentAcademicProfile> {
    const updated = await this.#repository.updateStudentEntryLevel(studentUserId, entryLevel);
    if (!updated) throw new CourseEnrollmentForbiddenError();
    const profile = await this.getStudentAcademicProfile(studentUserId);
    if (!profile) throw new CourseEnrollmentForbiddenError();
    return profile;
  }
}

export function academicProfileFrom(record: StudentAcademicProfileRecord): StudentAcademicProfile {
  const level = studentLevelFor(record, record.sessionStartYear);
  const entryLevel: EntryLevel = record.entryLevel === 200 || record.entryLevel === 300 ? record.entryLevel : 100;
  const programmeYears = record.programmeYears && record.programmeYears >= 1 && record.programmeYears <= 8
    ? record.programmeYears
    : DEFAULT_PROGRAMME_YEARS;
  return {
    matricNumber: record.studentNumber,
    matricNumberVerified: record.studentNumberVerified,
    matricRecognized: isLasuMatricNumber(record.studentNumber),
    departmentName: record.departmentName,
    programmeYears,
    entryYear: level.entryYear,
    entryLevel,
    sessionLabel: `${record.sessionStartYear}/${record.sessionStartYear + 1}`,
    yearOfStudy: level.yearOfStudy,
    level: level.level,
    levelStatus: level.status,
    levelLabel: level.label,
  };
}
