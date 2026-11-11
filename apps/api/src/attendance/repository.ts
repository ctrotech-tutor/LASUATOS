export interface AttendanceSessionRecord {
  readonly id: string;
  readonly courseOfferingId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly title: string;
  readonly venueId: string | null;
  readonly venueCode: string | null;
  readonly venueName: string | null;
  readonly locationRequired: boolean;
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
  readonly venueName: string | null;
  readonly venueOutcome: 'within_boundary' | 'inconclusive' | null;
  readonly checkedInAt: Date;
}

export interface AttendanceAttendeeRecord {
  readonly displayName: string;
  readonly checkedInAt: Date;
  readonly method: 'code' | 'qr_code';
  readonly venueOutcome: 'within_boundary' | 'inconclusive' | null;
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
  readonly venueName: string | null;
  readonly venueOutcome: 'within_boundary' | 'inconclusive' | null;
  readonly startsAt: Date;
  readonly checkedInAt: Date;
}

export interface StudentOpenAttendanceSessionRecord {
  readonly attendanceSessionId: string;
  readonly courseOfferingId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly sessionTitle: string;
  readonly venueCode: string | null;
  readonly venueName: string | null;
  readonly locationRequired: boolean;
  readonly endsAt: Date;
}

export interface CreateAttendanceSessionInput {
  readonly lecturerUserId: string;
  readonly courseOfferingId: string;
  readonly venueId: string | null;
  readonly qrSecret: string;
  readonly title: string;
  readonly codeHash: string;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export type CreateAttendanceSessionResult =
  | { readonly kind: 'created'; readonly session: AttendanceSessionRecord }
  | { readonly kind: 'not_assigned' }
  | { readonly kind: 'semester_unavailable' }
  | { readonly kind: 'venue_unavailable' };

export type AttendanceSessionMutationResult = 'closed' | 'already_closed' | 'not_assigned';

export type RotateAttendanceCodeResult =
  | { readonly kind: 'rotated'; readonly expiresAt: Date }
  | { readonly kind: 'not_assigned' }
  | { readonly kind: 'session_closed' };

/** Venue snapshot taken inside the check-in transaction. */
export interface CheckInVenueSnapshot {
  readonly venueId: string;
  readonly venueCode: string;
  readonly venueName: string;
  readonly venueStatus: 'pending_review' | 'active' | 'inactive';
  readonly locationRequired: boolean;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly radiusMeters: number | null;
}

export interface CheckInSessionContext {
  readonly sessionId: string;
  readonly institutionId: string;
  readonly courseOfferingId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly sessionTitle: string;
  readonly status: 'open' | 'closed';
  readonly startsAt: Date;
  readonly endsAt: Date;
  readonly venue: CheckInVenueSnapshot | null;
  /** This student's existing check-in time, if any. */
  readonly existingCheckedInAt: Date | null;
  readonly enrolled: boolean;
}

export type CheckInPrepareResult =
  | { readonly kind: 'prepared'; readonly context: CheckInSessionContext }
  | { readonly kind: 'invalid_credential' };

export interface CheckInLocationEvidence {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyMeters: number | null;
  readonly capturedAt: Date;
  readonly distanceMeters: number;
  readonly radiusMeters: number;
  readonly outcome: 'within_boundary' | 'inconclusive';
}

export type CheckInCommitResult =
  | { readonly kind: 'checked_in'; readonly attendance: AttendanceRecordSummary }
  | { readonly kind: 'already_checked_in'; readonly attendance: AttendanceRecordSummary }
  | { readonly kind: 'session_closed' }
  /** The venue changed between evaluation and commit; the caller must retry. */
  | { readonly kind: 'venue_changed' };

export interface SessionQrMaterial {
  readonly sessionId: string;
  readonly qrSecret: string | null;
  readonly status: 'open' | 'closed';
  readonly endsAt: Date;
}

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
  /** Resolves a session id from a typed code hash. No row locking. */
  resolveSessionIdByCodeHash(codeHash: string): Promise<string | null>;
  /**
   * Returns the QR secret for a session id presented in a QR challenge, used
   * to verify the HMAC server-side before any check-in work. The secret is
   * never returned by any HTTP endpoint.
   */
  getSessionQrSecretForCheckIn(sessionId: string): Promise<{ readonly qrSecret: string | null } | null>;
  /** Assignment-guarded QR challenge material for the session owner. */
  getSessionQrMaterial(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
  }): Promise<SessionQrMaterial | null>;
  /** Backfills the QR secret for sessions created before rotation support. */
  setSessionQrSecret(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
    readonly qrSecret: string;
  }): Promise<boolean>;
  /**
   * Loads the check-in decision context (session, venue snapshot, enrollment,
   * duplicate) without committing anything.
   */
  prepareCheckIn(input: {
    readonly studentUserId: string;
    readonly sessionId: string;
    readonly now: Date;
  }): Promise<CheckInPrepareResult>;
  /**
   * Atomically re-validates the session, verifies the venue snapshot is
   * unchanged since evaluation, and inserts the attendance record plus its
   * location evidence when present.
   */
  commitCheckIn(input: {
    readonly studentUserId: string;
    readonly sessionId: string;
    readonly method: 'code' | 'qr_code';
    readonly venueSignature: string | null;
    readonly evidence: CheckInLocationEvidence | null;
    readonly venueOutcome: 'within_boundary' | 'inconclusive' | null;
    readonly now: Date;
  }): Promise<CheckInCommitResult>;
  listStudentHistory(studentUserId: string): Promise<StudentAttendanceHistoryRecord[]>;
  listStudentOpenSessions(input: {
    readonly studentUserId: string;
    readonly now: Date;
  }): Promise<StudentOpenAttendanceSessionRecord[]>;
}

/**
 * Fingerprint of the verification-relevant venue state. Used to detect a
 * boundary change between evaluation and commit.
 */
export function venueSnapshotSignature(venue: CheckInVenueSnapshot): string {
  return [
    venue.venueId,
    venue.venueStatus,
    venue.locationRequired,
    venue.latitude ?? '',
    venue.longitude ?? '',
    venue.radiusMeters ?? '',
  ].join(':');
}
