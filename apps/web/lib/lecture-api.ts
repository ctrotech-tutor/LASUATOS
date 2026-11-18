import {
  ApiProblemSchema,
  AssistantsSchema,
  ClassRepListSchema,
  ClassRepSchema,
  ClassRepStudentSchema,
  CorrectLectureAttendeeResultSchema,
  FaceReviewCountSchema,
  FaceReviewItemSchema,
  FaceReviewListSchema,
  LectureHelpRequestStatusSchema,
  LectureAttendanceSummarySchema,
  LectureReportSchema,
  type LectureReportPeriod,
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
  LectureLecturerOptionsSchema,
  LectureStudentMatchesSchema,
  ResolvedLectureSchema,
  StudentLectureHistorySchema,
  type AddLectureAttendeeRequest,
  type CorrectLectureAttendeeRequest,
  type AppointClassRepRequest,
  type AppointAssistantRequest,
  type AssistantPermission,
  type CheckInLocationSample,
  type FaceFrame,
  type CreateLectureCourseRequest,
  type CreateLectureSessionRequest,
  type OneTimeSignIn,
  type UpdateLectureCourseRequest,
  type LectureCapabilities,
  type UpdateLectureSessionRequest,
} from '@lasuatos/contracts';
import { rememberedAnswer, rememberAnswer } from './remembered-answers';
import { getDeviceToken } from './check-in-device';

/** A failed request, with a message written for the person using the page. */
export class LectureRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** From the server's Retry-After header: how long to wait before sending the same request again. */
    readonly retryAfterSeconds: number | null = null,
  ) {
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

/**
 * No request waits longer than this. The server gives up at 30 seconds (the platform's limit), so
 * past this the connection itself has stalled, common on campus data, and a spinner such as
 * "Checking it's you…" would otherwise turn forever.
 */
export const REQUEST_TIMEOUT_MS = 45_000;
const TIMED_OUT = 'This is taking too long. Check your data or Wi-Fi and try again.';

async function request<T>(url: string, schema: Schema<T>, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, signal: callerSignal, ...rest } = init ?? {};
  const method = (rest.method ?? (json !== undefined ? 'POST' : 'GET')).toUpperCase();
  const conditional = method === 'GET' && rest.headers === undefined;
  const previous = conditional ? rememberedAnswer(url, schema) : undefined;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);
  // The caller's own cancel (leaving the page) still cancels, and still throws its AbortError.
  const relay = () => controller.abort(callerSignal?.reason);
  if (callerSignal?.aborted) relay();
  else callerSignal?.addEventListener('abort', relay, { once: true });
  try {
    let response: Response;
    try {
      response = await fetch(url, {
        ...rest,
        signal: controller.signal,
        cache: 'no-store',
        credentials: 'same-origin',
        ...(previous ? { headers: { 'if-none-match': previous.tag } } : {}),
        ...(json !== undefined
          ? { method: rest.method ?? 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(json) }
          : {}),
      });
    } catch (error) {
      if (timedOut) throw new LectureRequestError(0, TIMED_OUT);
      if (callerSignal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      throw new LectureRequestError(0, 'No connection. Check your data or Wi-Fi and try again.');
    }
    if (response.status === 304 && previous) {
      rememberAnswer(url, previous.tag, schema, previous.data);
      return previous.data as T;
    }
    let body: unknown = null;
    try {
      body = await response.json();
    } catch (error) {
      if (timedOut) throw new LectureRequestError(0, TIMED_OUT);
      if (callerSignal?.aborted) throw error;
      body = null;
    }
    const data = readReply(response, body, schema);
    if (conditional) rememberAnswer(url, response.headers.get('etag'), schema, data);
    return data;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', relay);
  }
}

function readReply<T>(response: Response, body: unknown, schema: Schema<T>): T {
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
    const retryAfter = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
    throw new LectureRequestError(response.status, message, Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null);
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

/** Fired when something the menu depends on changed (a lecturer's first course, say). */
export const CAPABILITIES_CHANGED = 'lasuatos:capabilities-changed';

/** Forgets the shared answer and tells the app frame to ask again. */
export function capabilitiesChanged(): void {
  capabilitiesCache = null;
  window.dispatchEvent(new Event(CAPABILITIES_CHANGED));
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

/** The attendance report for a period, optionally one department. */
export const loadLectureReport = (period: LectureReportPeriod, departmentId: string | null, signal?: AbortSignal) =>
  request(
    `/api/v1/lecture/report?period=${period}${departmentId ? `&department=${encodeURIComponent(departmentId)}` : ''}`,
    LectureReportSchema,
    signal ? { signal } : undefined,
  );

const NoContentSchema = { safeParse: () => ({ success: true as const, data: undefined }) };

/** Sent after this browser opens, changes or deletes a session, so the live indicator updates at once. */
export const LIVE_SESSIONS_CHANGED_EVENT = 'lasuatos:live-sessions-changed';

function announceSessionChange<T>(result: T): T {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LIVE_SESSIONS_CHANGED_EVENT));
  return result;
}

/** Sessions this person opened that are still taking attendance (the app frame's live indicator). */
export const loadMyLiveSessions = (signal?: AbortSignal) =>
  request('/api/v1/lecture/sessions?live=mine', LectureSessionListSchema, signal ? { signal } : undefined);

/** Deletes a session opened by mistake; `confirmCourseCode` is needed when anyone is on its list. */
export const deleteLectureSession = (sessionId: string, confirmCourseCode?: string) =>
  request(
    `/api/v1/lecture/sessions/${encodeURIComponent(sessionId)}/delete`,
    NoContentSchema,
    { json: confirmCourseCode ? { confirmCourseCode } : {} },
  ).then(announceSessionChange);

/** Courses with registers; their standing this semester is counted against `threshold`. */
export const loadRegisterCourses = (threshold: number, signal?: AbortSignal) =>
  request(`/api/v1/lecture/registers?threshold=${threshold}`, LectureRegisterCoursesSchema, signal ? { signal } : undefined);

export const loadCourseRegister = (courseCode: string, term?: string, signal?: AbortSignal) =>
  request(
    `/api/v1/lecture/register?course=${encodeURIComponent(courseCode)}${term ? `&term=${encodeURIComponent(term)}` : ''}`,
    LectureRegisterSchema,
    signal ? { signal } : undefined,
  );

export const createLectureSession = (input: CreateLectureSessionRequest) =>
  request('/api/v1/lecture/sessions', LectureSessionSummarySchema, { json: input }).then(announceSessionChange);

export const loadLectureSession = (sessionId: string, signal?: AbortSignal) =>
  request(`/api/v1/lecture/sessions/${encodeURIComponent(sessionId)}`, LectureSessionDetailSchema, signal ? { signal } : undefined);

export const loadLectureFrame = (sessionId: string, signal?: AbortSignal) =>
  request(`/api/v1/lecture/sessions/${encodeURIComponent(sessionId)}/qr`, LectureQrFrameSchema, signal ? { signal } : undefined);

export const updateLectureSession = (sessionId: string, input: UpdateLectureSessionRequest) =>
  request(`/api/v1/lecture/sessions/${encodeURIComponent(sessionId)}`, LectureSessionSummarySchema, { json: input }).then(announceSessionChange);

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

/** Lecturer names for the Lecturer field (own department first, then names typed before). */
export const loadLecturerOptions = (signal?: AbortSignal) =>
  request('/api/v1/lecture/lecturers', LectureLecturerOptionsSchema, signal ? { signal } : undefined);

/** Students matching a matric number or name, each marked if already on the session's list. */
export const searchSessionStudents = (sessionId: string, query: string, signal?: AbortSignal) =>
  request(
    `/api/v1/lecture/sessions/${encodeURIComponent(sessionId)}/students?q=${encodeURIComponent(query)}`,
    LectureStudentMatchesSchema,
    signal ? { signal } : undefined,
  );

/* ---------- students ---------- */

export const resolveLecture = (input: { challenge?: string; code?: string; scanned?: boolean }) =>
  request('/api/v1/lecture/resolve', ResolvedLectureSchema, { json: input });

/** How long a phone keeps sending a check-in again by itself (busy servers, dropped connections). */
export const CHECK_IN_RETRY_WINDOW_MS = 180_000;
/** Dropped connections, timeouts and gateway errors are tried again at most this many times. */
const CHECK_IN_CONNECTION_RETRIES = 3;

export interface CheckInRetryState {
  /** "Busy" answers so far (503 with Retry-After: the face checks are full). */
  busy: number;
  /** Dropped connections, timeouts and gateway errors so far. */
  other: number;
}

/**
 * Whether to send a failed check-in again, and after how long (null: stop
 * and show the error). Sending it again is safe: a check-in that was in fact
 * saved answers "already marked present", and the photos are the same.
 *
 * - Busy (503 with Retry-After): the server's face checks are full for the
 *   moment. Wait as asked, or longer each time "busy" comes back (3 s, then
 *   half as long again each time, up to 30 s), plus up to a quarter at random
 *   so a hall's phones do not all come back together. The lecture-start load
 *   test (apps/api/src/load/lecture-rush.ts) measured why: fixed short waits
 *   made a crowd ask tens of thousands of times.
 * - No answer, a timeout, or a 502/503/504 without Retry-After (the platform
 *   cut the request off or the server is starting): 2, 4, then 8 seconds.
 * - Never past CHECK_IN_RETRY_WINDOW_MS from the first send.
 */
export function nextCheckInRetry(
  error: unknown,
  state: CheckInRetryState,
  elapsedMs: number,
  random: () => number = Math.random,
): { delayMs: number; busy: boolean } | null {
  if (!(error instanceof LectureRequestError)) return null;
  const busy = error.status === 503 && error.retryAfterSeconds !== null;
  if (!busy && ![0, 502, 503, 504].includes(error.status)) return null;
  let delayMs: number;
  if (busy) {
    state.busy += 1;
    const backoff = Math.min(30, 3 * 1.5 ** (state.busy - 1));
    delayMs = Math.max(Math.min(error.retryAfterSeconds ?? 0, 60), backoff) * 1000 * (1 + random() * 0.25);
  } else {
    state.other += 1;
    if (state.other > CHECK_IN_CONNECTION_RETRIES) return null;
    delayMs = [2, 4, 8][state.other - 1]! * 1000 + random() * 1000;
  }
  if (elapsedMs + delayMs > CHECK_IN_RETRY_WINDOW_MS) return null;
  return { delayMs: Math.round(delayMs), busy };
}

/** What the check-in page shows while the phone waits to send again. */
export interface CheckInWaiting {
  /** True: the server is busy with other students' face checks. False: the connection dropped. */
  readonly busy: boolean;
  /** Sends so far (the first is 1). */
  readonly attempt: number;
  readonly retryInSeconds: number;
}

function pause(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', stop);
      resolve();
    }, milliseconds);
    const stop = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/**
 * Marks the signed-in student, or, with `signIn`, the classmate who typed their
 * own password on this phone. The phone's own sign-in is left as it was.
 *
 * When the server is busy (lecture-start rush) or the connection drops, the
 * same photos are sent again by itself (see nextCheckInRetry); `onWaiting`
 * tells the page, so the student knows to keep the page open.
 */
export async function submitLectureCheckIn(
  input: {
    ticket: string;
    signIn?: OneTimeSignIn;
    location?: CheckInLocationSample;
    face?: { frames: FaceFrame[] };
  },
  options: { signal?: AbortSignal; onWaiting?: (waiting: CheckInWaiting) => void } = {},
) {
  const deviceToken = getDeviceToken();
  const body = { ...input, ...(deviceToken ? { deviceToken } : {}) };
  const started = Date.now();
  const state: CheckInRetryState = { busy: 0, other: 0 };
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await request('/api/v1/lecture/check-in', LectureCheckInResultSchema, {
        json: body,
        ...(options.signal ? { signal: options.signal } : {}),
      });
    } catch (error) {
      const retry = nextCheckInRetry(error, state, Date.now() - started);
      if (!retry) throw error;
      options.onWaiting?.({ busy: retry.busy, attempt, retryInSeconds: Math.ceil(retry.delayMs / 1000) });
      await pause(retry.delayMs, options.signal);
    }
  }
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

/* ---------- assistants (AHOC, AGHOC) ---------- */

/** A HOC's or GHOC's assistants: the viewer's own team when `principalId` is left out. */
export const loadAssistants = (principalId: string | null, signal?: AbortSignal) =>
  request(`/api/v1/class-reps/assistants${principalId ? `?principalId=${encodeURIComponent(principalId)}` : ''}`, AssistantsSchema, signal ? { signal } : undefined);

export const lookupAssistantCandidate = (principalId: string | null, query: string) =>
  request('/api/v1/class-reps/assistants/lookup', ClassRepStudentSchema, { json: { query, ...(principalId ? { principalId } : {}) } });

export const appointAssistant = (input: AppointAssistantRequest) =>
  request('/api/v1/class-reps/assistants', ClassRepSchema, { json: input });

export const updateAssistant = (repId: string, permissions: readonly AssistantPermission[]) =>
  request(`/api/v1/class-reps/assistants/${encodeURIComponent(repId)}`, ClassRepSchema, { json: { permissions } });

/** Ends an assistant's appointment; an assistant may use it to step down. */
export const removeAssistant = (repId: string) =>
  request(`/api/v1/class-reps/assistants/${encodeURIComponent(repId)}/remove`, SavedSchema, { json: {} });

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

/* ---------- when the face check will not pass: asking the session taker ---------- */

/** The student asks to be added by hand (after the face check failed at least twice). */
export const requestLectureHelp = (input: { ticket: string; location?: CheckInLocationSample }) =>
  request('/api/v1/lecture/help-requests', LectureHelpRequestStatusSchema, { json: input });

/** The student's own request for a session (polled while they wait). */
export const loadLectureHelpStatus = (sessionId: string, signal?: AbortSignal) =>
  request(`/api/v1/lecture/sessions/${sessionId}/help-request`, LectureHelpRequestStatusSchema, signal ? { signal } : undefined);

export const decideLectureHelp = (sessionId: string, requestId: string, input: { decision: 'add' | 'decline'; location?: CheckInLocationSample }) =>
  request(`/api/v1/lecture/sessions/${sessionId}/help-requests/${requestId}`, SavedSchema, { json: input });

export const helpRequestPhotoUrl = (sessionId: string, requestId: string) =>
  `/api/v1/lecture/sessions/${sessionId}/help-requests/${requestId}/photo`;

/* ---------- face reviews (close matches) ---------- */

export function loadFaceReviews(query: { status: 'pending' | 'reviewed'; cursor?: string | null }, signal?: AbortSignal) {
  const params = new URLSearchParams({ status: query.status });
  if (query.cursor) params.set('cursor', query.cursor);
  return request(`/api/v1/lecture/face-reviews?${params.toString()}`, FaceReviewListSchema, signal ? { signal } : undefined);
}

/** How many wait for this person (the badge on Face checks). */
export const loadFaceReviewCount = (signal?: AbortSignal) =>
  request('/api/v1/lecture/face-reviews/count', FaceReviewCountSchema, signal ? { signal } : undefined).then((value) => value.pending);

/** Fired after a decision, so the badge on Face checks updates at once. */
export const FACE_REVIEWS_CHANGED_EVENT = 'lasuatos:face-reviews-changed';

export const decideFaceReview = (checkId: string, input: { decision: 'approve' | 'reject'; note?: string }) =>
  request(`/api/v1/lecture/face-reviews/${checkId}`, FaceReviewItemSchema, { json: input });

export const faceReviewPhotoUrl = (checkId: string, kind: 'check' | 'registered') =>
  `/api/v1/lecture/face-reviews/${checkId}/photo/${kind}`;
