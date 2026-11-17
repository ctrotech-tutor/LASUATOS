import {
  ATTENDANCE_APPEAL_WINDOW_DAYS,
  ATTENDANCE_DISPUTE_WINDOW_DAYS,
  MAX_OPEN_ATTENDANCE_DISPUTES,
  type AttendanceDisputeKind,
  type AttendanceDisputeStatus,
  type AttendanceRecordStatus,
} from '@lasuatos/contracts';

const DAY_MS = 24 * 60 * 60_000;

/** The facts needed to decide whether a student may dispute one session. */
export interface DisputeFacts {
  readonly session: {
    readonly status: 'open' | 'closed';
    readonly startsAt: Date;
    readonly endsAt: Date;
    readonly closedAt: Date | null;
  };
  /** The student's enrollment row for the session's offering, if any. */
  readonly enrollment: {
    readonly status: 'active' | 'withdrawn' | 'completed';
    readonly enrolledAt: Date;
  } | null;
  /** The student's record for the session, if any. */
  readonly recordStatus: AttendanceRecordStatus | null;
  /** Statuses of the student's earlier disputes for this session. */
  readonly priorDisputeStatuses: readonly AttendanceDisputeStatus[];
  /** How many disputes the student has awaiting a decision across all courses. */
  readonly openDisputeCount: number;
}

export type DisputeEligibility =
  | { readonly kind: 'eligible'; readonly disputeKind: AttendanceDisputeKind; readonly deadline: Date }
  | { readonly kind: 'not_enrolled' }
  | { readonly kind: 'enrolled_after_session' }
  | { readonly kind: 'not_started' }
  | { readonly kind: 'still_open' }
  | { readonly kind: 'already_present' }
  | { readonly kind: 'window_closed' }
  | { readonly kind: 'already_open' }
  | { readonly kind: 'already_resolved' }
  | { readonly kind: 'too_many_open' };

/** When check-ins stopped: the earlier of the close time and the scheduled end. */
export function sessionEndedAt(session: DisputeFacts['session']): Date {
  return session.closedAt && session.closedAt < session.endsAt ? session.closedAt : session.endsAt;
}

export function disputeDeadline(session: DisputeFacts['session']): Date {
  return new Date(sessionEndedAt(session).getTime() + ATTENDANCE_DISPUTE_WINDOW_DAYS * DAY_MS);
}

/** True while students can still check in themselves. */
export function acceptsCheckIns(session: DisputeFacts['session'], now: Date): boolean {
  return session.status === 'open' && session.closedAt == null && session.endsAt > now && session.startsAt <= now;
}

/**
 * Decides whether a student may dispute a session. Order matters: each check
 * returns the most specific reason a student can act on.
 *
 * - Only an actively enrolled student who was enrolled when the session
 *   started can dispute it; earlier sessions never counted against them.
 * - A missing check-in can only be disputed after check-ins stop (until then
 *   the student should simply check in). A revoked check-in can be disputed
 *   straight away, because the student cannot re-check-in.
 * - Disputes close a fixed number of days after the session ended.
 * - One dispute may be open per session. An upheld or rejected dispute is
 *   final for that session; a withdrawn one may be resubmitted.
 */
export function evaluateDisputeEligibility(facts: DisputeFacts, now: Date): DisputeEligibility {
  if (!facts.enrollment || facts.enrollment.status !== 'active') return { kind: 'not_enrolled' };
  if (facts.enrollment.enrolledAt > facts.session.startsAt) return { kind: 'enrolled_after_session' };
  if (facts.session.startsAt > now) return { kind: 'not_started' };
  if (facts.recordStatus === 'present') return { kind: 'already_present' };
  const disputeKind: AttendanceDisputeKind = facts.recordStatus === 'revoked' ? 'revoked_check_in' : 'missing_check_in';
  if (disputeKind === 'missing_check_in' && acceptsCheckIns(facts.session, now)) return { kind: 'still_open' };
  const deadline = disputeDeadline(facts.session);
  if (now > deadline) return { kind: 'window_closed' };
  if (facts.priorDisputeStatuses.includes('open')) return { kind: 'already_open' };
  if (facts.priorDisputeStatuses.some((status) => status === 'upheld' || status === 'rejected')) {
    return { kind: 'already_resolved' };
  }
  if (facts.openDisputeCount >= MAX_OPEN_ATTENDANCE_DISPUTES) return { kind: 'too_many_open' };
  return { kind: 'eligible', disputeKind, deadline };
}

/** Earliest session end that can still be disputed at `now`. */
export function earliestDisputableEnd(now: Date): Date {
  return new Date(now.getTime() - ATTENDANCE_DISPUTE_WINDOW_DAYS * DAY_MS);
}

/** What decides whether a student may take a rejected dispute to the department. */
export interface AppealFacts {
  readonly disputeStatus: AttendanceDisputeStatus;
  /** When the lecturer decided. */
  readonly resolvedAt: Date | null;
  /** Any appeal at all, including a withdrawn one: there is one chance per dispute. */
  readonly hasAppeal: boolean;
  readonly enrollmentStatus: 'active' | 'withdrawn' | 'completed' | null;
  readonly recordStatus: AttendanceRecordStatus | null;
}

export type AppealEligibility =
  | { readonly kind: 'eligible'; readonly deadline: Date }
  | { readonly kind: 'not_rejected' }
  | { readonly kind: 'already_appealed' }
  | { readonly kind: 'already_present' }
  | { readonly kind: 'not_enrolled' }
  | { readonly kind: 'window_closed' };

export function appealDeadline(resolvedAt: Date): Date {
  return new Date(resolvedAt.getTime() + ATTENDANCE_APPEAL_WINDOW_DAYS * DAY_MS);
}

/**
 * Decides whether a student may appeal a dispute to the department.
 *
 * - Only a dispute the lecturer rejected can go higher: an open one is still with the lecturer,
 *   an upheld one already gave the student what they asked for, and a withdrawn one can simply
 *   be sent again.
 * - Once per dispute, withdrawn appeals included, so the department is not asked twice.
 * - Not when the student is already marked present (the lecturer changed their mind later).
 * - Only while actively enrolled: an upheld appeal records attendance, which needs an
 *   enrollment, exactly as an upheld dispute does.
 * - Within a few days of the rejection, while the class is still fresh in everyone's memory.
 */
export function evaluateAppealEligibility(facts: AppealFacts, now: Date): AppealEligibility {
  if (facts.disputeStatus !== 'rejected' || !facts.resolvedAt) return { kind: 'not_rejected' };
  if (facts.hasAppeal) return { kind: 'already_appealed' };
  if (facts.recordStatus === 'present') return { kind: 'already_present' };
  if (facts.enrollmentStatus !== 'active') return { kind: 'not_enrolled' };
  const deadline = appealDeadline(facts.resolvedAt);
  if (now > deadline) return { kind: 'window_closed' };
  return { kind: 'eligible', deadline };
}
