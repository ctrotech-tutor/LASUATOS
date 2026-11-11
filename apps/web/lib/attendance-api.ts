import {
  AttendanceCodeRotationSchema,
  AttendanceSessionCreatedSchema,
  AttendanceSessionDetailSchema,
  AttendanceSessionsSchema,
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

export async function checkInWithAttendanceCode(code: string) {
  return requestJson('/api/v1/student/attendance/check-in', CheckInAttendanceResponseSchema, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code }),
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
