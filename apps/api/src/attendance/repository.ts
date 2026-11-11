export interface AttendanceSessionRecord {
  readonly id: string;
  readonly courseOfferingId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly title: string;
  readonly status: 'open' | 'closed';
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly closedAt: Date | null;
  readonly attendanceCount: number;
}

export interface AttendanceRecordSummary {
  readonly attendanceSessionId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly sessionTitle: string;
  readonly checkedInAt: Date;
}

export interface AttendanceAttendeeRecord {
  readonly displayName: string;
  readonly checkedInAt: Date;
}

export interface LecturerAttendanceSessionDetailRecord {
  readonly session: AttendanceSessionRecord;
  readonly attendees: AttendanceAttendeeRecord[];
}

export interface StudentAttendanceHistoryRecord {
  readonly attendanceSessionId: string;
  readonly courseOfferingId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly sessionTitle: string;
  readonly startsAt: Date;
  readonly checkedInAt: Date;
}

export interface CreateAttendanceSessionInput {
  readonly lecturerUserId: string;
  readonly courseOfferingId: string;
  readonly title: string;
  readonly codeHash: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export type CreateAttendanceSessionResult =
  | { readonly kind: 'created'; readonly session: AttendanceSessionRecord }
  | { readonly kind: 'not_assigned' }
  | { readonly kind: 'semester_unavailable' };

export type AttendanceSessionMutationResult = 'closed' | 'already_closed' | 'not_assigned';

export type RotateAttendanceCodeResult =
  | { readonly kind: 'rotated'; readonly expiresAt: Date }
  | { readonly kind: 'not_assigned' }
  | { readonly kind: 'session_closed' };

export type CheckInAttendanceResult =
  | { readonly kind: 'checked_in'; readonly attendance: AttendanceRecordSummary }
  | { readonly kind: 'already_checked_in'; readonly attendance: AttendanceRecordSummary }
  | { readonly kind: 'invalid_code' }
  | { readonly kind: 'session_closed' }
  | { readonly kind: 'not_enrolled' };

export interface AttendanceRepository {
  createSession(input: CreateAttendanceSessionInput): Promise<CreateAttendanceSessionResult>;
  listLecturerSessions(input: {
    readonly lecturerUserId: string;
    readonly courseOfferingId?: string;
    readonly now: Date;
  }): Promise<AttendanceSessionRecord[]>;
  getLecturerSession(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
  }): Promise<LecturerAttendanceSessionDetailRecord | null>;
  closeSession(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
    readonly now: Date;
  }): Promise<AttendanceSessionMutationResult>;
  rotateSessionCode(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
    readonly codeHash: string;
    readonly now: Date;
  }): Promise<RotateAttendanceCodeResult>;
  checkIn(input: {
    readonly studentUserId: string;
    readonly codeHash: string;
    readonly now: Date;
  }): Promise<CheckInAttendanceResult>;
  listStudentHistory(studentUserId: string): Promise<StudentAttendanceHistoryRecord[]>;
}
