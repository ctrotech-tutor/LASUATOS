import {
  ApiProblemSchema,
  ClassRepListSchema,
  ClassRepSchema,
  ClassRepStudentSchema,
  CorrectLectureAttendeeResultSchema,
  LectureCapabilitiesSchema,
  LectureCheckInResultSchema,
  LectureCourseSuggestionsSchema,
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
  type CreateLectureSessionRequest,
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

export const loadLectureSessions = (signal?: AbortSignal) =>
  request('/api/v1/lecture/sessions', LectureSessionListSchema, signal ? { signal } : undefined);

export const loadRegisterCourses = (signal?: AbortSignal) =>
  request('/api/v1/lecture/registers', LectureRegisterCoursesSchema, signal ? { signal } : undefined);

export const loadCourseRegister = (courseCode: string, signal?: AbortSignal) =>
  request(`/api/v1/lecture/register?course=${encodeURIComponent(courseCode)}`, LectureRegisterSchema, signal ? { signal } : undefined);

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

export const loadCourseSuggestions = (signal?: AbortSignal) =>
  request('/api/v1/lecture/course-suggestions', LectureCourseSuggestionsSchema, signal ? { signal } : undefined);

export const loadLectureVenues = (signal?: AbortSignal) =>
  request('/api/v1/lecture/venues', LectureVenueOptionsSchema, signal ? { signal } : undefined);

/* ---------- students ---------- */

export const resolveLecture = (input: { challenge?: string; code?: string; scanned?: boolean }) =>
  request('/api/v1/lecture/resolve', ResolvedLectureSchema, { json: input });

export function submitLectureCheckIn(input: {
  ticket: string;
  fullName?: string;
  matricNumber?: string;
  location?: CheckInLocationSample;
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

/* ---------- guest details remembered on this phone ---------- */

const GUEST_KEY = 'lasuatos.guestStudent';

export function rememberedGuest(): { fullName: string; matricNumber: string } | null {
  try {
    const raw = window.localStorage.getItem(GUEST_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { fullName?: unknown; matricNumber?: unknown };
    if (typeof value.fullName === 'string' && typeof value.matricNumber === 'string') {
      return { fullName: value.fullName.slice(0, 160), matricNumber: value.matricNumber.slice(0, 32) };
    }
  } catch {
    // Storage blocked or corrupt: the form simply starts empty.
  }
  return null;
}

export function rememberGuest(details: { fullName: string; matricNumber: string } | null): void {
  try {
    if (details) window.localStorage.setItem(GUEST_KEY, JSON.stringify(details));
    else window.localStorage.removeItem(GUEST_KEY);
  } catch {
    // Ignore: remembering is a convenience only.
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
