import type {
  AttendanceAppealStatus,
  AttendanceDisputeKind,
  AttendanceDisputeStatus,
} from '@lasuatos/contracts';
import type { AppealFacts, DisputeFacts } from './dispute-policy.js';
import type {
  AttendanceRecordMethod,
  AttendanceRecordStatus,
  AttendanceVenueOutcomeValue,
} from './repository.js';

/** A student's appeal to the department against a rejected dispute. */
export interface AppealSummaryRecord {
  readonly id: string;
  readonly status: AttendanceAppealStatus;
  readonly statement: string;
  readonly departmentName: string;
  readonly decisionNote: string | null;
  readonly decidedByName: string | null;
  readonly decidedAt: Date | null;
  readonly createdAt: Date;
}

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
  readonly appeal: AppealSummaryRecord | null;
  /** What decides whether the student may still take it to the department. */
  readonly appealFacts: AppealFacts;
}

/** A dispute as the student sees it: with the last moment they may appeal, if they still can. */
export interface StudentDisputeView extends StudentDisputeRecord {
  readonly appealDeadline: Date | null;
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
  /**
   * The student's attendance in the course so far, by the report's rule: classes since they
   * joined (or with a record), not counting a class still taking attendance that they have not
   * checked in to. `countsThisClass` says whether the disputed class is among them (it is not
   * when it was before they joined and they have no record). Null without an enrollment row.
   */
  readonly standing: { readonly attended: number; readonly eligible: number; readonly countsThisClass: boolean } | null;
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
  readonly appeal: AppealSummaryRecord | null;
}

/** An appeal in a department's queue, with the dispute it is about. */
export interface AdministratorAppealRecord extends AppealSummaryRecord {
  /** The administrator deciding is the person who decided the original dispute. */
  readonly conflict: boolean;
  readonly dispute: LecturerDisputeRecord;
}

/** The administrator's area: whose appeals they see and decide. */
export interface AppealScope {
  readonly institutionId: string;
  readonly type: 'institution' | 'faculty' | 'department';
  readonly id: string;
  readonly administratorUserId: string;
}

export type AppealListStatus = 'open' | 'decided' | 'all';

export type InsertAppealResult =
  | { readonly kind: 'inserted'; readonly dispute: StudentDisputeRecord }
  | { readonly kind: 'already_appealed' };

export type WithdrawAppealResult =
  | { readonly kind: 'withdrawn'; readonly dispute: StudentDisputeRecord }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_open' };

export type DecideAppealResult =
  | {
      readonly kind: 'decided';
      readonly appeal: AdministratorAppealRecord;
      readonly correction: 'applied' | 'unchanged' | null;
    }
  | { readonly kind: 'not_found' }
  | { readonly kind: 'not_open' }
  | { readonly kind: 'conflict' }
  | { readonly kind: 'not_enrolled' };

/** Who to email about an appeal, and what the message needs. */
export interface AppealNoticeContext {
  readonly courseCode: string;
  readonly sessionTitle: string;
  readonly sessionStartsAt: Date;
  readonly departmentName: string;
  readonly student: DisputeNoticeContact;
  /** The lecturer who rejected the dispute, while their account is active. */
  readonly lecturer: DisputeNoticeContact | null;
  /**
   * Active administrators to tell about a new appeal: the department's own, or the faculty's
   * when the department has none, or the institution's when neither does.
   */
  readonly administrators: readonly DisputeNoticeContact[];
  /** Open appeals in the department, including this one. */
  readonly openForDepartment: number;
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
    /** Decides which classes are still taking attendance, for each student's standing. */
    readonly now: Date;
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

  /** Facts for appealing one of the student's own disputes; null when it is not theirs. */
  getAppealFacts(input: { readonly studentUserId: string; readonly disputeId: string }): Promise<{
    readonly institutionId: string;
    readonly courseOfferingId: string;
    readonly attendanceSessionId: string;
    readonly departmentId: string;
    readonly facts: AppealFacts;
  } | null>;
  /** Inserts an open appeal; the one-per-dispute index decides `already_appealed` races. */
  insertAppeal(input: {
    readonly institutionId: string;
    readonly disputeId: string;
    readonly courseOfferingId: string;
    readonly attendanceSessionId: string;
    readonly studentUserId: string;
    readonly departmentId: string;
    readonly statement: string;
    readonly now: Date;
  }): Promise<InsertAppealResult>;
  withdrawAppeal(input: {
    readonly studentUserId: string;
    readonly disputeId: string;
    readonly now: Date;
  }): Promise<WithdrawAppealResult>;
  /** Appeals in the administrator's area: open ones oldest first, decided ones newest first. */
  listAdministratorAppeals(input: {
    readonly scope: AppealScope;
    readonly status: AppealListStatus;
    readonly now: Date;
  }): Promise<{ readonly appeals: AdministratorAppealRecord[]; readonly openCount: number }>;
  countOpenAdministratorAppeals(scope: AppealScope): Promise<number>;
  /**
   * Decides an open appeal atomically. Upholding applies an audited `mark_present` correction
   * linked to the appeal and its dispute in the same transaction.
   */
  decideAppeal(input: {
    readonly scope: AppealScope;
    readonly appealId: string;
    readonly decision: 'uphold' | 'reject';
    readonly note: string;
    readonly now: Date;
  }): Promise<DecideAppealResult>;
  getAppealNoticeContext(appealId: string): Promise<AppealNoticeContext | null>;
}
