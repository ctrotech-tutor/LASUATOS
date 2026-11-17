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
  StudentEnrollmentsSchema,
  LecturerCourseOfferingSchema,
  UpdateCourseOfferingRequestSchema,
} from '@lasuatos/contracts';
import { rememberedAnswer, rememberAnswer } from './remembered-answers';
import { z } from 'zod';

export interface ApiFailure {
  readonly message: string;
  readonly status: number;
}

export async function requestJson<T>(
  url: string,
  schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
  init?: RequestInit,
): Promise<T> {
  const conditional = (init?.method ?? 'GET').toUpperCase() === 'GET' && init?.headers === undefined;
  const previous = conditional ? rememberedAnswer(url, schema) : undefined;
  const response = await fetch(url, {
    ...init,
    cache: 'no-store',
    ...(previous ? { headers: { 'if-none-match': previous.tag } } : {}),
  });
  if (response.status === 304 && previous) {
    rememberAnswer(url, previous.tag, schema, previous.data);
    return previous.data as T;
  }
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
  if (conditional) rememberAnswer(url, response.headers.get('etag'), schema, parsed.data);
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

const CourseOfferingUpdatedSchema = z.object({ status: z.literal('updated'), offering: LecturerCourseOfferingSchema });

/**
 * Corrects an assigned offering. The title and credit units belong to the
 * course code, so they change on every offering of that code; the level is
 * this offering's own.
 */
export async function updateCourseOffering(courseOfferingId: string, input: unknown) {
  const payload = UpdateCourseOfferingRequestSchema.parse(input);
  return requestJson(`/api/v1/lecturer/course-offerings/${encodeURIComponent(courseOfferingId)}`, CourseOfferingUpdatedSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
