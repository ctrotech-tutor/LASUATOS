import {
  ApiProblemSchema,
  ClassRepListSchema,
  ClassRepSchema,
  ClassRepStudentSchema,
  CorrectLectureAttendeeResultSchema,
  LectureAttendanceSummarySchema,
  LectureCapabilitiesSchema,
  LectureCheckInResultSchema,
  LectureCatalogCourseSchema,
  LectureCourseCatalogSchema,
  LectureCourseChangeResultSchema,
  RenameCoursePrefixResultSchema,
  type RenameCoursePrefixRequest,
  LectureQrFrameSchema,
  LectureRegisterCoursesSchema,
  LectureRegisterSchema,
  LectureSessionDetailSchema,
  LectureSessionListSchema,
  LectureSessionSummarySchema,
  LectureVenueOptionsSchema,
  ResolvedLectureSchema,
  StudentLectureHistorySchema,
  type AddLectureAttendeeRequest,
  type CorrectLectureAttendeeRequest,
  type AppointClassRepRequest,
  type CheckInLocationSample,
  type FaceFrame,
  type CreateLectureCourseRequest,
  type CreateLectureSessionRequest,
  type OneTimeSignIn,
  type UpdateLectureCourseRequest,
  type LectureCapabilities,
  type UpdateLectureSessionRequest,
} from '@lasuatos/contracts';
import { getDeviceToken } from './check-in-device';

/** A failed request, with a message written for the person using the page. */
export class LectureRequestError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'LectureRequestError';
  }
}

const GENERIC_DETAILS = new Set([
  'The request is invalid.',
  'Authentication is required.',
  'You are not authorized to perform this action.',
  'The requested resource was not found.',
  'The request conflicts with the current resource state.',
  'The request could not be processed.',
]);

type Schema<T> = { safeParse(value: unknown): { success: true; data: T } | { success: false } };

async function request<T>(url: string, schema: Schema<T>, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let response: Response;
  try {
    response = await fetch(url, {
      ...rest,
      cache: 'no-store',
      credentials: 'same-origin',
      ...(json !== undefined
        ? { method: rest.method ?? 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }
        : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new LectureRequestError(0, 'No connection. Check your data or Wi-Fi and try again.');
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const problem = ApiProblemSchema.safeParse(body);
    const detail = problem.success ? problem.data.detail : undefined;
    let message = detail && !GENERIC_DETAILS.has(detail) ? detail : '';
    if (!message) {
      if (response.status === 401) message = 'Please sign in to continue.';
      else if (response.status >= 500) message = 'LASUATOS is busy or waking up. Wait a few seconds and try again.';
      else if (response.status === 429) message = 'Too many attempts. Wait a minute and try again.';
      else if (response.status === 404) message = 'Not found. It may have been removed.';
      else message = 'That did not work. Try again.';
    }
    throw new LectureRequestError(response.status, message);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) throw new LectureRequestError(response.status, 'Unexpected reply from the server. Refresh the page.');
  return parsed.data;
}

const SavedSchema = { safeParse: (value: unknown) => ({ success: true as const, data: value }) };

/** The shared JSON request helper: server-written messages become LectureRequestError. */
export const apiRequest = request;

export function failureText(error: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (error instanceof LectureRequestError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/* ---------- people taking attendance ---------- */

let capabilitiesCache: { at: number; promise: Promise<LectureCapabilities> } | null = null;

/** Shared for 30 seconds so the navigation and the page ask once. */
export function loadLectureCapabilities(): Promise<LectureCapabilities> {
  const now = Date.now();
  if (!capabilitiesCache || now - capabilitiesCache.at > 30_000) {
    const promise = request('/api/v1/lecture/capabilities', LectureCapabilitiesSchema);
    capabilitiesCache = { at: now, promise };
    promise.catch(() => {
      if (capabilitiesCache?.promise === promise) capabilitiesCache = null;
    });
  }
  return capabilitiesCache.promise;
}

export function loadLectureSessions(signal?: AbortSignal, options: { before?: string; q?: string } = {}) {
  const params = new URLSearchParams();
  if (options.before) params.set('before', options.before);
  if (options.q?.trim()) params.set('q', options.q.trim());
  const query = params.toString();
  return request(`/api/v1/lecture/sessions${query ? `?${query}` : ''}`, LectureSessionListSchema, signal ? { signal } : undefined);
}

/** Attendance across every session the person can see (7, 30 or 90 days). */
export const loadLectureSummary = (days: 7 | 30 | 90, signal?: AbortSignal) =>
  request(`/api/v1/lecture/summary?days=${days}`, LectureAttendanceSummarySchema, signal ? { signal } : undefined);

const NoContentSchema = { safeParse: () => ({ success: true as const, data: undefined }) };

/** Deletes a session opened by mistake; `confirmCourseCode` is needed when anyone is on its list. */
export const deleteLectureSession = (sessionId: string, confirmCourseCode?: string) =>
  request(
    `/api/v1/lecture/sessions/${encodeURIComponent(sessionId)}/delete`,
    NoContentSchema,
    { json: confirmCourseCode ? { confirmCourseCode } : {} },
  );

export const loadRegisterCourses = (signal?: AbortSignal) =>
  request('/api/v1/lecture/registers', LectureRegisterCoursesSchema, signal ? { signal } : undefined);

export const loadCourseRegister = (courseCode: string, term?: string, signal?: AbortSignal) =>
  request(
    `/api/v1/lecture/register?course=${encodeURIComponent(courseCode)}${term ? `&term=${encodeURIComponent(term)}` : ''}`,
    LectureRegisterSchema,
    signal ? { signal } : undefined,
  );

export const createLectureSession = (input: CreateLectureSessionRequest) =>
  request('/api/v1/lecture/sessions', LectureSessionSummarySchema, { json: input });

export const loadLectureSession = (sessionId: string, signal?: AbortSignal) =>
  request(`/api/v1/lecture/sessions/${encodeURIComponent(sessionId)}`, LectureSessionDetailSchema, signal ? { signal } : undefined);

export const loadLectureFrame = (sessionId: string, signal?: AbortSignal) =>
  request(`/api/v1/lecture/sessions/${encodeURIComponent(sessionId)}/qr`, LectureQrFrameSchema, signal ? { signal } : undefined);

export const updateLectureSession = (sessionId: string, input: UpdateLectureSessionRequest) =>
  request(`/api/v1/lecture/sessions/${encodeURIComponent(sessionId)}`, LectureSessionSummarySchema, { json: input });

export const setLectureAttendeeRemoved = (sessionId: string, attendeeId: string, input: { reason?: string; restore?: boolean }) =>
  request(
    `/api/v1/lecture/sessions/${encodeURIComponent(sessionId)}/attendees/${encodeURIComponent(attendeeId)}`,
    SavedSchema,
    { json: input },
  );

/** Fixes the name or matric number typed on a guest entry. */
export const correctLectureAttendee = (sessionId: string, attendeeId: string, input: CorrectLectureAttendeeRequest) =>
  request(
    `/api/v1/lecture/sessions/${encodeURIComponent(sessionId)}/attendees/${encodeURIComponent(attendeeId)}/details`,
    CorrectLectureAttendeeResultSchema,
    { json: input },
  );

type AddedAttendee = { status: 'added' | 'restored'; fullName: string; matricNumber: string };
const AddedAttendeeSchema = {
  safeParse: (value: unknown) => {
    const item = value as Partial<AddedAttendee> | null;
    return item && (item.status === 'added' || item.status === 'restored') && typeof item.fullName === 'string'
      ? { success: true as const, data: item as AddedAttendee }
      : { success: false as const };
  },
};

/** The session taker adds a student by hand (dead phone, no smartphone). */
export const addLectureAttendee = (sessionId: string, input: AddLectureAttendeeRequest) =>
  request(`/api/v1/lecture/sessions/${encodeURIComponent(sessionId)}/attendees`, AddedAttendeeSchema, { json: input });

export const loadCourseCatalog = (signal?: AbortSignal, options: { readonly includeHidden?: boolean } = {}) =>
  request(`/api/v1/lecture/course-catalog${options.includeHidden ? '?include=hidden' : ''}`, LectureCourseCatalogSchema, signal ? { signal } : undefined);

export const addCatalogCourse = (input: CreateLectureCourseRequest) =>
  request('/api/v1/lecture/course-catalog', LectureCatalogCourseSchema, { json: input });

/** Changes a course: an added one by id, or (administrators) a built-in one by its code. */
export const updateCatalogCourse = (target: { readonly id: string | null; readonly code: string }, input: UpdateLectureCourseRequest) =>
  request(
    target.id
      ? `/api/v1/lecture/course-catalog/${encodeURIComponent(target.id)}`
      : `/api/v1/lecture/course-catalog/standard/${encodeURIComponent(target.code.replace(/\s+/g, ''))}`,
    LectureCourseChangeResultSchema,
    { json: input },
  );

export const renameCoursePrefix = (input: RenameCoursePrefixRequest) =>
  request('/api/v1/lecture/course-catalog/rename-prefix', RenameCoursePrefixResultSchema, { json: input });

export const removeCatalogCourse = (courseId: string) =>
  request(`/api/v1/lecture/course-catalog/${encodeURIComponent(courseId)}/remove`, SavedSchema, { json: {} });

export const loadLectureVenues = (signal?: AbortSignal) =>
  request('/api/v1/lecture/venues', LectureVenueOptionsSchema, signal ? { signal } : undefined);

/* ---------- students ---------- */

export const resolveLecture = (input: { challenge?: string; code?: string; scanned?: boolean }) =>
  request('/api/v1/lecture/resolve', ResolvedLectureSchema, { json: input });

/**
 * Marks the signed-in student, or, with `signIn`, the classmate who typed their
 * own password on this phone. The phone's own sign-in is left as it was.
 */
export function submitLectureCheckIn(input: {
  ticket: string;
  signIn?: OneTimeSignIn;
  location?: CheckInLocationSample;
  face?: { frames: FaceFrame[] };
}) {
  const deviceToken = getDeviceToken();
  return request('/api/v1/lecture/check-in', LectureCheckInResultSchema, {
    json: { ...input, ...(deviceToken ? { deviceToken } : {}) },
  });
}

export const loadStudentLectureHistory = (signal?: AbortSignal) =>
  request('/api/v1/student/lecture-history', StudentLectureHistorySchema, signal ? { signal } : undefined);

/* ---------- class representatives ---------- */

export const loadClassReps = (signal?: AbortSignal) =>
  request('/api/v1/class-reps', ClassRepListSchema, signal ? { signal } : undefined);

export const lookupClassRepStudent = (query: string) =>
  request('/api/v1/class-reps/lookup', ClassRepStudentSchema, { json: { query } });

export const appointClassRep = (input: AppointClassRepRequest) =>
  request('/api/v1/class-reps', ClassRepSchema, { json: input });

export const revokeClassRep = (repId: string) =>
  request(`/api/v1/class-reps/${encodeURIComponent(repId)}/revoke`, SavedSchema, { json: {} });

/* ---------- old guest details ---------- */

/** Clears the name and matric number older versions kept on the phone for guest check-in. */
export function forgetOldGuestDetails(): void {
  try {
    window.localStorage.removeItem('lasuatos.guestStudent');
  } catch {
    // Storage blocked: nothing was kept.
  }
}

/** "K7M2-9QXD" for an 8-character code, "K7M 29Q" for a 6-character one. */
export function formatAttendanceCode(code: string): string {
  if (code.length === 8) return `${code.slice(0, 4)}-${code.slice(4)}`;
  if (code.length === 6) return `${code.slice(0, 3)} ${code.slice(3)}`;
  return code;
}

// Formatters are built once: creating Intl objects per row is slow in long lists.
const clockFormat = new Intl.DateTimeFormat('en-NG', { timeStyle: 'short', timeZone: 'Africa/Lagos' });
const dayFormat = new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const shortDayFormat = new Intl.DateTimeFormat('en-NG', { day: 'numeric', month: 'short', timeZone: 'Africa/Lagos' });
const isoDayFormat = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Africa/Lagos' });

export function formatClock(value: string | Date): string {
  return clockFormat.format(new Date(value));
}

export function formatDay(value: string | Date): string {
  return dayFormat.format(new Date(value));
}

/** "12 Nov" */
export function formatShortDay(value: string | Date): string {
  return shortDayFormat.format(new Date(value));
}

/** "12/11/2026" — the date format used on Nigerian registers and spreadsheets. */
export function formatSheetDate(value: string | Date): string {
  return isoDayFormat.format(new Date(value));
}
