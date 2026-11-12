import {
  ApiProblemSchema,
  CreateCourseOfferingRequestSchema,
  CreateCourseOfferingResponseSchema,
  IssueCourseJoinCodeResponseSchema,
  JoinCourseRequestSchema,
  JoinCourseResponseSchema,
  LecturerCourseOfferingsSchema,
  LecturerSemestersSchema,
  StudentAcademicProfileSchema,
  StudentDepartmentOptionsSchema,
  StudentEnrollmentsSchema,
  UpdateStudentDepartmentRequestSchema,
  UpdateStudentEntryLevelRequestSchema,
} from '@lasuatos/contracts';

export interface ApiFailure {
  readonly message: string;
  readonly status: number;
}

export async function requestJson<T>(
  url: string,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store' });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    if (response.status === 401 && typeof window !== 'undefined') {
      window.location.assign('/sign-in');
    }
    const problem = ApiProblemSchema.safeParse(body);
    const error: ApiFailure = {
      status: response.status,
      message: response.status === 503
        ? 'Academic services are unavailable until the database is configured.'
        : problem.success && problem.data.detail
          ? problem.data.detail
          : 'The request could not be completed. Try again.',
    };
    throw error;
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw { status: response.status, message: 'The server returned an unexpected response.' } satisfies ApiFailure;
  return parsed.data;
}

export async function loadStudentEnrollments(signal?: AbortSignal) {
  return requestJson('/api/v1/enrollments', StudentEnrollmentsSchema, signal ? { signal } : undefined);
}

export async function joinCourse(code: string) {
  const input = JoinCourseRequestSchema.parse({ code });
  return requestJson('/api/v1/enrollments/join', JoinCourseResponseSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function loadLecturerSemesters(signal?: AbortSignal) {
  return requestJson('/api/v1/lecturer/semesters', LecturerSemestersSchema, signal ? { signal } : undefined);
}

export async function loadLecturerOfferings(signal?: AbortSignal) {
  return requestJson('/api/v1/lecturer/course-offerings', LecturerCourseOfferingsSchema, signal ? { signal } : undefined);
}

export async function createCourseOffering(input: unknown) {
  const payload = CreateCourseOfferingRequestSchema.parse(input);
  return requestJson('/api/v1/lecturer/course-offerings', CreateCourseOfferingResponseSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function issueCourseJoinCode(courseOfferingId: string) {
  return requestJson(
    `/api/v1/lecturer/course-offerings/${encodeURIComponent(courseOfferingId)}/join-code`,
    IssueCourseJoinCodeResponseSchema,
    { method: 'POST' },
  );
}

export async function revokeCourseJoinCode(courseOfferingId: string): Promise<void> {
  const response = await fetch(`/api/v1/lecturer/course-offerings/${encodeURIComponent(courseOfferingId)}/join-code`, {
    method: 'DELETE',
    cache: 'no-store',
  });
  if (response.ok) return;
  if (response.status === 401 && typeof window !== 'undefined') {
    window.location.assign('/sign-in');
  }
  let body: unknown;
  try { body = await response.json(); } catch { body = null; }
  const problem = ApiProblemSchema.safeParse(body);
  throw {
    status: response.status,
    message: response.status === 503
      ? 'Academic services are unavailable until the database is configured.'
      : problem.success && problem.data.detail
        ? problem.data.detail
        : 'The request could not be completed. Try again.',
  } satisfies ApiFailure;
}

/** The signed-in student's matric-derived level and the details behind it. */
export async function loadStudentAcademicProfile(signal?: AbortSignal) {
  return requestJson('/api/v1/student/profile', StudentAcademicProfileSchema, signal ? { signal } : undefined);
}

/** Records how the student entered: 100 Level (UTME) or 200/300 Level (Direct Entry). */
export async function updateStudentEntryLevel(entryLevel: 100 | 200 | 300) {
  const input = UpdateStudentEntryLevelRequestSchema.parse({ entryLevel });
  return requestJson('/api/v1/student/profile/entry-level', StudentAcademicProfileSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export async function loadStudentDepartmentOptions(signal?: AbortSignal) {
  return requestJson('/api/v1/student/profile/departments', StudentDepartmentOptionsSchema, signal ? { signal } : undefined);
}

/** Records the student's department, which sets the programme length (4, 5 or 6 years) behind the level. */
export async function updateStudentDepartment(departmentId: string) {
  const input = UpdateStudentDepartmentRequestSchema.parse({ departmentId });
  return requestJson('/api/v1/student/profile/department', StudentAcademicProfileSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
}
