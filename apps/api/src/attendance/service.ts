import { randomBytes } from 'node:crypto';
import { hashOpaqueToken } from '@lasuatos/auth';
import type {
  AttendanceRepository,
  AttendanceSessionRecord,
  StudentAttendanceHistoryRecord,
  StudentOpenAttendanceSessionRecord,
} from './repository.js';

const ATTENDANCE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ATTENDANCE_CODE_LENGTH = 12;
const ATTENDANCE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/;

function attendanceCode(): string {
  return [...randomBytes(ATTENDANCE_CODE_LENGTH)]
    .map((byte) => ATTENDANCE_CODE_ALPHABET[byte & 31])
    .join('');
}

function publicSession(session: AttendanceSessionRecord, now: Date) {
  const status = session.status === 'closed'
    ? 'closed'
    : session.endsAt <= now
      ? 'expired'
      : 'open';
  return { ...session, status };
}

export class AttendanceSessionUnavailableError extends Error {
  readonly statusCode = 404;
  constructor() {
    super('The course offering is not available to this lecturer.');
    this.name = 'AttendanceSessionUnavailableError';
  }
}

export class AttendanceSemesterUnavailableError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('Attendance sessions can only be opened during an active semester.');
    this.name = 'AttendanceSemesterUnavailableError';
  }
}

export class AttendanceSessionDurationError extends Error {
  readonly statusCode = 400;
  constructor() {
    super('Choose an attendance duration between 5 and 240 minutes.');
    this.name = 'AttendanceSessionDurationError';
  }
}

export class AttendanceSessionClosedError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('This attendance session is closed or has expired.');
    this.name = 'AttendanceSessionClosedError';
  }
}

export class InvalidAttendanceCodeError extends Error {
  readonly statusCode = 400;
  constructor() {
    super('This attendance code is invalid or no longer active.');
    this.name = 'InvalidAttendanceCodeError';
  }
}

export class AttendanceNotEnrolledError extends Error {
  readonly statusCode = 403;
  constructor() {
    super('Join this course before checking in to its attendance session.');
    this.name = 'AttendanceNotEnrolledError';
  }
}

export class AttendanceSessionConflictError extends Error {
  readonly statusCode = 409;
  constructor() {
    super('This attendance session has already been closed.');
    this.name = 'AttendanceSessionConflictError';
  }
}

export class AttendanceService {
  readonly #repository: AttendanceRepository;
  readonly #now: () => Date;

  constructor(options: { readonly repository: AttendanceRepository; readonly now?: () => Date }) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
  }

  async createSession(lecturerUserId: string, input: {
    readonly courseOfferingId: string;
    readonly title: string;
    readonly durationMinutes: number;
  }) {
    if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 5 || input.durationMinutes > 240) {
      throw new AttendanceSessionDurationError();
    }
    const now = this.#now();
    const code = attendanceCode();
    const result = await this.#repository.createSession({
      lecturerUserId,
      courseOfferingId: input.courseOfferingId,
      title: input.title.trim(),
      codeHash: hashOpaqueToken(code),
      startsAt: now,
      endsAt: new Date(now.getTime() + input.durationMinutes * 60_000),
    });
    if (result.kind === 'not_assigned') throw new AttendanceSessionUnavailableError();
    if (result.kind === 'semester_unavailable') throw new AttendanceSemesterUnavailableError();
    return { code, session: publicSession(result.session, now) };
  }

  async listLecturerSessions(lecturerUserId: string, courseOfferingId?: string) {
    const now = this.#now();
    const sessions = await this.#repository.listLecturerSessions({
      lecturerUserId,
      ...(courseOfferingId ? { courseOfferingId } : {}),
      now,
    });
    return sessions.map((session) => publicSession(session, now));
  }

  async getLecturerSession(lecturerUserId: string, attendanceSessionId: string) {
    const detail = await this.#repository.getLecturerSession({ lecturerUserId, attendanceSessionId });
    if (!detail) throw new AttendanceSessionUnavailableError();
    return {
      session: publicSession(detail.session, this.#now()),
      attendees: detail.attendees,
    };
  }

  async closeSession(lecturerUserId: string, attendanceSessionId: string) {
    const result = await this.#repository.closeSession({
      lecturerUserId,
      attendanceSessionId,
      now: this.#now(),
    });
    if (result === 'not_assigned') throw new AttendanceSessionUnavailableError();
    return result;
  }

  async rotateSessionCode(lecturerUserId: string, attendanceSessionId: string) {
    const code = attendanceCode();
    const result = await this.#repository.rotateSessionCode({
      lecturerUserId,
      attendanceSessionId,
      codeHash: hashOpaqueToken(code),
      now: this.#now(),
    });
    if (result.kind === 'not_assigned') throw new AttendanceSessionUnavailableError();
    if (result.kind === 'session_closed') throw new AttendanceSessionClosedError();
    return { code, expiresAt: result.expiresAt };
  }

  async checkIn(studentUserId: string, suppliedCode: string) {
    const normalizedCode = suppliedCode.replace(/[\s-]/g, '').toUpperCase();
    if (!ATTENDANCE_CODE_PATTERN.test(normalizedCode)) throw new InvalidAttendanceCodeError();
    const result = await this.#repository.checkIn({
      studentUserId,
      codeHash: hashOpaqueToken(normalizedCode),
      now: this.#now(),
    });
    if (result.kind === 'invalid_code') throw new InvalidAttendanceCodeError();
    if (result.kind === 'session_closed') throw new AttendanceSessionClosedError();
    if (result.kind === 'not_enrolled') throw new AttendanceNotEnrolledError();
    return result;
  }

  async listStudentHistory(studentUserId: string): Promise<StudentAttendanceHistoryRecord[]> {
    return this.#repository.listStudentHistory(studentUserId);
  }

  async listStudentOpenSessions(studentUserId: string): Promise<StudentOpenAttendanceSessionRecord[]> {
    return this.#repository.listStudentOpenSessions({ studentUserId, now: this.#now() });
  }
}
