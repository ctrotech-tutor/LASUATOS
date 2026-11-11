import { randomBytes } from 'node:crypto';
import { hashOpaqueToken } from '@lasuatos/auth';
import type { CheckInLocationSample } from '@lasuatos/contracts';
import {
  createSessionQrChallenge,
  evaluateCircularGeofence,
  generateSessionSecret,
  parseSessionQrChallenge,
  verifySessionQrChallenge,
} from '@lasuatos/verification';
import type {
  AttendanceRepository,
  AttendanceSessionRecord,
  CheckInLocationEvidence,
  CheckInVenueSnapshot,
  StudentAttendanceHistoryRecord,
  StudentOpenAttendanceSessionRecord,
} from './repository.js';
import { venueSnapshotSignature } from './repository.js';
import {
  DEFAULT_ATTENDANCE_THRESHOLD,
  buildOfferingReport,
  buildStudentSummary,
  renderReportCsv,
  reportCsvFilename,
} from './report.js';

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
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('The course offering is not available to this lecturer.');
    this.name = 'AttendanceSessionUnavailableError';
  }
}

export class AttendanceSemesterUnavailableError extends Error {
  readonly statusCode = 409;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('Attendance sessions can only be opened during an active semester.');
    this.name = 'AttendanceSemesterUnavailableError';
  }
}

export class AttendanceVenueUnavailableError extends Error {
  readonly statusCode = 409;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('The selected venue is not active. Choose an active venue or none.');
    this.name = 'AttendanceVenueUnavailableError';
  }
}

export class AttendanceSessionDurationError extends Error {
  readonly statusCode = 400;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('Choose an attendance duration between 5 and 240 minutes.');
    this.name = 'AttendanceSessionDurationError';
  }
}

export class AttendanceSessionClosedError extends Error {
  readonly statusCode = 409;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('This attendance session is closed or has expired.');
    this.name = 'AttendanceSessionClosedError';
  }
}

export class InvalidAttendanceCodeError extends Error {
  readonly statusCode = 400;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('This attendance code is invalid or no longer active.');
    this.name = 'InvalidAttendanceCodeError';
  }
}

export class InvalidAttendanceChallengeError extends Error {
  readonly statusCode = 400;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('This QR code is expired or invalid. Scan the code currently shown by your lecturer.');
    this.name = 'InvalidAttendanceChallengeError';
  }
}

export class AttendanceNotEnrolledError extends Error {
  readonly statusCode = 403;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('Join this course before checking in to its attendance session.');
    this.name = 'AttendanceNotEnrolledError';
  }
}

export class AttendanceLocationRequiredError extends Error {
  readonly statusCode = 400;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor(venueName: string) {
    super(`This session takes place at ${venueName} and requires your device location to check in.`);
    this.name = 'AttendanceLocationRequiredError';
  }
}

export class AttendanceLocationInvalidError extends Error {
  readonly statusCode = 400;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('The location reading was malformed. Enable location services, then retry.');
    this.name = 'AttendanceLocationInvalidError';
  }
}

export class AttendanceLocationOutsideError extends Error {
  readonly statusCode = 422;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor(venueName: string) {
    super(`Your device location is clearly outside ${venueName}. Move to the venue and try again, or speak to your lecturer.`);
    this.name = 'AttendanceLocationOutsideError';
  }
}

export class AttendanceVenueChangedError extends Error {
  readonly statusCode = 409;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('The venue boundary changed during check-in. Retry the check-in.');
    this.name = 'AttendanceVenueChangedError';
  }
}

export class AttendanceSessionConflictError extends Error {
  readonly statusCode = 409;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('This attendance session has already been closed.');
    this.name = 'AttendanceSessionConflictError';
  }
}

export class AttendanceRecordRevokedError extends Error {
  readonly statusCode = 409;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('Your lecturer removed your check-in for this session. If you think this is wrong, you can dispute it from My attendance.');
    this.name = 'AttendanceRecordRevokedError';
  }
}

export class AttendanceCorrectionNotStartedError extends Error {
  readonly statusCode = 409;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('Attendance can only be corrected for a session that has started.');
    this.name = 'AttendanceCorrectionNotStartedError';
  }
}

export class AttendanceCorrectionNotEnrolledError extends Error {
  readonly statusCode = 409;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('This student does not have an active enrollment in the course.');
    this.name = 'AttendanceCorrectionNotEnrolledError';
  }
}

export class AttendanceCorrectionNoRecordError extends Error {
  readonly statusCode = 409;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('This student has no check-in to revoke for this session.');
    this.name = 'AttendanceCorrectionNoRecordError';
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
    readonly venueId?: string | null;
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
      venueId: input.venueId ?? null,
      qrSecret: generateSessionSecret(),
      title: input.title.trim(),
      codeHash: hashOpaqueToken(code),
      startsAt: now,
      endsAt: new Date(now.getTime() + input.durationMinutes * 60_000),
    });
    if (result.kind === 'not_assigned') throw new AttendanceSessionUnavailableError();
    if (result.kind === 'venue_unavailable') throw new AttendanceVenueUnavailableError();
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

  /**
   * Returns the current rotating QR challenge for an open session, so the
   * lecturer display can project it. Sessions pre-dating QR support have
   * their secret backfilled on first use.
   */
  async getSessionQrChallenge(lecturerUserId: string, attendanceSessionId: string) {
    const now = this.#now();
    const material = await this.#repository.getSessionQrMaterial({ lecturerUserId, attendanceSessionId });
    if (!material) throw new AttendanceSessionUnavailableError();
    if (material.status === 'closed' || material.endsAt <= now) throw new AttendanceSessionClosedError();

    let secret = material.qrSecret;
    if (!secret) {
      const generated = generateSessionSecret();
      const saved = await this.#repository.setSessionQrSecret({
        lecturerUserId,
        attendanceSessionId,
        qrSecret: generated,
      });
      if (!saved) throw new AttendanceSessionUnavailableError();
      secret = generated;
    }

    const challenge = createSessionQrChallenge({ secret, sessionId: material.sessionId, now });
    return { ...challenge, sessionEndsAt: material.endsAt };
  }

  async checkIn(studentUserId: string, input: {
    readonly code?: string;
    readonly challenge?: string;
    readonly location?: CheckInLocationSample;
  }) {
    const now = this.#now();

    // Step 1: resolve the presented credential to a session.
    let sessionId: string;
    let method: 'code' | 'qr_code';
    if (input.code != null) {
      const normalizedCode = input.code.replace(/[\s-]/g, '').toUpperCase();
      if (!ATTENDANCE_CODE_PATTERN.test(normalizedCode)) throw new InvalidAttendanceCodeError();
      method = 'code';
      const resolved = await this.#repository.resolveSessionIdByCodeHash(hashOpaqueToken(normalizedCode));
      if (!resolved) throw new InvalidAttendanceCodeError();
      sessionId = resolved;
    } else if (input.challenge != null) {
      method = 'qr_code';
      const parsed = parseSessionQrChallenge(input.challenge);
      if (!parsed) throw new InvalidAttendanceChallengeError();
      const material = await this.#repository.getSessionQrSecretForCheckIn(parsed.sessionId);
      if (!material?.qrSecret) throw new InvalidAttendanceChallengeError();
      const verified = verifySessionQrChallenge(input.challenge, { secret: material.qrSecret, now });
      if (!verified.valid) throw new InvalidAttendanceChallengeError();
      sessionId = verified.sessionId;
    } else {
      throw new InvalidAttendanceCodeError();
    }

    // Step 2: load the decision context, preserving the historical error
    // precedence (duplicate → session closed → enrollment).
    const prepared = await this.#repository.prepareCheckIn({ studentUserId, sessionId, now });
    if (prepared.kind === 'invalid_credential') throw new InvalidAttendanceCodeError();
    const { context } = prepared;

    if (context.existingStatus === 'revoked') throw new AttendanceRecordRevokedError();
    if (context.existingCheckedInAt) {
      return {
        kind: 'already_checked_in' as const,
        attendance: {
          attendanceSessionId: context.sessionId,
          courseCode: context.courseCode,
          courseTitle: context.courseTitle,
          sessionTitle: context.sessionTitle,
          venueName: context.venue?.venueName ?? null,
          venueOutcome: null,
          checkedInAt: context.existingCheckedInAt,
        },
      };
    }
    if (context.status !== 'open' || context.startsAt > now || context.endsAt <= now) {
      throw new AttendanceSessionClosedError();
    }
    if (!context.enrolled) throw new AttendanceNotEnrolledError();

    // Step 3: evaluate venue evidence when an active venue boundary applies.
    // A deactivated or boundary-less venue disables location verification for
    // existing sessions deliberately (incident response) and is recorded with
    // venue_outcome NULL, distinct from evaluated outcomes.
    const venue = context.venue;
    let evidence: CheckInLocationEvidence | null = null;
    let venueSignature: string | null = null;
    if (
      venue && venue.venueStatus === 'active' &&
      venue.latitude != null && venue.longitude != null && venue.radiusMeters != null
    ) {
      venueSignature = venueSnapshotSignature(venue);
      if (input.location) {
        evidence = this.#evaluateVenueLocation(venue, input.location, now);
      } else if (venue.locationRequired) {
        throw new AttendanceLocationRequiredError(venue.venueName);
      }
    }

    // Step 4: commit atomically, retrying once if the venue drifted between
    // the evaluation snapshot and the commit.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.#repository.commitCheckIn({
        studentUserId,
        sessionId,
        method,
        venueSignature,
        evidence,
        venueOutcome: evidence?.outcome ?? null,
        now,
      });
      if (result.kind === 'session_closed') throw new AttendanceSessionClosedError();
      if (result.kind === 'revoked') throw new AttendanceRecordRevokedError();
      if (result.kind === 'venue_changed') {
        if (attempt === 0) {
          const retryPrepared = await this.#repository.prepareCheckIn({ studentUserId, sessionId, now });
          if (retryPrepared.kind !== 'prepared') throw new InvalidAttendanceCodeError();
          if (retryPrepared.context.existingStatus === 'revoked') throw new AttendanceRecordRevokedError();
          if (retryPrepared.context.existingCheckedInAt) {
            return {
              kind: 'already_checked_in' as const,
              attendance: {
                attendanceSessionId: context.sessionId,
                courseCode: context.courseCode,
                courseTitle: context.courseTitle,
                sessionTitle: context.sessionTitle,
                venueName: context.venue?.venueName ?? null,
                venueOutcome: null,
                checkedInAt: retryPrepared.context.existingCheckedInAt,
              },
            };
          }
          const retryVenue = retryPrepared.context.venue;
          if (
            retryVenue && retryVenue.venueStatus === 'active' &&
            retryVenue.latitude != null && retryVenue.longitude != null && retryVenue.radiusMeters != null &&
            input.location
          ) {
            venueSignature = venueSnapshotSignature(retryVenue);
            evidence = this.#evaluateVenueLocation(retryVenue, input.location, now);
          } else if (retryVenue && retryVenue.venueStatus === 'active' && retryVenue.locationRequired) {
            throw new AttendanceLocationRequiredError(retryVenue.venueName);
          } else {
            venueSignature = null;
            evidence = null;
          }
          continue;
        }
        throw new AttendanceVenueChangedError();
      }
      return result;
    }
    throw new AttendanceVenueChangedError();
  }

  #evaluateVenueLocation(
    venue: CheckInVenueSnapshot,
    location: CheckInLocationSample,
    now: Date,
  ): CheckInLocationEvidence {
    const capturedAt = new Date(location.capturedAt);
    if (Number.isNaN(capturedAt.getTime())) throw new AttendanceLocationInvalidError();
    if (
      !Number.isFinite(location.latitude) || Math.abs(location.latitude) > 90 ||
      !Number.isFinite(location.longitude) || Math.abs(location.longitude) > 180
    ) {
      throw new AttendanceLocationInvalidError();
    }
    const accuracy = location.accuracyMeters ?? null;
    if (accuracy != null && (!Number.isFinite(accuracy) || accuracy < 0 || accuracy > 2000)) {
      throw new AttendanceLocationInvalidError();
    }

    const evaluation = evaluateCircularGeofence(
      {
        kind: 'circle',
        center: { latitude: venue.latitude as number, longitude: venue.longitude as number },
        radiusMeters: venue.radiusMeters as number,
      },
      {
        latitude: location.latitude,
        longitude: location.longitude,
        accuracyMeters: accuracy ?? Number.MAX_SAFE_INTEGER,
        capturedAt,
      },
      now,
    );

    if (evaluation.outcome === 'outside') {
      throw new AttendanceLocationOutsideError(venue.venueName);
    }
    const outcome = evaluation.outcome === 'within' ? 'within_boundary' : 'inconclusive';
    return {
      latitude: location.latitude,
      longitude: location.longitude,
      accuracyMeters: accuracy,
      capturedAt,
      distanceMeters: Math.round(evaluation.distanceMeters * 100) / 100,
      radiusMeters: venue.radiusMeters as number,
      outcome,
    };
  }

  async listStudentHistory(studentUserId: string): Promise<StudentAttendanceHistoryRecord[]> {
    return this.#repository.listStudentHistory(studentUserId);
  }

  async listStudentOpenSessions(studentUserId: string): Promise<StudentOpenAttendanceSessionRecord[]> {
    return this.#repository.listStudentOpenSessions({ studentUserId, now: this.#now() });
  }

  async getStudentSummary(studentUserId: string) {
    const source = await this.#repository.getStudentSummarySource({ studentUserId, now: this.#now() });
    return buildStudentSummary(source);
  }

  /**
   * Builds the offering attendance report for an assigned lecturer. The
   * threshold only flags students for follow-up; it is a configurable
   * planning aid, not an institutional eligibility rule.
   */
  async getOfferingReport(lecturerUserId: string, courseOfferingId: string, threshold?: number) {
    const now = this.#now();
    const source = await this.#repository.getOfferingReportSource({ lecturerUserId, courseOfferingId, now });
    if (!source) throw new AttendanceSessionUnavailableError();
    const effectiveThreshold = threshold != null && Number.isInteger(threshold) && threshold >= 1 && threshold <= 100
      ? threshold
      : DEFAULT_ATTENDANCE_THRESHOLD;
    return buildOfferingReport(source, { now, threshold: effectiveThreshold });
  }

  async exportOfferingReportCsv(lecturerUserId: string, courseOfferingId: string, threshold?: number) {
    const report = await this.getOfferingReport(lecturerUserId, courseOfferingId, threshold);
    return {
      filename: reportCsvFilename(report.offering.courseCode, report.generatedAt),
      csv: renderReportCsv(report),
    };
  }

  async applyCorrection(lecturerUserId: string, attendanceSessionId: string, input: {
    readonly studentId: string;
    readonly action: 'mark_present' | 'revoke';
    readonly reason: string;
  }) {
    const reason = input.reason.trim();
    if (reason.length < 10 || reason.length > 500) {
      throw Object.assign(new Error('Give a reason of 10 to 500 characters.'), { statusCode: 400, exposeDetail: true });
    }
    const result = await this.#repository.applyCorrection({
      actorUserId: lecturerUserId,
      attendanceSessionId,
      studentUserId: input.studentId,
      action: input.action,
      reason,
      now: this.#now(),
    });
    switch (result.kind) {
      case 'not_assigned':
        throw new AttendanceSessionUnavailableError();
      case 'session_not_started':
        throw new AttendanceCorrectionNotStartedError();
      case 'not_enrolled':
        throw new AttendanceCorrectionNotEnrolledError();
      case 'no_record':
        throw new AttendanceCorrectionNoRecordError();
      default:
        return result;
    }
  }

  async listCorrections(lecturerUserId: string, attendanceSessionId: string) {
    const corrections = await this.#repository.listCorrections({ lecturerUserId, attendanceSessionId });
    if (!corrections) throw new AttendanceSessionUnavailableError();
    return corrections;
  }
}
