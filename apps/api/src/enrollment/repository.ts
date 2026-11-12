export interface CourseOfferingRecord {
  readonly courseOfferingId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly departmentName: string;
  readonly semesterName: string;
  readonly level: string;
  readonly semesterEndsAt: Date;
}

export interface LecturerCourseOfferingRecord extends CourseOfferingRecord {
  readonly joinCodeActive: boolean;
}

export interface StudentEnrollmentRecord extends CourseOfferingRecord {
  readonly enrolledAt: Date;
}

export interface LecturerSemesterRecord {
  readonly id: string;
  readonly name: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export interface CreateCourseOfferingInput {
  readonly lecturerUserId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly creditUnits: number;
  readonly semesterId: string;
  readonly level: string;
  readonly now: Date;
}

export type CreateCourseOfferingResult =
  | { readonly kind: 'created' | 'already_assigned'; readonly course: CourseOfferingRecord }
  | { readonly kind: 'lecturer_unavailable' }
  | { readonly kind: 'semester_unavailable' }
  | { readonly kind: 'course_metadata_conflict' }
  | { readonly kind: 'offering_exists' };

export type IssueCourseJoinCodeResult =
  | { readonly kind: 'issued'; readonly expiresAt: Date; readonly rotated: boolean }
  | { readonly kind: 'not_assigned' }
  | { readonly kind: 'semester_closed' };

export type RevokeCourseJoinCodeResult = 'revoked' | 'not_assigned' | 'missing';

export type JoinCourseByCodeResult =
  | { readonly kind: 'enrolled' | 'already_enrolled'; readonly course: CourseOfferingRecord }
  | { readonly kind: 'invalid_code' }
  | { readonly kind: 'not_student' }
  | { readonly kind: 'closed_enrollment' };

export interface StudentAcademicProfileRecord {
  readonly studentNumber: string;
  readonly studentNumberVerified: boolean;
  readonly departmentId: string | null;
  readonly departmentName: string | null;
  readonly programmeYears: number | null;
  readonly entryYear: number | null;
  readonly entryLevel: number;
  /** First calendar year of the institution's current academic session. */
  readonly sessionStartYear: number;
}

export interface CourseEnrollmentRepository {
  listAvailableSemesters(lecturerUserId: string, now: Date): Promise<LecturerSemesterRecord[]>;
  createCourseOffering(input: CreateCourseOfferingInput): Promise<CreateCourseOfferingResult>;
  listLecturerOfferings(lecturerUserId: string, now: Date): Promise<LecturerCourseOfferingRecord[]>;
  issueJoinCode(input: {
    readonly lecturerUserId: string;
    readonly courseOfferingId: string;
    readonly codeHash: string;
    readonly now: Date;
  }): Promise<IssueCourseJoinCodeResult>;
  revokeJoinCode(input: {
    readonly lecturerUserId: string;
    readonly courseOfferingId: string;
    readonly now: Date;
  }): Promise<RevokeCourseJoinCodeResult>;
  joinWithCode(input: {
    readonly studentUserId: string;
    readonly codeHash: string;
    readonly now: Date;
  }): Promise<JoinCourseByCodeResult>;
  listStudentEnrollments(studentUserId: string): Promise<StudentEnrollmentRecord[]>;
  getStudentAcademicProfile(studentUserId: string, now: Date): Promise<StudentAcademicProfileRecord | null>;
  /** Returns false when the account has no student profile. */
  updateStudentEntryLevel(studentUserId: string, entryLevel: 100 | 200 | 300): Promise<boolean>;
  listStudentDepartmentOptions(studentUserId: string): Promise<StudentDepartmentOptionRecord[]>;
  /** Sets a self-selected active department in the student's institution. */
  updateStudentDepartment(studentUserId: string, departmentId: string): Promise<'updated' | 'not_student' | 'department_unavailable'>;
}

export interface StudentDepartmentOptionRecord {
  readonly id: string;
  readonly name: string;
  readonly facultyName: string;
  readonly programmeYears: number;
}
