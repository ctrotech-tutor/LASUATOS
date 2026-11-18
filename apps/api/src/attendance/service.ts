import { createHash, randomBytes } from 'node:crypto';
import { hashOpaqueToken } from '@lasuatos/auth';
import { ATTENDANCE_SESSION_MAX_MINUTES, type CheckInLocationSample } from '@lasuatos/contracts';
import {
  createCheckInTicket,
  createSessionQrChallenge,
  evaluateCircularGeofence,
  generateSessionSecret,
  parseCheckInTicket,
  parseSessionQrChallenge,
  verifyCheckInTicket,
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
  REPORT_OVERVIEW_LIMIT,
  summarizeReport,
  type ReportOverviewCourse,
  buildStudentMissed,
  buildStudentSummary,
  renderReportCsv,
  reportCsvFilename,
} from './report.js';
import { studentLevelFor } from '../academic/student-level.js';

const ATTENDANCE_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const ATTENDANCE_CODE_LENGTH = 12;
const ATTENDANCE_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{12}$/;
/**
 * Previous QR windows still accepted at check-in. With 20-second windows a
 * scanned code stays valid for 40–60 seconds: long enough for a phone to open
 * the link, finish sign-in and take a location reading on a slow network,
 * short enough that a forwarded screenshot is soon useless (and the venue
 * boundary still applies to whoever submits it).
 */
export const QR_GRACE_WINDOWS = 2;
const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

/**
 * Per-session device hash. Salting with the session id means the stored
 * value only ever reveals "these check-ins in this session came from the same
 * browser", never a device's history across sessions.
 */
export function sessionDeviceHash(sessionId: string, deviceToken: string | undefined): string | null {
  if (!deviceToken || !DEVICE_TOKEN_PATTERN.test(deviceToken)) return null;
  return createHash('sha256').update(`${sessionId.toLowerCase()}:${deviceToken}`).digest('hex');
}

/**
 * How many different students one phone can check in to one course session:
 * its owner and one classmate (the same rule as Take attendance).
 */
export const MAX_STUDENTS_PER_PHONE = 2;

/** The face-check ticket is signed with the session's QR secret and the student: only they can use it. */
function faceTicketSecret(qrSecret: string, studentUserId: string): string {
  return `${qrSecret}:course-face:${studentUserId.toLowerCase()}`;
}

export interface FaceFrameInput {
  readonly pose: 'front' | 'left' | 'right';
  readonly image: string;
}

/** The face check of a course check-in (StudentService; see CheckInFaceGate in the lecture service). */
export interface AttendanceFaceGate {
  checkInFaceStatus(userId: string | null, ticket: string): Promise<{ required: boolean; turn: 'left' | 'right'; registered: boolean | null }>;
  verifyCheckInFace(input: {
    readonly userId: string;
    readonly institutionId: string;
    readonly lectureSessionId: string;
    readonly ticket: string;
    readonly frames: readonly FaceFrameInput[] | undefined;
    readonly takerName: string;
    readonly record?: boolean;
  }): Promise<number | null>;
  assertCheckInFaceRoom?(photos: number): void;
  /** Throws (429) when this class's face checks are used up; asked before the camera opens. */
  assertCheckInFaceAttemptsLeft?(userId: string, sessionId: string, takerName: string): Promise<void>;
}

interface CourseCheckInSummary {
  readonly attendanceSessionId: string;
  readonly courseCode: string;
  readonly courseTitle: string;
  readonly sessionTitle: string;
  readonly venueName: string | null;
}

export type CourseCheckInResult =
  | {
    readonly kind: 'checked_in' | 'already_checked_in';
    readonly attendance: CourseCheckInSummary & { readonly venueOutcome: 'within_boundary' | 'inconclusive' | null; readonly checkedInAt: Date };
  }
  | {
    readonly kind: 'face_required';
    readonly session: CourseCheckInSummary;
    readonly face: { readonly ticket: string; readonly turn: 'left' | 'right'; readonly registered: boolean };
  };

export class AttendanceDeviceFullError extends Error {
  readonly statusCode = 409;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor(others: number) {
    super(`This phone has already marked ${others} students present for this class. A phone can mark its owner and one classmate. Use your own phone, or ask your lecturer to mark you present.`);
    this.name = 'AttendanceDeviceFullError';
  }
}

export class AttendanceTicketExpiredError extends Error {
  readonly statusCode = 410;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('This check-in expired. Scan the QR code your lecturer is showing again.');
    this.name = 'AttendanceTicketExpiredError';
  }
}

export class AttendanceStartingPasswordError extends Error {
  readonly statusCode = 403;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('You signed in with the starting password, which anyone who knows your matric number and surname can work out. Choose your own password in Account setup (we email you a code), then mark your attendance.');
    this.name = 'AttendanceStartingPasswordError';
  }
}

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

export class AttendanceSessionTooLongError extends Error {
  readonly statusCode = 409;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super(`A session can stay open for at most ${ATTENDANCE_SESSION_MAX_MINUTES / 60} hours. Close this one and open another if class runs on.`);
    this.name = 'AttendanceSessionTooLongError';
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

export class AttendanceQrRequiredError extends Error {
  readonly statusCode = 409;
  /** Server-authored, request-independent message safe to show the user. */
  readonly exposeDetail = true;
  constructor() {
    super('This session only accepts the QR code shown in the room. Tap “Scan QR code” and point your camera at the lecturer’s screen.');
    this.name = 'AttendanceQrRequiredError';
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
  readonly #faces: AttendanceFaceGate | undefined;

  constructor(options: { readonly repository: AttendanceRepository; readonly now?: () => Date; readonly faces?: AttendanceFaceGate | undefined }) {
    this.#repository = options.repository;
    this.#now = options.now ?? (() => new Date());
    this.#faces = options.faces;
  }

  /** See AttendanceFaceGate.assertCheckInFaceRoom: a crowd's retries are turned away before any work. */
  assertCheckInRoom(photos: number): void {
    this.#faces?.assertCheckInFaceRoom?.(photos);
  }

  async createSession(lecturerUserId: string, input: {
    readonly courseOfferingId: string;
    readonly venueId?: string | null;
    readonly title: string;
    readonly durationMinutes: number;
    readonly qrOnly?: boolean;
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
      qrOnly: input.qrOnly ?? false,
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
    const attendees = detail.attendees.map((attendee) => ({
      ...attendee,
      levelLabel: studentLevelFor(attendee, detail.sessionStartYear).label,
    }));
    return {
      session: {
        ...publicSession(detail.session, this.#now()),
        sharedDeviceCount: attendees.filter((attendee) => attendee.sharedDevice).length,
      },
      attendees,
      notCheckedIn: (detail.notCheckedIn ?? []).map((student) => ({
        studentUserId: student.studentUserId,
        displayName: student.displayName,
        studentNumber: student.studentNumber,
        levelLabel: studentLevelFor(student, detail.sessionStartYear).label,
      })),
    };
  }

  /** Switches QR-only on or off, or adds time, for an open session. */
  async updateSessionSettings(lecturerUserId: string, attendanceSessionId: string, input: {
    readonly qrOnly?: boolean | undefined;
    readonly extendMinutes?: number | undefined;
  }) {
    const now = this.#now();
    const result = await this.#repository.updateSessionSettings({
      lecturerUserId,
      attendanceSessionId,
      ...(input.qrOnly === undefined ? {} : { qrOnly: input.qrOnly }),
      ...(input.extendMinutes ? { extendMinutes: input.extendMinutes, maxMinutes: ATTENDANCE_SESSION_MAX_MINUTES } : {}),
      now,
    });
    if (result.kind === 'not_assigned') throw new AttendanceSessionUnavailableError();
    if (result.kind === 'session_closed') throw new AttendanceSessionClosedError();
    if (result.kind === 'too_long') throw new AttendanceSessionTooLongError();
    return publicSession(result.session, now);
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

    const challenge = createSessionQrChallenge({
      secret,
      sessionId: material.sessionId,
      now,
      graceWindows: QR_GRACE_WINDOWS,
    });
    return { ...challenge, sessionEndsAt: material.endsAt };
  }

  /**
   * A student checks in to a course session (the course's rotating QR code or
   * typed code). It runs in two calls when face checks are on (ADR 033):
   *
   * 1. With the code or QR challenge: every other rule is checked (session
   *    open, enrolled, QR-only, the phone limit, the venue), then the answer
   *    is `face_required` with a ticket bound to this student and the way to
   *    turn. The code itself may expire while the camera is open; the ticket
   *    lasts 10 minutes.
   * 2. With the ticket and the camera photos: the same rules again, then the
   *    face check, then the record.
   *
   * With face checks off the first call records the check-in, as before.
   */
  async checkIn(studentUserId: string, input: {
    readonly code?: string;
    readonly challenge?: string;
    readonly ticket?: string;
    readonly location?: CheckInLocationSample;
    readonly deviceToken?: string;
    readonly face?: { readonly frames: readonly FaceFrameInput[] } | undefined;
    /** The session was started with the starting password (ADR 033). */
    readonly startingPasswordSession?: boolean;
  }): Promise<CourseCheckInResult> {
    const now = this.#now();

    // With face checks off nothing else proves who is marking: a guessable password is not enough.
    if (input.startingPasswordSession && !this.#faces) throw new AttendanceStartingPasswordError();

    // Step 1: resolve the presented credential to a session.
    let sessionId: string;
    let method: 'code' | 'qr_code';
    let qrSecret: string | null = null;
    if (input.ticket != null) {
      const parsed = parseCheckInTicket(input.ticket);
      if (!parsed) throw new AttendanceTicketExpiredError();
      const material = await this.#repository.getSessionQrSecretForCheckIn(parsed.sessionId);
      if (!material?.qrSecret || !verifyCheckInTicket(input.ticket, { secret: faceTicketSecret(material.qrSecret, studentUserId), now })) {
        throw new AttendanceTicketExpiredError();
      }
      sessionId = parsed.sessionId;
      method = parsed.method === 'qr' ? 'qr_code' : 'code';
      qrSecret = material.qrSecret;
    } else if (input.code != null) {
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
      const verified = verifySessionQrChallenge(input.challenge, {
        secret: material.qrSecret,
        now,
        graceWindows: QR_GRACE_WINDOWS,
      });
      if (!verified.valid) throw new InvalidAttendanceChallengeError();
      sessionId = verified.sessionId;
      qrSecret = material.qrSecret;
    } else {
      throw new InvalidAttendanceCodeError();
    }

    // Step 2: load the decision context, preserving the historical error
    // precedence (duplicate → session closed → enrollment).
    const deviceHash = sessionDeviceHash(sessionId, input.deviceToken);
    const prepared = await this.#repository.prepareCheckIn({ studentUserId, sessionId, now, deviceHash });
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
    if (method === 'code' && context.qrOnly) throw new AttendanceQrRequiredError();
    if (!context.enrolled) throw new AttendanceNotEnrolledError();

    // A phone marks its owner and at most one classmate per class (as Take
    // attendance does). Checked again under the session lock at commit.
    if (deviceHash && (context.otherStudentsOnDevice ?? 0) >= MAX_STUDENTS_PER_PHONE) {
      throw new AttendanceDeviceFullError(context.otherStudentsOnDevice ?? MAX_STUDENTS_PER_PHONE);
    }

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

    // Step 4: the face check, last because it is the slow step. The first
    // call only hands out the ticket; the photos come with the second.
    let faceScore: number | null = null;
    if (this.#faces) {
      if (input.ticket == null) {
        // Sessions always get a QR secret when they open; one without (older than that) cannot be open now.
        if (!qrSecret) qrSecret = (await this.#repository.getSessionQrSecretForCheckIn(sessionId))?.qrSecret ?? null;
        if (!qrSecret) throw new AttendanceSessionClosedError();
        const { ticket } = createCheckInTicket({
          secret: faceTicketSecret(qrSecret, studentUserId),
          sessionId,
          method: method === 'qr_code' ? 'qr' : 'code',
          now,
        });
        const status = await this.#faces.checkInFaceStatus(studentUserId, ticket);
        // Locked out after repeated failures: say so now, not after the photos.
        if (status.registered !== false) await this.#faces.assertCheckInFaceAttemptsLeft?.(studentUserId, sessionId, 'your lecturer');
        return {
          kind: 'face_required' as const,
          session: {
            attendanceSessionId: context.sessionId,
            courseCode: context.courseCode,
            courseTitle: context.courseTitle,
            sessionTitle: context.sessionTitle,
            venueName: context.venue?.venueName ?? null,
          },
          face: { ticket, turn: status.turn, registered: status.registered !== false },
        };
      }
      faceScore = await this.#faces.verifyCheckInFace({
        userId: studentUserId,
        institutionId: context.institutionId,
        lectureSessionId: context.sessionId,
        ticket: input.ticket,
        frames: input.face?.frames,
        takerName: 'your lecturer',
        record: false,
      });
    }

    // Step 5: commit atomically, retrying once if the venue drifted between
    // the evaluation snapshot and the commit.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = await this.#repository.commitCheckIn({
        studentUserId,
        sessionId,
        method,
        venueSignature,
        evidence,
        venueOutcome: evidence?.outcome ?? null,
        deviceHash,
        maxStudentsPerDevice: MAX_STUDENTS_PER_PHONE,
        faceScore,
        now,
      });
      if (result.kind === 'session_closed') throw new AttendanceSessionClosedError();
      if (result.kind === 'qr_required') throw new AttendanceQrRequiredError();
      if (result.kind === 'revoked') throw new AttendanceRecordRevokedError();
      if (result.kind === 'device_full') throw new AttendanceDeviceFullError(result.others);
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

  /** Classes of the student's courses they missed, by the summary's own rule (newest first). */
  async listStudentMissed(studentUserId: string) {
    const source = await this.#repository.getStudentSummarySource({ studentUserId, now: this.#now() });
    return buildStudentMissed(source);
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

  /**
   * Where each of the lecturer's courses stands, for the reports list: the same figures as the
   * full report (built by the same code), without the register itself. Courses are read a few
   * at a time; a course the lecturer is no longer assigned to is left out.
   */
  async getReportOverview(lecturerUserId: string, threshold?: number) {
    const now = this.#now();
    const effectiveThreshold = threshold != null && Number.isInteger(threshold) && threshold >= 1 && threshold <= 100
      ? threshold
      : DEFAULT_ATTENDANCE_THRESHOLD;
    const ids = await this.#repository.listReportOfferingIds({ lecturerUserId, now, limit: REPORT_OVERVIEW_LIMIT });
    const courses: ReportOverviewCourse[] = [];
    for (let start = 0; start < ids.length; start += 4) {
      const sources = await Promise.all(ids.slice(start, start + 4).map((courseOfferingId) =>
        this.#repository.getOfferingReportSource({ lecturerUserId, courseOfferingId, now })));
      for (const source of sources) {
        if (source) courses.push(summarizeReport(buildOfferingReport(source, { now, threshold: effectiveThreshold })));
      }
    }
    return { threshold: effectiveThreshold, courses };
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
