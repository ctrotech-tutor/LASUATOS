import {
  AdministratorAttendanceOverviewSchema,
  AttendanceCorrectionRequestSchema,
  AttendanceCorrectionResponseSchema,
  AttendanceCorrectionsSchema,
  AttendanceDisputeRequestSchema,
  AttendanceDisputeResolutionRequestSchema,
  LecturerAttendanceDisputeCountSchema,
  LecturerAttendanceDisputeResolutionResponseSchema,
  LecturerAttendanceDisputesSchema,
  StudentAttendanceDisputeResponseSchema,
  StudentAttendanceDisputesSchema,
  AttendanceReportSchema,
  StudentAttendanceSummarySchema,
  AttendanceCodeRotationSchema,
  AttendanceSessionCreatedSchema,
  AttendanceSessionDetailSchema,
  AttendanceSessionQrChallengeSchema,
  AttendanceSessionsSchema,
  CheckInAttendanceRequestSchema,
  CheckInAttendanceResponseSchema,
  CloseAttendanceSessionResponseSchema,
  CreateAttendanceSessionRequestSchema,
  StudentAttendanceHistorySchema,
  StudentOpenAttendanceSessionsSchema,
} from '@lasuatos/contracts';
import { requestJson } from './course-api';

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

export async function checkInWithAttendanceCode(code: string, location?: CheckInLocationInput) {
  return checkInAttendance({ code, ...(location ? { location } : {}) });
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
