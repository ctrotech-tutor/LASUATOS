import { hashOpaqueToken } from '@lasuatos/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSessionQrChallenge,
  evaluateCircularGeofence,
  generateSessionSecret,
} from '@lasuatos/verification';
import type {
  AttendanceRepository,
  AttendanceSessionRecord,
  CheckInSessionContext,
} from './repository.js';
import {
  AttendanceCorrectionNoRecordError,
  AttendanceCorrectionNotEnrolledError,
  AttendanceCorrectionNotStartedError,
  AttendanceLocationOutsideError,
  AttendanceLocationRequiredError,
  AttendanceNotEnrolledError,
  AttendanceQrRequiredError,
  AttendanceSemesterUnavailableError,
  AttendanceSessionClosedError,
  AttendanceSessionDurationError,
  AttendanceSessionUnavailableError,
  AttendanceVenueChangedError,
  AttendanceService,
  InvalidAttendanceChallengeError,
  InvalidAttendanceCodeError,
  QR_GRACE_WINDOWS,
  sessionDeviceHash,
} from './service.js';

const now = new Date('2026-11-10T12:00:00.000Z');
const session: AttendanceSessionRecord = {
  id: '267fd4d9-07b4-4a1b-b3c2-3f1d2a41a001',
  courseOfferingId: 'b3aa9508-2ead-444c-8b8f-3051fe8d14df',
  courseCode: 'DEMO-101',
  courseTitle: 'Demonstration course',
  title: 'Week 4 lecture',
  venueId: null,
  venueCode: null,
  venueName: null,
  locationRequired: false,
  qrOnly: false,
  status: 'open',
  startsAt: now,
  endsAt: new Date(now.getTime() + 60 * 60_000),
  closedAt: null,
  attendanceCount: 0,
};

const qrSecret = generateSessionSecret();

function openContext(overrides: Partial<CheckInSessionContext> = {}): CheckInSessionContext {
  return {
    sessionId: session.id,
    institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
    courseOfferingId: session.courseOfferingId,
    courseCode: session.courseCode,
    courseTitle: session.courseTitle,
    sessionTitle: session.title,
    status: 'open',
    startsAt: session.startsAt,
    endsAt: session.endsAt,
    qrOnly: false,
    venue: null,
    existingCheckedInAt: null,
    existingStatus: null,
    enrolled: true,
    ...overrides,
  };
}

const checkedInCommit = {
  kind: 'checked_in' as const,
  attendance: {
    attendanceSessionId: session.id,
    courseCode: session.courseCode,
    courseTitle: session.courseTitle,
    sessionTitle: session.title,
    venueName: null,
    venueOutcome: null,
    checkedInAt: now,
  },
};

let repositoryMock: {
  [K in keyof AttendanceRepository]-?: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  repositoryMock = {
    createSession: vi.fn(async () => ({ kind: 'created' as const, session })),
    listLecturerSessions: vi.fn(async () => [session]),
    getLecturerSession: vi.fn(async () => ({ session, attendees: [], sessionStartYear: 2026 })),
    closeSession: vi.fn(async () => 'closed' as const),
    rotateSessionCode: vi.fn(async () => ({ kind: 'rotated' as const, expiresAt: session.endsAt })),
    updateSessionSettings: vi.fn(async () => ({ kind: 'updated' as const, session: { ...session, qrOnly: true } })),
    resolveSessionIdByCodeHash: vi.fn(async () => session.id),
    getSessionQrSecretForCheckIn: vi.fn(async () => ({ qrSecret })),
    getSessionQrMaterial: vi.fn(async () => ({
      sessionId: session.id,
      qrSecret,
      status: 'open' as const,
      endsAt: session.endsAt,
    })),
    setSessionQrSecret: vi.fn(async () => true),
    prepareCheckIn: vi.fn(async () => ({ kind: 'prepared' as const, context: openContext() })),
    commitCheckIn: vi.fn(async () => checkedInCommit),
    listStudentHistory: vi.fn(async () => []),
    listStudentOpenSessions: vi.fn(async () => []),
    getOfferingReportSource: vi.fn(async () => null),
    getStudentSummarySource: vi.fn(async () => ({ enrollments: [], sessions: [], records: [] })),
    applyCorrection: vi.fn(async () => ({ kind: 'not_assigned' as const })),
    listCorrections: vi.fn(async () => null),
  };
});

function makeRepository(overrides: Partial<AttendanceRepository> = {}): AttendanceRepository {
  return { ...repositoryMock, ...overrides } as unknown as AttendanceRepository;
}

function service(repository = makeRepository()) {
  return new AttendanceService({ repository, now: () => now });
}

afterEach(() => vi.clearAllMocks());

describe('attendance service', () => {
  it('creates a random session code and passes only its hash and a QR secret to the repository', async () => {
    repositoryMock.createSession.mockImplementation(async (input: Parameters<AttendanceRepository['createSession']>[0]) => ({
      kind: 'created',
      session: { ...session, endsAt: input.endsAt },
    }));
    const result = await service().createSession('lecturer-id', {
      courseOfferingId: session.courseOfferingId,
      venueId: null,
      title: '  Week 4 lecture  ',
      durationMinutes: 60,
    });

    expect(result.code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(repositoryMock.createSession).toHaveBeenCalledWith(expect.objectContaining({
      lecturerUserId: 'lecturer-id',
      venueId: null,
      title: 'Week 4 lecture',
      codeHash: hashOpaqueToken(result.code),
      startsAt: now,
      endsAt: new Date(now.getTime() + 60 * 60_000),
    }));
    const createdInput = repositoryMock.createSession.mock.calls[0]?.[0];
    expect(createdInput).toMatchObject({ qrSecret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/) });
    expect(result.session.status).toBe('open');
  });

  it('rejects out-of-range session durations before writing', async () => {
    await expect(service().createSession('lecturer-id', {
      courseOfferingId: session.courseOfferingId,
      title: 'Lecture',
      durationMinutes: 241,
    })).rejects.toBeInstanceOf(AttendanceSessionDurationError);
    expect(repositoryMock.createSession).not.toHaveBeenCalled();
  });

  it('keeps lecturer, venue and semester scope failures distinct', async () => {
    repositoryMock.createSession.mockResolvedValueOnce({ kind: 'not_assigned' });
    await expect(service().createSession('lecturer-id', {
      courseOfferingId: session.courseOfferingId, title: 'Lecture', durationMinutes: 30,
    })).rejects.toBeInstanceOf(AttendanceSessionUnavailableError);

    repositoryMock.createSession.mockResolvedValueOnce({ kind: 'venue_unavailable' });
    const venueAttempt = service().createSession('lecturer-id', {
      courseOfferingId: session.courseOfferingId,
      venueId: '05e45470-a8e6-4375-936c-4a84cebe06e8',
      title: 'Lecture',
      durationMinutes: 30,
    });
    await expect(venueAttempt).rejects.toThrow(
      expect.objectContaining({ name: 'AttendanceVenueUnavailableError', statusCode: 409 }),
    );

    repositoryMock.createSession.mockResolvedValueOnce({ kind: 'semester_unavailable' });
    await expect(service().createSession('lecturer-id', {
      courseOfferingId: session.courseOfferingId, title: 'Lecture', durationMinutes: 30,
    })).rejects.toBeInstanceOf(AttendanceSemesterUnavailableError);
  });

  it('normalizes and hashes a typed code, then commits idempotent check-in', async () => {
    repositoryMock.commitCheckIn.mockResolvedValue({
      kind: 'already_checked_in',
      attendance: checkedInCommit.attendance,
    });
    const result = await service().checkIn('student-id', { code: ' abcd-efgh-jk23 ' });
    expect(repositoryMock.resolveSessionIdByCodeHash).toHaveBeenCalledWith(hashOpaqueToken('ABCDEFGHJK23'));
    expect(repositoryMock.commitCheckIn).toHaveBeenCalledWith(expect.objectContaining({
      studentUserId: 'student-id',
      sessionId: session.id,
      method: 'code',
      venueSignature: null,
      evidence: null,
      venueOutcome: null,
      now,
    }));
    expect(result.kind).toBe('already_checked_in');
    expect(result.attendance.attendanceSessionId).toBe(session.id);
  });

  it('does not query the repository for malformed or unknown codes', async () => {
    await expect(service().checkIn('student-id', { code: 'not a session code' }))
      .rejects.toBeInstanceOf(InvalidAttendanceCodeError);
    expect(repositoryMock.resolveSessionIdByCodeHash).not.toHaveBeenCalled();

    repositoryMock.resolveSessionIdByCodeHash.mockResolvedValueOnce(null);
    await expect(service().checkIn('student-id', { code: 'ABCDEFGHJK23' }))
      .rejects.toBeInstanceOf(InvalidAttendanceCodeError);
    expect(repositoryMock.prepareCheckIn).not.toHaveBeenCalled();

    await expect(service().checkIn('student-id', {})).rejects.toBeInstanceOf(InvalidAttendanceCodeError);
  });

  it('verifies rotating QR challenges against the session secret before check-in', async () => {
    const challenge = createSessionQrChallenge({ secret: qrSecret, sessionId: session.id, now }).challenge;
    const result = await service().checkIn('student-id', { challenge });
    expect(result.kind).toBe('checked_in');
    expect(repositoryMock.getSessionQrSecretForCheckIn).toHaveBeenCalledWith(session.id);
    expect(repositoryMock.commitCheckIn).toHaveBeenCalledWith(expect.objectContaining({ method: 'qr_code' }));

    const tampered = `${challenge.slice(0, -3)}AAA`;
    await expect(service().checkIn('student-id', { challenge: tampered }))
      .rejects.toBeInstanceOf(InvalidAttendanceChallengeError);

    await expect(service().checkIn('student-id', { challenge: 'lasu1.not-a-uuid.1.x' }))
      .rejects.toBeInstanceOf(InvalidAttendanceChallengeError);
  });

  it('returns clear state errors for closed sessions and non-enrolled students', async () => {
    repositoryMock.prepareCheckIn.mockResolvedValueOnce({
      kind: 'prepared',
      context: openContext({ status: 'closed' }),
    });
    await expect(service().checkIn('student-id', { code: 'ABCDEFGHJK23' }))
      .rejects.toBeInstanceOf(AttendanceSessionClosedError);

    repositoryMock.prepareCheckIn.mockResolvedValueOnce({
      kind: 'prepared',
      context: openContext({ enrolled: false }),
    });
    await expect(service().checkIn('student-id', { code: 'ABCDEFGHJK23' }))
      .rejects.toBeInstanceOf(AttendanceNotEnrolledError);

    repositoryMock.commitCheckIn.mockResolvedValueOnce({ kind: 'session_closed' });
    await expect(service().checkIn('student-id', { code: 'ABCDEFGHJK23' }))
      .rejects.toBeInstanceOf(AttendanceSessionClosedError);
  });

  it('short-circuits duplicate check-ins before enrollment and venue evaluation', async () => {
    repositoryMock.prepareCheckIn.mockResolvedValue({
      kind: 'prepared',
      context: openContext({ enrolled: false, existingCheckedInAt: now }),
    });
    const result = await service().checkIn('student-id', { code: 'ABCDEFGHJK23' });
    expect(result.kind).toBe('already_checked_in');
    expect(repositoryMock.commitCheckIn).not.toHaveBeenCalled();
  });

  const venueBase = {
    venueId: '05e45470-a8e6-4375-936c-4a84cebe06e8',
    venueCode: 'MLT-A',
    venueName: 'Main Lecture Theatre A',
    venueStatus: 'active' as const,
    locationRequired: true,
    latitude: 6.594255,
    longitude: 3.995948,
    radiusMeters: 80,
  };
  const insideLocation = {
    latitude: 6.594255,
    longitude: 3.995948,
    accuracyMeters: 8,
    capturedAt: now.toISOString(),
  };

  it('requires a location sample when an active venue demands one', async () => {
    repositoryMock.prepareCheckIn.mockResolvedValue({
      kind: 'prepared',
      context: openContext({ venue: venueBase }),
    });
    await expect(service().checkIn('student-id', { code: 'ABCDEFGHJK23' }))
      .rejects.toBeInstanceOf(AttendanceLocationRequiredError);
    expect(repositoryMock.commitCheckIn).not.toHaveBeenCalled();
  });

  it('rejects check-ins clearly outside the venue boundary without writing', async () => {
    repositoryMock.prepareCheckIn.mockResolvedValue({
      kind: 'prepared',
      context: openContext({ venue: venueBase }),
    });
    const far = { latitude: 6.604255, longitude: 3.995948, accuracyMeters: 8, capturedAt: now.toISOString() };
    await expect(service().checkIn('student-id', { code: 'ABCDEFGHJK23', location: far }))
      .rejects.toBeInstanceOf(AttendanceLocationOutsideError);
    expect(repositoryMock.commitCheckIn).not.toHaveBeenCalled();
  });

  it('records inconclusive outcomes honestly instead of failing check-in', async () => {
    repositoryMock.prepareCheckIn.mockResolvedValue({
      kind: 'prepared',
      context: openContext({ venue: venueBase }),
    });
    repositoryMock.commitCheckIn.mockImplementation(async (input) => ({
      kind: 'checked_in',
      attendance: { ...checkedInCommit.attendance, venueOutcome: input.venueOutcome },
    }));
    // ~111 m from center with radius 80 and 60 m accuracy: d - a <= R keeps the outcome inconclusive, not outside.
    const coarse = { latitude: 6.595255, longitude: 3.995948, accuracyMeters: 60, capturedAt: now.toISOString() };
    const result = await service().checkIn('student-id', { code: 'ABCDEFGHJK23', location: coarse });
    const evidenced = repositoryMock.commitCheckIn.mock.calls[0]?.[0];
    expect(evidenced).toMatchObject({
      venueOutcome: 'inconclusive',
      evidence: expect.objectContaining({
        outcome: 'inconclusive',
        radiusMeters: 80,
        accuracyMeters: 60,
      }),
    });
    expect(result.kind).toBe('checked_in');
    expect(result.attendance.venueOutcome).toBe('inconclusive');
  });

  it('passes a within-boundary outcome through to the commit with evidence', async () => {
    repositoryMock.prepareCheckIn.mockResolvedValue({
      kind: 'prepared',
      context: openContext({ venue: venueBase }),
    });
    repositoryMock.commitCheckIn.mockImplementation(async (input) => ({
      kind: 'checked_in',
      attendance: { ...checkedInCommit.attendance, venueOutcome: input.venueOutcome },
    }));
    const result = await service().checkIn('student-id', { code: 'ABCDEFGHJK23', location: insideLocation });
    expect(repositoryMock.commitCheckIn).toHaveBeenCalledWith(expect.objectContaining({
      venueOutcome: 'within_boundary',
      evidence: expect.objectContaining({ outcome: 'within_boundary', accuracyMeters: 8 }),
    }));
    expect(result.attendance.venueOutcome).toBe('within_boundary');
  });

  it('allows check-in without location when the active venue does not require it', async () => {
    repositoryMock.prepareCheckIn.mockResolvedValue({
      kind: 'prepared',
      context: openContext({ venue: { ...venueBase, locationRequired: false } }),
    });
    const result = await service().checkIn('student-id', { code: 'ABCDEFGHJK23' });
    expect(result.kind).toBe('checked_in');
    expect(repositoryMock.commitCheckIn).toHaveBeenCalledWith(expect.objectContaining({
      evidence: null,
      venueOutcome: null,
    }));
  });

  it('skips venue verification when the venue is deactivated or has no boundary', async () => {
    repositoryMock.prepareCheckIn.mockResolvedValue({
      kind: 'prepared',
      context: openContext({ venue: { ...venueBase, venueStatus: 'inactive' } }),
    });
    const result = await service().checkIn('student-id', { code: 'ABCDEFGHJK23' });
    expect(result.kind).toBe('checked_in');
    expect(repositoryMock.commitCheckIn).toHaveBeenCalledWith(expect.objectContaining({
      venueSignature: null,
      evidence: null,
      venueOutcome: null,
    }));
  });

  it('retries once when the venue changes during commit, then reports a conflict', async () => {
    repositoryMock.prepareCheckIn
      .mockResolvedValueOnce({ kind: 'prepared', context: openContext({ venue: venueBase }) })
      .mockResolvedValueOnce({ kind: 'prepared', context: openContext({ venue: venueBase }) })
      .mockResolvedValueOnce({ kind: 'prepared', context: openContext({ venue: venueBase }) });
    repositoryMock.commitCheckIn.mockResolvedValue({ kind: 'venue_changed' });
    await expect(service().checkIn('student-id', { code: 'ABCDEFGHJK23', location: insideLocation }))
      .rejects.toBeInstanceOf(AttendanceVenueChangedError);
    expect(repositoryMock.commitCheckIn).toHaveBeenCalledTimes(2);
  });

  it('issues rotating QR challenges for open sessions and backfills missing secrets', async () => {
    const result = await service().getSessionQrChallenge('lecturer-id', session.id);
    expect(result.challenge.startsWith(`lasu1.${session.id}.`)).toBe(true);
    expect(result.validUntil.getTime()).toBeGreaterThan(now.getTime());
    expect(result.sessionEndsAt).toEqual(session.endsAt);

    repositoryMock.getSessionQrMaterial.mockResolvedValueOnce({
      sessionId: session.id,
      qrSecret: null,
      status: 'open',
      endsAt: session.endsAt,
    });
    repositoryMock.setSessionQrSecret.mockResolvedValueOnce(true);
    const backfilled = await service().getSessionQrChallenge('lecturer-id', session.id);
    expect(repositoryMock.setSessionQrSecret).toHaveBeenCalled();
    expect(backfilled.challenge.startsWith(`lasu1.${session.id}.`)).toBe(true);

    repositoryMock.getSessionQrMaterial.mockResolvedValueOnce(null);
    await expect(service().getSessionQrChallenge('lecturer-id', session.id))
      .rejects.toBeInstanceOf(AttendanceSessionUnavailableError);

    repositoryMock.getSessionQrMaterial.mockResolvedValueOnce({
      sessionId: session.id,
      qrSecret,
      status: 'closed',
      endsAt: session.endsAt,
    });
    await expect(service().getSessionQrChallenge('lecturer-id', session.id))
      .rejects.toBeInstanceOf(AttendanceSessionClosedError);
  });

  it('marks elapsed but unclosed sessions as expired for display', async () => {
    repositoryMock.listLecturerSessions.mockResolvedValue([{
      ...session,
      endsAt: new Date(now.getTime() - 1),
    }]);
    const [result] = await service().listLecturerSessions('lecturer-id');
    expect(result?.status).toBe('expired');
  });

  it('lists a student\'s open sessions with the service clock', async () => {
    const open = {
      attendanceSessionId: session.id,
      courseOfferingId: session.courseOfferingId,
      courseCode: session.courseCode,
      courseTitle: session.courseTitle,
      sessionTitle: session.title,
      venueCode: 'MLT-A',
      venueName: 'Main Lecture Theatre A',
      locationRequired: true,
      endsAt: session.endsAt,
    };
    repositoryMock.listStudentOpenSessions.mockResolvedValue([open]);
    await expect(service().listStudentOpenSessions('student-id')).resolves.toEqual([open]);
    expect(repositoryMock.listStudentOpenSessions).toHaveBeenCalledWith({ studentUserId: 'student-id', now });
  });

  it('exposes the geofence evaluator as pure verification logic', () => {
    const within = evaluateCircularGeofence(
      { kind: 'circle', center: { latitude: 6.594255, longitude: 3.995948 }, radiusMeters: 80 },
      { latitude: 6.594255, longitude: 3.995948, accuracyMeters: 8, capturedAt: now },
      now,
    );
    expect(within.outcome).toBe('within');
  });
});

describe('attendance corrections and reports', () => {
  const studentId = '6b6d4f43-6a0e-4c43-9a43-8b5a2f7a1c01';

  it('trims the reason, rejects reasons outside 10 to 500 characters, and never touches the repository for them', async () => {
    for (const reason of ['   too short  ', 'x'.repeat(501)]) {
      await expect(service().applyCorrection('lecturer-id', session.id, { studentId, action: 'revoke', reason }))
        .rejects.toMatchObject({ statusCode: 400, exposeDetail: true });
    }
    expect(repositoryMock.applyCorrection).not.toHaveBeenCalled();
  });

  it('passes the trimmed reason, actor, and clock to the repository and returns applied records', async () => {
    const record = {
      studentUserId: studentId,
      status: 'revoked' as const,
      method: 'code' as const,
      venueOutcome: null,
      checkedInAt: now,
      revokedAt: now,
    };
    repositoryMock.applyCorrection.mockResolvedValueOnce({ kind: 'applied', record });
    const result = await service().applyCorrection('lecturer-id', session.id, {
      studentId,
      action: 'revoke',
      reason: '  Code shared outside the lecture hall.  ',
    });
    expect(result).toEqual({ kind: 'applied', record });
    expect(repositoryMock.applyCorrection).toHaveBeenCalledWith({
      actorUserId: 'lecturer-id',
      attendanceSessionId: session.id,
      studentUserId: studentId,
      action: 'revoke',
      reason: 'Code shared outside the lecture hall.',
      now,
    });
  });

  it.each([
    ['not_assigned', AttendanceSessionUnavailableError, 404],
    ['session_not_started', AttendanceCorrectionNotStartedError, 409],
    ['not_enrolled', AttendanceCorrectionNotEnrolledError, 409],
    ['no_record', AttendanceCorrectionNoRecordError, 409],
  ] as const)('maps repository outcome %s to a user-facing error', async (kind, ErrorClass, statusCode) => {
    repositoryMock.applyCorrection.mockResolvedValueOnce({ kind });
    const attempt = service().applyCorrection('lecturer-id', session.id, {
      studentId,
      action: kind === 'no_record' ? 'revoke' : 'mark_present',
      reason: 'Present in class; location failed.',
    });
    await expect(attempt).rejects.toBeInstanceOf(ErrorClass);
    await expect(attempt).rejects.toMatchObject({ statusCode, exposeDetail: true });
  });

  it('hides the audit trail and report from lecturers who are not assigned', async () => {
    await expect(service().listCorrections('lecturer-id', session.id)).rejects.toBeInstanceOf(AttendanceSessionUnavailableError);
    await expect(service().getOfferingReport('lecturer-id', session.courseOfferingId)).rejects.toBeInstanceOf(AttendanceSessionUnavailableError);
  });

  describe('QR-only sessions, device signal and levels', () => {
    it('refuses typed codes for QR-only sessions but accepts the scanned challenge', async () => {
      repositoryMock.prepareCheckIn.mockResolvedValue({ kind: 'prepared', context: openContext({ qrOnly: true }) });
      await expect(service().checkIn('student-id', { code: 'ABCDEFGHJK23' }))
        .rejects.toBeInstanceOf(AttendanceQrRequiredError);
      expect(repositoryMock.commitCheckIn).not.toHaveBeenCalled();

      const challenge = createSessionQrChallenge({ secret: qrSecret, sessionId: session.id, now }).challenge;
      await expect(service().checkIn('student-id', { challenge })).resolves.toMatchObject({ kind: 'checked_in' });
    });

    it('still reports an existing check-in when a QR-only session receives the typed code', async () => {
      repositoryMock.prepareCheckIn.mockResolvedValue({
        kind: 'prepared',
        context: openContext({ qrOnly: true, existingCheckedInAt: now, existingStatus: 'present' }),
      });
      await expect(service().checkIn('student-id', { code: 'ABCDEFGHJK23' }))
        .resolves.toMatchObject({ kind: 'already_checked_in' });
    });

    it('maps a QR-only switch that races the commit to the same refusal', async () => {
      repositoryMock.commitCheckIn.mockResolvedValueOnce({ kind: 'qr_required' });
      await expect(service().checkIn('student-id', { code: 'ABCDEFGHJK23' }))
        .rejects.toMatchObject({ statusCode: 409, exposeDetail: true, name: 'AttendanceQrRequiredError' });
    });

    it('accepts challenges for the grace windows and rejects older ones', async () => {
      const windowMs = 20_000;
      const old = (windows: number) => createSessionQrChallenge({
        secret: qrSecret,
        sessionId: session.id,
        now: new Date(now.getTime() - windows * windowMs),
      }).challenge;
      await expect(service().checkIn('student-id', { challenge: old(QR_GRACE_WINDOWS) }))
        .resolves.toMatchObject({ kind: 'checked_in' });
      await expect(service().checkIn('student-id', { challenge: old(QR_GRACE_WINDOWS + 1) }))
        .rejects.toBeInstanceOf(InvalidAttendanceChallengeError);
    });

    it('stores only a per-session hash of the browser token', async () => {
      const token = 'abcdefghijklmnop_QRSTUV-123';
      await service().checkIn('student-id', { code: 'ABCDEFGHJK23', deviceToken: token });
      const committed = repositoryMock.commitCheckIn.mock.calls[0]?.[0] as { deviceHash: string | null };
      expect(committed.deviceHash).toMatch(/^[0-9a-f]{64}$/);
      expect(committed.deviceHash).not.toContain(token);
      expect(committed.deviceHash).toBe(sessionDeviceHash(session.id, token));
      expect(sessionDeviceHash('8b0f4c5e-7d0a-4b67-9a33-0f5d8b2c1e11', token)).not.toBe(committed.deviceHash);
      expect(sessionDeviceHash(session.id, 'short')).toBeNull();
      expect(sessionDeviceHash(session.id, undefined)).toBeNull();

      await service().checkIn('student-id', { code: 'ABCDEFGHJK23' });
      expect(repositoryMock.commitCheckIn.mock.calls[1]?.[0]).toMatchObject({ deviceHash: null });
    });

    it('passes QR-only through session creation and lets lecturers toggle it on an open session', async () => {
      await service().createSession('lecturer-id', {
        courseOfferingId: session.courseOfferingId,
        title: 'Week 5',
        durationMinutes: 30,
        qrOnly: true,
      });
      expect(repositoryMock.createSession).toHaveBeenCalledWith(expect.objectContaining({ qrOnly: true }));

      const updated = await service().updateSessionSettings('lecturer-id', session.id, { qrOnly: true });
      expect(updated.qrOnly).toBe(true);
      expect(repositoryMock.updateSessionSettings).toHaveBeenCalledWith({
        lecturerUserId: 'lecturer-id',
        attendanceSessionId: session.id,
        qrOnly: true,
        now,
      });

      repositoryMock.updateSessionSettings.mockResolvedValueOnce({ kind: 'session_closed' });
      await expect(service().updateSessionSettings('lecturer-id', session.id, { qrOnly: false }))
        .rejects.toBeInstanceOf(AttendanceSessionClosedError);
      repositoryMock.updateSessionSettings.mockResolvedValueOnce({ kind: 'not_assigned' });
      await expect(service().updateSessionSettings('lecturer-id', session.id, { qrOnly: false }))
        .rejects.toBeInstanceOf(AttendanceSessionUnavailableError);
    });

    it('labels attendee levels and counts shared-device check-ins', async () => {
      const attendee = {
        displayName: 'A Student',
        checkedInAt: now,
        method: 'qr_code' as const,
        venueOutcome: null,
        status: 'present' as const,
        revokedAt: null,
        entryYear: null,
        entryLevel: 100,
        programmeYears: 5,
      };
      repositoryMock.getLecturerSession.mockResolvedValueOnce({
        session,
        sessionStartYear: 2026,
        attendees: [
          { ...attendee, studentUserId: 'a', studentNumber: '240591001', sharedDevice: true },
          { ...attendee, studentUserId: 'b', studentNumber: '210591001', sharedDevice: true },
          { ...attendee, studentUserId: 'c', studentNumber: 'not-lasu', sharedDevice: false },
        ],
      });
      const detail = await service().getLecturerSession('lecturer-id', session.id);
      expect(detail.session.sharedDeviceCount).toBe(2);
      expect(detail.attendees.map((row) => row.levelLabel)).toEqual(['300 Level', '500 Level · extra year', 'Level unknown']);
    });
  });
});
