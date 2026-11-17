import {
  ATTENDANCE_APPEAL_WINDOW_DAYS,
  ATTENDANCE_DISPUTE_WINDOW_DAYS,
  MAX_OPEN_ATTENDANCE_DISPUTES,
} from '@lasuatos/contracts';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import type {
  AppealListStatus,
  AppealScope,
  AttendanceDisputeRepository,
  DisputeListStatus,
  StudentDisputeCandidate,
  StudentDisputeRecord,
  StudentDisputeView,
} from './dispute-repository.js';
import {
  disputeDeadline,
  evaluateAppealEligibility,
  evaluateDisputeEligibility,
  type AppealEligibility,
  type DisputeEligibility,
} from './dispute-policy.js';
import type { DisputeNotifier } from '../email/transport.js';

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
  'A dispute for this session has already been decided. If your lecturer turned it down, open it to take it to your department.',
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
export const AppealStatementLengthError = disputeError(
  'AppealStatementLengthError',
  400,
  'Explain why the decision should change in 20 to 1000 characters.',
);
export const DisputeNoteLengthError = disputeError(
  'DisputeNoteLengthError',
  400,
  'Give a decision note of 10 to 500 characters. The student will see it.',
);

export const AppealNotRejectedError = disputeError(
  'AppealNotRejectedError',
  409,
  'Only a dispute your lecturer turned down can be taken to the department.',
);
export const AppealAlreadySentError = disputeError(
  'AppealAlreadySentError',
  409,
  'This dispute has already been taken to the department. Each dispute can go up once.',
);
export const AppealAlreadyPresentError = disputeError(
  'AppealAlreadyPresentError',
  409,
  'You are already recorded present for this class, so there is nothing to appeal.',
);
export const AppealNotEnrolledError = disputeError(
  'AppealNotEnrolledError',
  409,
  'Only students still taking the course can take a dispute to the department.',
);
export const AppealWindowClosedError = disputeError(
  'AppealWindowClosedError',
  409,
  `A dispute can be taken to the department within ${ATTENDANCE_APPEAL_WINDOW_DAYS} days of the lecturer’s decision. Speak to your department directly.`,
);
export const AppealNotFoundError = disputeError(
  'AppealNotFoundError',
  404,
  'This appeal was not found.',
);
export const AppealNotOpenError = disputeError(
  'AppealNotOpenError',
  409,
  'This appeal has already been decided or withdrawn.',
);
export const AppealConflictError = disputeError(
  'AppealConflictError',
  409,
  'You turned down the original dispute, so another administrator for this department must decide the appeal.',
);
export const AppealUpholdNotEnrolledError = disputeError(
  'AppealUpholdNotEnrolledError',
  409,
  'This student is no longer actively enrolled, so they cannot be recorded present. Turn the appeal down with an explanation instead.',
);

function errorForIneligibleAppeal(result: Exclude<AppealEligibility, { kind: 'eligible' }>): Error {
  switch (result.kind) {
    case 'not_rejected':
      return new AppealNotRejectedError();
    case 'already_appealed':
      return new AppealAlreadySentError();
    case 'already_present':
      return new AppealAlreadyPresentError();
    case 'not_enrolled':
      return new AppealNotEnrolledError();
    case 'window_closed':
      return new AppealWindowClosedError();
  }
}

/** The administrator's area, as the appeal queries need it. */
export function appealScopeFor(account: AdministratorSessionAccount): AppealScope {
  return {
    institutionId: account.institutionId,
    type: account.scope.type,
    id: account.scope.id,
    administratorUserId: account.id,
  };
}

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
  /** Sends dispute emails when configured; failures are logged and never block the action. */
  readonly notifier?: DisputeNotifier;
  readonly logger?: { warn(details: Record<string, unknown>, message: string): void };
}

export class AttendanceDisputeService {
  readonly #repository: AttendanceDisputeRepository;
  readonly #now: () => Date;
  readonly #notifier: DisputeNotifier | undefined;
  readonly #logger: AttendanceDisputeServiceOptions['logger'];

  constructor(options: AttendanceDisputeServiceOptions) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
    this.#notifier = options.notifier;
    this.#logger = options.logger;
  }

  /**
   * Emails assigned lecturers when the first open dispute for a session
   * arrives — later disputes for the same session ride on that email, so a
   * class disputing together sends one message, not hundreds (free email
   * plans allow a few hundred a day).
   */
  async #notifyLecturers(disputeId: string): Promise<void> {
    const notifier = this.#notifier;
    if (!notifier) return;
    try {
      const context = await this.#repository.getDisputeNoticeContext(disputeId);
      if (!context || context.openForSession !== 1) return;
      const results = await Promise.allSettled(context.lecturers
        .filter((lecturer) => lecturer.openDisputeCount > 0)
        .map((lecturer) => notifier.sendDisputeSubmittedNotice({
          to: lecturer.email,
          displayName: lecturer.displayName,
          courseCode: context.courseCode,
          sessionTitle: context.sessionTitle,
          sessionStartsAt: context.sessionStartsAt,
          studentName: context.student.displayName,
          openDisputeCount: lecturer.openDisputeCount,
        })));
      const failed = results.filter((result) => result.status === 'rejected').length;
      if (failed) this.#logger?.warn({ failed, kind: 'dispute_submitted' }, 'Dispute notice email failed');
    } catch (error) {
      this.#logger?.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError', kind: 'dispute_submitted' },
        'Dispute notice email failed',
      );
    }
  }

  async #notifyStudent(disputeId: string, decision: 'upheld' | 'rejected', note: string, lecturerName: string): Promise<void> {
    const notifier = this.#notifier;
    if (!notifier) return;
    try {
      const context = await this.#repository.getDisputeNoticeContext(disputeId);
      if (!context) return;
      await notifier.sendDisputeResolvedNotice({
        to: context.student.email,
        displayName: context.student.displayName,
        courseCode: context.courseCode,
        sessionTitle: context.sessionTitle,
        sessionStartsAt: context.sessionStartsAt,
        decision,
        note,
        lecturerName,
      });
    } catch (error) {
      this.#logger?.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError', kind: 'dispute_resolved' },
        'Dispute notice email failed',
      );
    }
  }

  /** The dispute with the last moment the student may still appeal it, if they can. */
  #view(dispute: StudentDisputeRecord, now: Date): StudentDisputeView {
    const eligibility = evaluateAppealEligibility(dispute.appealFacts, now);
    return { ...dispute, appealDeadline: eligibility.kind === 'eligible' ? eligibility.deadline : null };
  }

  /**
   * Tells the department a dispute has come up to them. Like lecturer notices, only the first
   * appeal waiting in the department sends an email; later ones join the queue and the badge.
   */
  async #notifyAdministrators(appealId: string): Promise<void> {
    const notifier = this.#notifier;
    if (!notifier?.sendAppealSubmittedNotice) return;
    try {
      const context = await this.#repository.getAppealNoticeContext(appealId);
      if (!context || context.openForDepartment !== 1) return;
      const results = await Promise.allSettled(context.administrators.map((administrator) => notifier.sendAppealSubmittedNotice!({
        to: administrator.email,
        displayName: administrator.displayName,
        courseCode: context.courseCode,
        sessionTitle: context.sessionTitle,
        sessionStartsAt: context.sessionStartsAt,
        studentName: context.student.displayName,
        departmentName: context.departmentName,
      })));
      const failed = results.filter((result) => result.status === 'rejected').length;
      if (failed) this.#logger?.warn({ failed, kind: 'appeal_submitted' }, 'Appeal notice email failed');
    } catch (error) {
      this.#logger?.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError', kind: 'appeal_submitted' },
        'Appeal notice email failed',
      );
    }
  }

  /** Tells the student, and the lecturer who turned the dispute down, what the department decided. */
  async #notifyAppealDecided(appealId: string, decision: 'upheld' | 'rejected', note: string, deciderName: string): Promise<void> {
    const notifier = this.#notifier;
    if (!notifier?.sendAppealDecidedNotice) return;
    try {
      const context = await this.#repository.getAppealNoticeContext(appealId);
      if (!context) return;
      const common = {
        courseCode: context.courseCode,
        sessionTitle: context.sessionTitle,
        sessionStartsAt: context.sessionStartsAt,
        departmentName: context.departmentName,
        studentName: context.student.displayName,
        decision,
        note,
        deciderName,
      };
      const results = await Promise.allSettled([
        notifier.sendAppealDecidedNotice({ ...common, to: context.student.email, displayName: context.student.displayName, audience: 'student' }),
        ...(context.lecturer
          ? [notifier.sendAppealDecidedNotice({ ...common, to: context.lecturer.email, displayName: context.lecturer.displayName, audience: 'lecturer' })]
          : []),
      ]);
      const failed = results.filter((result) => result.status === 'rejected').length;
      if (failed) this.#logger?.warn({ failed, kind: 'appeal_decided' }, 'Appeal notice email failed');
    } catch (error) {
      this.#logger?.warn(
        { errorName: error instanceof Error ? error.name : 'UnknownError', kind: 'appeal_decided' },
        'Appeal notice email failed',
      );
    }
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
      disputes: disputes.map((dispute) => this.#view(dispute, now)),
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
    // Awaited so serverless hosts do not freeze the function before the email is handed off.
    await this.#notifyLecturers(result.dispute.id);
    return this.#view(result.dispute, now);
  }

  async withdrawDispute(studentUserId: string, disputeId: string) {
    const now = this.#now();
    const result = await this.#repository.withdrawDispute({ studentUserId, disputeId, now });
    if (result.kind === 'not_found') throw new DisputeNotFoundError();
    if (result.kind === 'not_open') throw new DisputeNotOpenError();
    return this.#view(result.dispute, now);
  }

  /** Takes a rejected dispute to the course's department ("appeal"). */
  async appealDispute(studentUserId: string, disputeId: string, input: { readonly statement: string }) {
    const statement = input.statement.trim();
    if (statement.length < 20 || statement.length > 1000) throw new AppealStatementLengthError();
    const now = this.#now();
    const context = await this.#repository.getAppealFacts({ studentUserId, disputeId });
    if (!context) throw new DisputeNotFoundError();
    const eligibility = evaluateAppealEligibility(context.facts, now);
    if (eligibility.kind !== 'eligible') throw errorForIneligibleAppeal(eligibility);
    const result = await this.#repository.insertAppeal({
      institutionId: context.institutionId,
      disputeId,
      courseOfferingId: context.courseOfferingId,
      attendanceSessionId: context.attendanceSessionId,
      studentUserId,
      departmentId: context.departmentId,
      statement,
      now,
    });
    if (result.kind === 'already_appealed') throw new AppealAlreadySentError();
    if (result.dispute.appeal) await this.#notifyAdministrators(result.dispute.appeal.id);
    return this.#view(result.dispute, now);
  }

  async withdrawAppeal(studentUserId: string, disputeId: string) {
    const now = this.#now();
    const result = await this.#repository.withdrawAppeal({ studentUserId, disputeId, now });
    if (result.kind === 'not_found') throw new AppealNotFoundError();
    if (result.kind === 'not_open') throw new AppealNotOpenError();
    return this.#view(result.dispute, now);
  }

  async listAdministratorAppeals(account: AdministratorSessionAccount, query: { readonly status?: AppealListStatus } = {}) {
    return this.#repository.listAdministratorAppeals({
      scope: appealScopeFor(account),
      status: query.status ?? 'open',
      now: this.#now(),
    });
  }

  async countOpenAdministratorAppeals(account: AdministratorSessionAccount): Promise<number> {
    return this.#repository.countOpenAdministratorAppeals(appealScopeFor(account));
  }

  async decideAppeal(account: AdministratorSessionAccount, appealId: string, input: {
    readonly decision: 'uphold' | 'reject';
    readonly note: string;
  }) {
    const note = input.note.trim();
    if (note.length < 10 || note.length > 500) throw new DisputeNoteLengthError();
    const result = await this.#repository.decideAppeal({
      scope: appealScopeFor(account),
      appealId,
      decision: input.decision,
      note,
      now: this.#now(),
    });
    switch (result.kind) {
      case 'not_found':
        throw new AppealNotFoundError();
      case 'not_open':
        throw new AppealNotOpenError();
      case 'conflict':
        throw new AppealConflictError();
      case 'not_enrolled':
        throw new AppealUpholdNotEnrolledError();
      default:
        await this.#notifyAppealDecided(
          appealId,
          input.decision === 'uphold' ? 'upheld' : 'rejected',
          note,
          result.appeal.decidedByName ?? account.displayName,
        );
        return { appeal: result.appeal, correction: result.correction };
    }
  }

  async listLecturerDisputes(lecturerUserId: string, query: {
    readonly status?: DisputeListStatus;
    readonly courseOfferingId?: string;
  } = {}) {
    return this.#repository.listLecturerDisputes({
      lecturerUserId,
      now: this.#now(),
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
        await this.#notifyStudent(
          disputeId,
          input.decision === 'uphold' ? 'upheld' : 'rejected',
          note,
          result.dispute.resolvedByName ?? 'Your lecturer',
        );
        return { dispute: result.dispute, correction: result.correction };
    }
  }
}
