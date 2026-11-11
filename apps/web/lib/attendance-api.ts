import {
  AdministratorAttendanceOverviewSchema,
  AttendanceCorrectionRequestSchema,
  AttendanceCorrectionResponseSchema,
  AttendanceCorrectionsSchema,
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
