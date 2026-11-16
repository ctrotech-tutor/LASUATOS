import type { AuditCategory, RetentionPolicy } from '@lasuatos/contracts';

/** Where an administrator's audit view reaches. */
export type AuditScope =
  | { readonly type: 'institution'; readonly institutionId: string }
  | { readonly type: 'faculty'; readonly institutionId: string; readonly facultyId: string; readonly actorUserId: string }
  | { readonly type: 'department'; readonly institutionId: string; readonly departmentId: string; readonly actorUserId: string };

export interface AuditRow {
  /** "<source>:<uuid>" */
  readonly id: string;
  readonly source: 'student' | 'staff' | 'structure' | 'venue';
  readonly action: string;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly subjectName: string | null;
  readonly matricNumber: string | null;
  readonly targetLabel: string | null;
  /** faculty, department, academic_session, building, venue, lecture or staff. */
  readonly targetType: string | null;
  /** The code of what was changed: a department, faculty, session, venue or course code. */
  readonly targetCode: string | null;
  /** The lecture an attendance change belongs to. */
  readonly sessionId: string | null;
  /** Where the student acted on sits on a class list, for a link to them. */
  readonly classDepartmentCode: string | null;
  readonly classEntryYear: number | null;
  /** Staff rows: the email, role and area of the person invited or changed. */
  readonly staffEmail: string | null;
  readonly staffRole: string | null;
  readonly staffArea: string | null;
  readonly details: string;
  readonly createdAt: Date;
}

export interface AuditFilter {
  readonly category?: AuditCategory | undefined;
  readonly query?: string | undefined;
  readonly actorId?: string | undefined;
  /** Only these actions. */
  readonly actions?: readonly string[] | undefined;
  /** Only AUDIT_NOTABLE_ACTIONS, and faculties or departments deactivated. */
  readonly notableOnly?: boolean | undefined;
  /** One entry by its id. */
  readonly id?: string | undefined;
  readonly from?: Date | undefined;
  /** Exclusive. */
  readonly to?: Date | undefined;
  readonly before?: { readonly at: Date; readonly id: string } | undefined;
  readonly limit: number;
}

export interface AuditCountRow {
  readonly source: AuditRow['source'];
  readonly action: string;
  readonly count: number;
  /** Of `count`, how many are at or after the split. */
  readonly recent: number;
}

export interface AuditCounts {
  readonly rows: readonly AuditCountRow[];
  /** Distinct people acting at or after the split. */
  readonly people: number;
}

/** Names for the ids stored inside audit details. */
export interface AuditReferences {
  readonly departments: ReadonlyMap<string, { readonly code: string; readonly name: string }>;
  readonly sessions: ReadonlyMap<string, { readonly courseCode: string; readonly startsAt: Date }>;
  readonly users: ReadonlyMap<string, { readonly name: string; readonly matricNumber: string | null }>;
}

export interface RetentionSetRow {
  readonly departmentName: string;
  readonly entryYear: number;
  readonly programmeYears: number;
  readonly students: number;
  readonly faces: number;
  readonly dueFaces: number;
  readonly keptActive: number;
}

export interface RetentionRunRecord {
  readonly at: Date;
  readonly actorName: string | null;
  readonly details: string;
}

export interface GovernanceRepository {
  listAudit(scope: AuditScope, filter: AuditFilter): Promise<AuditRow[]>;
  /** Entries per action under the filter (its limit and cursor are ignored), split at `split`. */
  countAudit(scope: AuditScope, filter: Omit<AuditFilter, 'limit' | 'before' | 'id'>, split: Date): Promise<AuditCounts>;
  resolveReferences(institutionId: string, ids: { readonly departments: readonly string[]; readonly sessions: readonly string[]; readonly users: readonly string[] }): Promise<AuditReferences>;
  /** Sets (department + entry year) whose final session has ended by `now`. */
  listFinishedSets(institutionId: string, policy: RetentionPolicy, now: Date): Promise<RetentionSetRow[]>;
  countDueCheckPhotos(institutionId: string, policy: RetentionPolicy, now: Date): Promise<number>;
  lastRetentionRun(institutionId: string): Promise<RetentionRunRecord | null>;
  /**
   * Deletes the face data that is due (registered faces of finished sets
   * past the grace period and not recently active; their check-in photos;
   * check-in photos older than the limit) in one transaction, and writes the
   * audit trail (one event per student plus a summary).
   */
  runRetention(input: {
    readonly institutionId: string;
    readonly policy: RetentionPolicy;
    readonly now: Date;
    readonly actorUserId: string | null;
  }): Promise<{ readonly facesDeleted: number; readonly checkPhotosDeleted: number }>;
  listInstitutionIds(): Promise<string[]>;
}

/** Student audit actions that are about registered faces and the face check. */
export const FACE_ACTIONS = [
  'face_registered',
  'face_reset',
  'face_check_failed',
  'face_duplicate_refused',
  'face_replace_confirmed',
  'face_replaced',
  'face_replace_refused',
  'face_review_approved',
  'face_review_rejected',
] as const;
/** Student audit actions that are about attendance. */
export const ATTENDANCE_ACTIONS = ['help_request_created', 'help_request_added', 'help_request_declined'] as const;
