import type {
  AttendanceDisputeKind,
  AttendanceDisputeStatus,
} from '@lasuatos/contracts';
import type { DisputeFacts } from './dispute-policy.js';
import type {
  AttendanceRecordMethod,
  AttendanceRecordStatus,
  AttendanceVenueOutcomeValue,
} from './repository.js';

export interface StudentDisputeRecord {
  readonly id: string;
  readonly attendanceSessionId: string;
  readonly courseOfferingId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly sessionTitle: string;
  readonly sessionStartsAt: Date;
  readonly kind: AttendanceDisputeKind;
  readonly status: AttendanceDisputeStatus;
  readonly statement: string;
  readonly resolutionNote: string | null;
  readonly resolvedByName: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
}

export interface RevocationNotice {
  readonly reason: string;
  readonly revokedAt: Date;
}

/** A started session in one of the student's courses that may be disputable. */
export interface StudentDisputeCandidate {
  readonly attendanceSessionId: string;
  readonly courseOfferingId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly sessionTitle: string;
  readonly facts: Omit<DisputeFacts, 'openDisputeCount'>;
  /** Present only when the student's record is currently revoked. */
  readonly revocation: RevocationNotice | null;
}

export interface LecturerDisputeRecord {
  readonly id: string;
  readonly courseOfferingId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly attendanceSessionId: string;
  readonly sessionTitle: string;
  readonly sessionStartsAt: Date;
  readonly venueName: string | null;
  readonly student: {
    readonly id: string;
    readonly displayName: string;
    readonly studentNumber: string;
    readonly studentNumberVerified: boolean;
    readonly enrollmentStatus: 'active' | 'withdrawn' | 'completed' | null;
  };
  readonly kind: AttendanceDisputeKind;
  readonly status: AttendanceDisputeStatus;
  readonly statement: string;
  readonly record: {
    readonly status: AttendanceRecordStatus;
    readonly method: AttendanceRecordMethod;
    readonly venueOutcome: AttendanceVenueOutcomeValue | null;
    readonly checkedInAt: Date;
    readonly revokedAt: Date | null;
  } | null;
  readonly lastCorrection: {
    readonly action: 'mark_present' | 'revoke';
    readonly reason: string;
    readonly actorName: string;
    readonly createdAt: Date;
  } | null;
  readonly resolutionNote: string | null;
  readonly resolvedByName: string | null;
  readonly resolvedAt: Date | null;
  readonly createdAt: Date;
}

export type DisputeListStatus = 'open' | 'resolved' | 'all';

export type InsertDisputeResult =
  | { readonly kind: 'inserted'; readonly dispute: StudentDisputeRecord }
  | { readonly kind: 'already_open' };

export type WithdrawDisputeResult =
  | { readonly kind: 'withdrawn'; readonly dispute: StudentDisputeRecord }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_open' };

export type ResolveDisputeResult =
  | {
      readonly kind: 'resolved';
      readonly dispute: LecturerDisputeRecord;
      /** Outcome of the `mark_present` correction when upheld; null when rejected. */
      readonly correction: 'applied' | 'unchanged' | null;
    }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_open' }
  | { readonly kind: 'not_enrolled' };

export interface DisputeNoticeContact {
  readonly email: string;
  readonly displayName: string;
}

/** Who to email about a dispute, and the context the message needs. */
export interface DisputeNoticeContext {
  readonly courseCode: string;
  readonly sessionTitle: string;
  readonly sessionStartsAt: Date;
  readonly student: DisputeNoticeContact;
  /** Active, email-verified lecturers assigned to the offering. */
  readonly lecturers: readonly (DisputeNoticeContact & { readonly userId: string; readonly openDisputeCount: number })[];
  /** Open disputes on this session (including the one just submitted). */
  readonly openForSession: number;
}

export interface AttendanceDisputeRepository {
  /**
   * Facts for one student and session. Null when the session does not exist
   * or the student has never been enrolled in its offering, so the response
   * cannot reveal sessions in other courses.
   */
  getDisputeFacts(input: {
    readonly studentUserId: string;
    readonly attendanceSessionId: string;
  }): Promise<{
    readonly institutionId: string;
    readonly courseOfferingId: string;
    readonly facts: DisputeFacts;
  } | null>;
  /** Inserts an open dispute; the partial unique index decides `already_open` races. */
  insertDispute(input: {
    readonly institutionId: string;
    readonly courseOfferingId: string;
    readonly attendanceSessionId: string;
    readonly studentUserId: string;
    readonly kind: AttendanceDisputeKind;
    readonly statement: string;
    readonly now: Date;
  }): Promise<InsertDisputeResult>;
  listStudentDisputes(input: { readonly studentUserId: string }): Promise<StudentDisputeRecord[]>;
  /** Started sessions in actively enrolled courses that ended within the dispute window (or are still running). */
  listStudentDisputeCandidates(input: {
    readonly studentUserId: string;
    readonly now: Date;
  }): Promise<{ readonly candidates: StudentDisputeCandidate[]; readonly openDisputeCount: number }>;
  withdrawDispute(input: {
    readonly studentUserId: string;
    readonly disputeId: string;
    readonly now: Date;
  }): Promise<WithdrawDisputeResult>;
  /** Disputes for offerings the lecturer is assigned to, open ones oldest first. */
  listLecturerDisputes(input: {
    readonly lecturerUserId: string;
    readonly status: DisputeListStatus;
    readonly courseOfferingId?: string;
  }): Promise<{ readonly disputes: LecturerDisputeRecord[]; readonly openCount: number }>;
  /** Count of open disputes across the lecturer's assigned offerings (navigation badge). */
  countOpenLecturerDisputes(lecturerUserId: string): Promise<number>;
  /**
   * Resolves an open dispute atomically. Upholding applies an audited
   * `mark_present` correction linked to the dispute in the same transaction.
   */
  resolveDispute(input: {
    readonly lecturerUserId: string;
    readonly disputeId: string;
    readonly decision: 'uphold' | 'reject';
    readonly note: string;
    readonly now: Date;
  }): Promise<ResolveDisputeResult>;
  /** Recipients and context for dispute emails; null when the dispute does not exist. */
  getDisputeNoticeContext(disputeId: string): Promise<DisputeNoticeContext | null>;
}
