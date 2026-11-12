export type AttendanceRecordMethod = 'code' | 'qr_code' | 'manual';
export type AttendanceRecordStatus = 'present' | 'revoked';
export type AttendanceVenueOutcomeValue = 'within_boundary' | 'inconclusive';

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
  readonly qrOnly: boolean;
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
  readonly studentUserId: string;
  readonly displayName: string;
  readonly checkedInAt: Date;
  readonly method: AttendanceRecordMethod;
  readonly venueOutcome: AttendanceVenueOutcomeValue | null;
  readonly status: AttendanceRecordStatus;
  readonly revokedAt: Date | null;
  /** Another student's check-in in this session came from the same browser. */
  readonly sharedDevice: boolean;
  readonly studentNumber: string;
  readonly entryYear: number | null;
  readonly entryLevel: number | null;
  readonly programmeYears: number | null;
}

export interface LecturerAttendanceSessionDetailRecord {
  readonly session: AttendanceSessionRecord;
  readonly attendees: AttendanceAttendeeRecord[];
  /** First year of the institution's current academic session, for derived levels. */
  readonly sessionStartYear: number;
}

export interface StudentAttendanceHistoryRecord {
  readonly attendanceSessionId: string;
  readonly courseOfferingId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly sessionTitle: string;
  readonly venueName: string | null;
  readonly venueOutcome: 'within_boundary' | 'inconclusive' | null;
  readonly method: AttendanceRecordMethod;
  readonly status: AttendanceRecordStatus;
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
  readonly qrOnly: boolean;
  readonly endsAt: Date;
}

export interface CreateAttendanceSessionInput {
  readonly lecturerUserId: string;
  readonly courseOfferingId: string;
  readonly venueId: string | null;
  readonly qrSecret: string;
  readonly title: string;
  readonly codeHash: string;
  readonly qrOnly: boolean;
  readonly startsAt: Date;
  readonly endsAt: Date;
}

export type UpdateAttendanceSessionSettingsResult =
  | { readonly kind: 'updated'; readonly session: AttendanceSessionRecord }
  | { readonly kind: 'not_assigned' }
  | { readonly kind: 'session_closed' };

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
  /** Typed codes are refused; only the rotating QR challenge is accepted. */
  readonly qrOnly: boolean;
  readonly venue: CheckInVenueSnapshot | null;
  /** This student's existing check-in time, if any. */
  readonly existingCheckedInAt: Date | null;
  /** Status of the existing record; `revoked` blocks a fresh check-in. */
  readonly existingStatus: AttendanceRecordStatus | null;
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
  /** A lecturer revoked this student's record; check-in cannot restore it. */
  | { readonly kind: 'revoked' }
  /** The session switched to QR-only between preparation and commit. */
  | { readonly kind: 'qr_required' }
  /** The venue changed between evaluation and commit; the caller must retry. */
  | { readonly kind: 'venue_changed' };

export interface SessionQrMaterial {
  readonly sessionId: string;
  readonly qrSecret: string | null;
  readonly status: 'open' | 'closed';
  readonly endsAt: Date;
}

export interface OfferingReportSource {
  readonly offering: {
    readonly id: string;
    readonly courseCode: string;
    readonly courseTitle: string;
    readonly departmentName: string;
    readonly semesterLabel: string;
    /** Course-offering level label, e.g. "300". Optional for older fixtures. */
    readonly level?: string;
    /** First year of the offering's academic session; levels are derived as of then. */
    readonly sessionStartYear?: number;
  };
  /** Sessions that have started, oldest first. */
  readonly sessions: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly status: 'open' | 'closed';
    readonly venueName: string | null;
  }>;
  /** Every enrollment row for the offering, whatever its status. */
  readonly students: ReadonlyArray<{
    readonly studentUserId: string;
    readonly displayName: string;
    readonly studentNumber: string;
    readonly studentNumberVerified: boolean;
    readonly entryYear?: number | null;
    readonly entryLevel?: number | null;
    readonly programmeYears?: number | null;
    readonly enrollmentStatus: 'active' | 'withdrawn' | 'completed';
    readonly enrolledAt: Date;
  }>;
  readonly records: ReadonlyArray<{
    readonly attendanceSessionId: string;
    readonly studentUserId: string;
    readonly status: AttendanceRecordStatus;
    readonly method: AttendanceRecordMethod;
    readonly venueOutcome: AttendanceVenueOutcomeValue | null;
  }>;
  /** Student disputes for the offering awaiting a lecturer decision. */
  readonly openDisputes?: number;
}

export interface StudentSummarySource {
  readonly enrollments: ReadonlyArray<{
    readonly courseOfferingId: string;
    readonly courseCode: string;
    readonly courseTitle: string;
    readonly enrolledAt: Date;
  }>;
  /** Started sessions of the student's actively enrolled offerings. */
  readonly sessions: ReadonlyArray<{
    readonly id: string;
    readonly courseOfferingId: string;
    readonly startsAt: Date;
  }>;
  readonly records: ReadonlyArray<{
    readonly attendanceSessionId: string;
    readonly status: AttendanceRecordStatus;
  }>;
}

export interface CorrectedRecord {
  readonly studentUserId: string;
  readonly status: AttendanceRecordStatus;
  readonly method: AttendanceRecordMethod;
  readonly venueOutcome: AttendanceVenueOutcomeValue | null;
  readonly checkedInAt: Date;
  readonly revokedAt: Date | null;
}

export type ApplyCorrectionResult =
  | { readonly kind: 'applied' | 'unchanged'; readonly record: CorrectedRecord }
  | { readonly kind: 'not_assigned' }
  | { readonly kind: 'session_not_started' }
  | { readonly kind: 'not_enrolled' }
  | { readonly kind: 'no_record' };

export interface AttendanceCorrectionRecord {
  readonly id: string;
  readonly studentUserId: string;
  readonly studentName: string;
  readonly actorName: string;
  readonly action: 'mark_present' | 'revoke';
  readonly previousStatus: AttendanceRecordStatus | null;
  readonly resultingStatus: AttendanceRecordStatus;
  readonly reason: string;
  /** True when applied by upholding a student dispute. */
  readonly viaDispute: boolean;
  readonly createdAt: Date;
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
  /** Changes open-session settings (currently QR-only), guarded like rotation. */
  updateSessionSettings(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
    readonly qrOnly: boolean;
    readonly now: Date;
  }): Promise<UpdateAttendanceSessionSettingsResult>;
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
    /** Per-session device hash for the consistency signal; null when the browser sent none. */
    readonly deviceHash: string | null;
    readonly now: Date;
  }): Promise<CheckInCommitResult>;
  listStudentHistory(studentUserId: string): Promise<StudentAttendanceHistoryRecord[]>;
  /**
   * Raw material for an offering attendance report, guarded by the caller's
   * active lecturer assignment to the offering. Null when not assigned.
   */
  getOfferingReportSource(input: {
    readonly lecturerUserId: string;
    readonly courseOfferingId: string;
    readonly now: Date;
  }): Promise<OfferingReportSource | null>;
  getStudentSummarySource(input: {
    readonly studentUserId: string;
    readonly now: Date;
  }): Promise<StudentSummarySource>;
  /**
   * Applies a lecturer correction atomically: locks the session, changes the
   * record and appends the audit row in one transaction. Any lecturer
   * assigned to the session's offering may correct it.
   */
  applyCorrection(input: {
    readonly actorUserId: string;
    readonly attendanceSessionId: string;
    readonly studentUserId: string;
    readonly action: 'mark_present' | 'revoke';
    readonly reason: string;
    readonly now: Date;
  }): Promise<ApplyCorrectionResult>;
  /** Audit trail for one session; null when the caller is not assigned. */
  listCorrections(input: {
    readonly lecturerUserId: string;
    readonly attendanceSessionId: string;
  }): Promise<AttendanceCorrectionRecord[] | null>;
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
