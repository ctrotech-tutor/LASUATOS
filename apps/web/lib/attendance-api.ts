import {
  AdministratorAttendanceOverviewSchema,
  AttendanceCorrectionRequestSchema,
  AttendanceCorrectionResponseSchema,
  AttendanceCorrectionsSchema,
  AdministratorAttendanceAppealCountSchema,
  AdministratorAttendanceAppealDecisionResponseSchema,
  AdministratorAttendanceAppealsSchema,
  AttendanceAppealDecisionRequestSchema,
  AttendanceAppealRequestSchema,
  AttendanceDisputeRequestSchema,
  AttendanceDisputeResolutionRequestSchema,
  LecturerAttendanceDisputeCountSchema,
  LecturerAttendanceDisputeResolutionResponseSchema,
  LecturerAttendanceDisputesSchema,
  StudentAttendanceDisputeResponseSchema,
  StudentAttendanceDisputesSchema,
  AttendanceReportOverviewSchema,
  AttendanceReportSchema,
  StudentAttendanceSummarySchema,
  AttendanceCodeRotationSchema,
  AttendanceSessionCreatedSchema,
  AttendanceSessionDetailSchema,
  AttendanceSessionQrChallengeSchema,
  AttendanceSessionsSchema,
  CheckInAttendanceRequestSchema,
  CheckInAttendanceResponseSchema,
  CheckedInAttendanceResponseSchema,
  type CheckedInAttendanceResponse,
  type CourseFaceRequiredResponse,
  type FaceFrame,
  CloseAttendanceSessionResponseSchema,
  CreateAttendanceSessionRequestSchema,
  StudentAttendanceHistorySchema,
  StudentOpenAttendanceSessionsSchema,
  UpdateAttendanceSessionSettingsRequestSchema,
  UpdateAttendanceSessionSettingsResponseSchema,
} from '@lasuatos/contracts';
import { getDeviceToken } from './check-in-device';
import { requestJson } from './course-api';
import { apiRequest, nextCheckInRetry, pause, type CheckInRetryState, type CheckInWaiting } from './lecture-api';

export async function loadLecturerAttendanceSessions(courseOfferingId?: string, signal?: AbortSignal) {
  const query = courseOfferingId ? `?courseOfferingId=${encodeURIComponent(courseOfferingId)}` : '';
  return requestJson(
    `/api/v1/lecturer/attendance-sessions${query}`,
    AttendanceSessionsSchema,
    signal ? { signal } : undefined,
  );
}

export async function createAttendanceSession(input: unknown) {
  const payload = CreateAttendanceSessionRequestSchema.parse(input);
  return requestJson('/api/v1/lecturer/attendance-sessions', AttendanceSessionCreatedSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function loadLecturerAttendanceSession(attendanceSessionId: string, signal?: AbortSignal) {
  return requestJson(
    `/api/v1/lecturer/attendance-sessions/${encodeURIComponent(attendanceSessionId)}`,
    AttendanceSessionDetailSchema,
    signal ? { signal } : undefined,
  );
}

export async function closeAttendanceSession(attendanceSessionId: string) {
  return requestJson(
    `/api/v1/lecturer/attendance-sessions/${encodeURIComponent(attendanceSessionId)}/close`,
    CloseAttendanceSessionResponseSchema,
    { method: 'POST' },
  );
}

export async function rotateAttendanceCode(attendanceSessionId: string) {
  return requestJson(
    `/api/v1/lecturer/attendance-sessions/${encodeURIComponent(attendanceSessionId)}/code`,
    AttendanceCodeRotationSchema,
    { method: 'POST' },
  );
}

/** Turns QR-only on or off, or adds minutes, for an open session. */
export async function updateAttendanceSessionSettings(
  attendanceSessionId: string,
  input: { readonly qrOnly?: boolean; readonly extendMinutes?: 5 | 10 | 15 | 30 },
) {
  const payload = UpdateAttendanceSessionSettingsRequestSchema.parse(input);
  return requestJson(
    `/api/v1/lecturer/attendance-sessions/${encodeURIComponent(attendanceSessionId)}/settings`,
    UpdateAttendanceSessionSettingsResponseSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

/** Current rotating QR challenge for a session the caller owns (lecturer display). */
export async function loadSessionQrChallenge(attendanceSessionId: string, signal?: AbortSignal) {
  return requestJson(
    `/api/v1/lecturer/attendance-sessions/${encodeURIComponent(attendanceSessionId)}/qr`,
    AttendanceSessionQrChallengeSchema,
    signal ? { signal } : undefined,
  );
}

export interface CheckInLocationInput {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number | null;
  readonly capturedAt: string;
}

export type CourseCheckInOutcome =
  | { readonly kind: 'marked'; readonly result: CheckedInAttendanceResponse }
  /** The student has no registered face yet: send them to register it, then scan again. */
  | { readonly kind: 'face_setup'; readonly session: CourseFaceRequiredResponse['session'] }
  /** They closed the camera. */
  | { readonly kind: 'cancelled'; readonly session: CourseFaceRequiredResponse['session'] };

/**
 * A course check-in from start to finish (ADR 033). The code or QR challenge
 * goes first; when face checks are on the answer is `face_required` with a
 * ticket, `captureFace` opens the camera (front, then the turn asked for) and
 * the photos go with the ticket. A busy server or a dropped connection gets
 * the same photos again by itself, as Take attendance does.
 */
export async function checkInToCourse(
  credential: { readonly code: string } | { readonly challenge: string },
  location: CheckInLocationInput | undefined,
  options: {
    readonly captureFace: (face: CourseFaceRequiredResponse['face'], session: CourseFaceRequiredResponse['session']) => Promise<FaceFrame[] | null>;
    readonly onWaiting?: (waiting: CheckInWaiting) => void;
  },
): Promise<CourseCheckInOutcome> {
  const deviceToken = getDeviceToken();
  const common = { ...(location ? { location } : {}), ...(deviceToken ? { deviceToken } : {}) };
  const first = await checkInAttendance({ ...credential, ...common });
  if (first.status !== 'face_required') return { kind: 'marked', result: first };
  if (!first.face.registered) return { kind: 'face_setup', session: first.session };
  const frames = await options.captureFace(first.face, first.session);
  if (!frames) return { kind: 'cancelled', session: first.session };
  const body = CheckInAttendanceRequestSchema.parse({ ticket: first.face.ticket, face: { frames }, ...common });
  const started = Date.now();
  const state: CheckInRetryState = { busy: 0, other: 0 };
  for (let attempt = 1; ; attempt += 1) {
    try {
      const result = await apiRequest('/api/v1/student/attendance/check-in', CheckedInAttendanceResponseSchema, { json: body });
      return { kind: 'marked', result };
    } catch (error) {
      const retry = nextCheckInRetry(error, state, Date.now() - started);
      if (!retry) throw error;
      options.onWaiting?.({ busy: retry.busy, attempt, retryInSeconds: Math.ceil(retry.delayMs / 1000) });
      await pause(retry.delayMs);
    }
  }
}

export async function checkInAttendance(input: unknown) {
  const payload = CheckInAttendanceRequestSchema.parse(input);
  return requestJson('/api/v1/student/attendance/check-in', CheckInAttendanceResponseSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function loadStudentAttendance(signal?: AbortSignal) {
  return requestJson(
    '/api/v1/student/attendance',
    StudentAttendanceHistorySchema,
    signal ? { signal } : undefined,
  );
}

export async function loadStudentOpenAttendanceSessions(signal?: AbortSignal) {
  return requestJson(
    '/api/v1/student/attendance/open',
    StudentOpenAttendanceSessionsSchema,
    signal ? { signal } : undefined,
  );
}

export async function loadStudentAttendanceSummary(signal?: AbortSignal) {
  return requestJson('/api/v1/student/attendance/summary', StudentAttendanceSummarySchema, signal ? { signal } : undefined);
}

function reportPath(courseOfferingId: string, threshold?: number, suffix = '') {
  const query = threshold ? `?threshold=${encodeURIComponent(String(threshold))}` : '';
  return `/api/v1/lecturer/course-offerings/${encodeURIComponent(courseOfferingId)}/attendance-report${suffix}${query}`;
}

export async function loadOfferingAttendanceReport(courseOfferingId: string, threshold?: number, signal?: AbortSignal) {
  return requestJson(reportPath(courseOfferingId, threshold), AttendanceReportSchema, signal ? { signal } : undefined);
}

/** Where each of the lecturer's courses stands (average, how many below `threshold`), for the reports list. */
export async function loadAttendanceReportOverview(threshold: number, signal?: AbortSignal) {
  return requestJson(
    `/api/v1/lecturer/attendance-report-overview?threshold=${encodeURIComponent(String(threshold))}`,
    AttendanceReportOverviewSchema,
    signal ? { signal } : undefined,
  );
}

/** Same-origin CSV download URL; the session cookie authorizes it. */
export function offeringAttendanceReportCsvUrl(courseOfferingId: string, threshold?: number) {
  return reportPath(courseOfferingId, threshold, '.csv');
}

export async function applyAttendanceCorrection(attendanceSessionId: string, input: unknown) {
  const payload = AttendanceCorrectionRequestSchema.parse(input);
  return requestJson(
    `/api/v1/lecturer/attendance-sessions/${encodeURIComponent(attendanceSessionId)}/corrections`,
    AttendanceCorrectionResponseSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

export async function loadAttendanceCorrections(attendanceSessionId: string, signal?: AbortSignal) {
  return requestJson(
    `/api/v1/lecturer/attendance-sessions/${encodeURIComponent(attendanceSessionId)}/corrections`,
    AttendanceCorrectionsSchema,
    signal ? { signal } : undefined,
  );
}

export async function loadAdministratorAttendanceOverview(signal?: AbortSignal) {
  return requestJson('/api/v1/admin/attendance', AdministratorAttendanceOverviewSchema, signal ? { signal } : undefined);
}

export async function loadStudentAttendanceDisputes(signal?: AbortSignal) {
  return requestJson('/api/v1/student/attendance/disputes', StudentAttendanceDisputesSchema, signal ? { signal } : undefined);
}

export async function submitAttendanceDispute(input: unknown) {
  const payload = AttendanceDisputeRequestSchema.parse(input);
  return requestJson('/api/v1/student/attendance/disputes', StudentAttendanceDisputeResponseSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export async function withdrawAttendanceDispute(disputeId: string) {
  return requestJson(
    `/api/v1/student/attendance/disputes/${encodeURIComponent(disputeId)}/withdraw`,
    StudentAttendanceDisputeResponseSchema,
    { method: 'POST' },
  );
}

export type LecturerDisputeFilter = 'open' | 'resolved' | 'all';

export async function loadLecturerAttendanceDisputes(
  options: { readonly status?: LecturerDisputeFilter; readonly courseOfferingId?: string } = {},
  signal?: AbortSignal,
) {
  const params = new URLSearchParams();
  if (options.status) params.set('status', options.status);
  if (options.courseOfferingId) params.set('courseOfferingId', options.courseOfferingId);
  const query = params.size ? `?${params.toString()}` : '';
  return requestJson(`/api/v1/lecturer/attendance-disputes${query}`, LecturerAttendanceDisputesSchema, signal ? { signal } : undefined);
}

export async function resolveAttendanceDispute(disputeId: string, input: unknown) {
  const payload = AttendanceDisputeResolutionRequestSchema.parse(input);
  return requestJson(
    `/api/v1/lecturer/attendance-disputes/${encodeURIComponent(disputeId)}/resolve`,
    LecturerAttendanceDisputeResolutionResponseSchema,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    },
  );
}

/** Window event fired after a lecturer decision so the navigation badge refreshes promptly. */
export const DISPUTES_CHANGED_EVENT = 'lasuatos:attendance-disputes-changed';

/**
 * Open-dispute count for the lecturer navigation badge. Unlike `requestJson`
 * it never redirects on 401 and returns null on any failure: a badge must not
 * interrupt the page it decorates.
 */
export async function loadLecturerOpenDisputeCount(signal?: AbortSignal): Promise<number | null> {
  try {
    const response = await fetch('/api/v1/lecturer/attendance-disputes/count', { cache: 'no-store', ...(signal ? { signal } : {}) });
    if (!response.ok) return null;
    const parsed = LecturerAttendanceDisputeCountSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.openCount : null;
  } catch {
    return null;
  }
}

/** Takes a rejected dispute to the course's department. */
export async function appealAttendanceDispute(disputeId: string, input: unknown) {
  const payload = AttendanceAppealRequestSchema.parse(input);
  return requestJson(
    `/api/v1/student/attendance/disputes/${encodeURIComponent(disputeId)}/appeal`,
    StudentAttendanceDisputeResponseSchema,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
  );
}

export async function withdrawAttendanceAppeal(disputeId: string) {
  return requestJson(
    `/api/v1/student/attendance/disputes/${encodeURIComponent(disputeId)}/appeal/withdraw`,
    StudentAttendanceDisputeResponseSchema,
    { method: 'POST' },
  );
}

export type AppealFilter = 'open' | 'decided' | 'all';

export async function loadAttendanceAppeals(status: AppealFilter, signal?: AbortSignal) {
  return requestJson(`/api/v1/admin/attendance-appeals?status=${status}`, AdministratorAttendanceAppealsSchema, signal ? { signal } : undefined);
}

export async function decideAttendanceAppeal(appealId: string, input: unknown) {
  const payload = AttendanceAppealDecisionRequestSchema.parse(input);
  return requestJson(
    `/api/v1/admin/attendance-appeals/${encodeURIComponent(appealId)}/decide`,
    AdministratorAttendanceAppealDecisionResponseSchema,
    { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) },
  );
}

/** Window event fired after an appeal decision so the administrator badge refreshes promptly. */
export const APPEALS_CHANGED_EVENT = 'lasuatos:attendance-appeals-changed';

/** Open appeals for the administrator navigation badge; null on any failure. */
export async function loadOpenAppealCount(signal?: AbortSignal): Promise<number | null> {
  try {
    const response = await fetch('/api/v1/admin/attendance-appeals/count', { cache: 'no-store', ...(signal ? { signal } : {}) });
    if (!response.ok) return null;
    const parsed = AdministratorAttendanceAppealCountSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.openCount : null;
  } catch {
    return null;
  }
}
