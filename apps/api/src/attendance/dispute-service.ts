import {
  ATTENDANCE_DISPUTE_WINDOW_DAYS,
  MAX_OPEN_ATTENDANCE_DISPUTES,
} from '@lasuatos/contracts';
import type {
  AttendanceDisputeRepository,
  DisputeListStatus,
  StudentDisputeCandidate,
} from './dispute-repository.js';
import { disputeDeadline, evaluateDisputeEligibility, type DisputeEligibility } from './dispute-policy.js';

/**
 * Base class for dispute errors whose messages are server-authored,
 * request-independent and safe to show to the user as the problem detail.
 */
abstract class DisputeError extends Error {
  abstract readonly statusCode: number;
  readonly exposeDetail = true;
}

function disputeError(name: string, statusCode: number, message: string) {
  return class extends DisputeError {
    readonly statusCode = statusCode;
    constructor() {
      super(message);
      this.name = name;
    }
  };
}

export const DisputeSessionUnavailableError = disputeError(
  'DisputeSessionUnavailableError',
  404,
  'This session is not available for a dispute.',
);
export const DisputeNotEnrolledError = disputeError(
  'DisputeNotEnrolledError',
  409,
  'Only students actively enrolled in the course can dispute its sessions.',
);
export const DisputeEnrolledAfterSessionError = disputeError(
  'DisputeEnrolledAfterSessionError',
  409,
  'You enrolled after this session started, so it does not count against your attendance.',
);
export const DisputeSessionNotStartedError = disputeError(
  'DisputeSessionNotStartedError',
  409,
  'This session has not started yet.',
);
export const DisputeSessionStillOpenError = disputeError(
  'DisputeSessionStillOpenError',
  409,
  'This session is still accepting check-ins. Check in with the code or QR shown in class instead.',
);
export const DisputeAlreadyPresentError = disputeError(
  'DisputeAlreadyPresentError',
  409,
  'You are already recorded present for this session.',
);
export const DisputeWindowClosedError = disputeError(
  'DisputeWindowClosedError',
  409,
  `Disputes close ${ATTENDANCE_DISPUTE_WINDOW_DAYS} days after a session ends. Speak to your lecturer or department directly.`,
);
export const DisputeAlreadyOpenError = disputeError(
  'DisputeAlreadyOpenError',
  409,
  'You already have a dispute awaiting a decision for this session.',
);
export const DisputeAlreadyResolvedError = disputeError(
  'DisputeAlreadyResolvedError',
  409,
  'A dispute for this session has already been decided. Speak to your lecturer or department if you need to take it further.',
);
export const DisputeTooManyOpenError = disputeError(
  'DisputeTooManyOpenError',
  409,
  `You have ${MAX_OPEN_ATTENDANCE_DISPUTES} disputes awaiting a decision. Wait for some to be decided before submitting more.`,
);
export const DisputeNotFoundError = disputeError(
  'DisputeNotFoundError',
  404,
  'This dispute was not found.',
);
export const DisputeNotOpenError = disputeError(
  'DisputeNotOpenError',
  409,
  'This dispute has already been decided or withdrawn.',
);
export const DisputeUpholdNotEnrolledError = disputeError(
  'DisputeUpholdNotEnrolledError',
  409,
  'This student no longer has an active enrollment, so they cannot be recorded present. Reject the dispute with an explanation instead.',
);
export const DisputeStatementLengthError = disputeError(
  'DisputeStatementLengthError',
  400,
  'Describe what happened in 20 to 1000 characters.',
);
export const DisputeNoteLengthError = disputeError(
  'DisputeNoteLengthError',
  400,
  'Give a decision note of 10 to 500 characters. The student will see it.',
);

function errorForIneligible(result: Exclude<DisputeEligibility, { kind: 'eligible' }>): Error {
  switch (result.kind) {
    case 'not_enrolled':
      return new DisputeNotEnrolledError();
    case 'enrolled_after_session':
      return new DisputeEnrolledAfterSessionError();
    case 'not_started':
      return new DisputeSessionNotStartedError();
    case 'still_open':
      return new DisputeSessionStillOpenError();
    case 'already_present':
      return new DisputeAlreadyPresentError();
    case 'window_closed':
      return new DisputeWindowClosedError();
    case 'already_open':
      return new DisputeAlreadyOpenError();
    case 'already_resolved':
      return new DisputeAlreadyResolvedError();
    case 'too_many_open':
      return new DisputeTooManyOpenError();
  }
}

export interface AttendanceDisputeServiceOptions {
  readonly repository: AttendanceDisputeRepository;
  readonly now?: () => Date;
}

export class AttendanceDisputeService {
  readonly #repository: AttendanceDisputeRepository;
  readonly #now: () => Date;

  constructor(options: AttendanceDisputeServiceOptions) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * The student's own disputes plus the sessions they could dispute now.
   * Disputable sessions ignore the open-dispute cap so the student still sees
   * them; submission enforces it.
   */
  async getStudentDisputes(studentUserId: string) {
    const now = this.#now();
    const [disputes, { candidates }] = await Promise.all([
      this.#repository.listStudentDisputes({ studentUserId }),
      this.#repository.listStudentDisputeCandidates({ studentUserId, now }),
    ]);
    const disputableSessions = candidates.flatMap((candidate: StudentDisputeCandidate) => {
      const eligibility = evaluateDisputeEligibility({ ...candidate.facts, openDisputeCount: 0 }, now);
      if (eligibility.kind !== 'eligible') return [];
      return [{
        attendanceSessionId: candidate.attendanceSessionId,
        courseOfferingId: candidate.courseOfferingId,
        courseCode: candidate.courseCode,
        courseTitle: candidate.courseTitle,
        sessionTitle: candidate.sessionTitle,
        startsAt: candidate.facts.session.startsAt,
        kind: eligibility.disputeKind,
        revocation: candidate.revocation,
        disputeDeadline: disputeDeadline(candidate.facts.session),
      }];
    });
    return {
      disputes,
      disputableSessions,
      windowDays: ATTENDANCE_DISPUTE_WINDOW_DAYS,
      openLimit: MAX_OPEN_ATTENDANCE_DISPUTES,
    };
  }

  async submitDispute(studentUserId: string, input: {
    readonly attendanceSessionId: string;
    readonly statement: string;
  }) {
    const statement = input.statement.trim();
    if (statement.length < 20 || statement.length > 1000) throw new DisputeStatementLengthError();
    const now = this.#now();
    const context = await this.#repository.getDisputeFacts({
      studentUserId,
      attendanceSessionId: input.attendanceSessionId,
    });
    if (!context) throw new DisputeSessionUnavailableError();
    const eligibility = evaluateDisputeEligibility(context.facts, now);
    if (eligibility.kind !== 'eligible') throw errorForIneligible(eligibility);
    const result = await this.#repository.insertDispute({
      institutionId: context.institutionId,
      courseOfferingId: context.courseOfferingId,
      attendanceSessionId: input.attendanceSessionId,
      studentUserId,
      kind: eligibility.disputeKind,
      statement,
      now,
    });
    if (result.kind === 'already_open') throw new DisputeAlreadyOpenError();
    return result.dispute;
  }

  async withdrawDispute(studentUserId: string, disputeId: string) {
    const result = await this.#repository.withdrawDispute({ studentUserId, disputeId, now: this.#now() });
    if (result.kind === 'not_found') throw new DisputeNotFoundError();
    if (result.kind === 'not_open') throw new DisputeNotOpenError();
    return result.dispute;
  }

  async listLecturerDisputes(lecturerUserId: string, query: {
    readonly status?: DisputeListStatus;
    readonly courseOfferingId?: string;
  } = {}) {
    return this.#repository.listLecturerDisputes({
      lecturerUserId,
      status: query.status ?? 'open',
      ...(query.courseOfferingId ? { courseOfferingId: query.courseOfferingId } : {}),
    });
  }

  async countOpenLecturerDisputes(lecturerUserId: string): Promise<number> {
    return this.#repository.countOpenLecturerDisputes(lecturerUserId);
  }

  async resolveDispute(lecturerUserId: string, disputeId: string, input: {
    readonly decision: 'uphold' | 'reject';
    readonly note: string;
  }) {
    const note = input.note.trim();
    if (note.length < 10 || note.length > 500) throw new DisputeNoteLengthError();
    const result = await this.#repository.resolveDispute({
      lecturerUserId,
      disputeId,
      decision: input.decision,
      note,
      now: this.#now(),
    });
    switch (result.kind) {
      case 'not_found':
        throw new DisputeNotFoundError();
      case 'not_open':
        throw new DisputeNotOpenError();
      case 'not_enrolled':
        throw new DisputeUpholdNotEnrolledError();
      default:
        return { dispute: result.dispute, correction: result.correction };
    }
  }
}
