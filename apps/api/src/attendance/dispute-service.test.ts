import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceDisputeRepository, LecturerDisputeRecord, StudentDisputeRecord } from './dispute-repository.js';
import type { DisputeFacts } from './dispute-policy.js';
import { AttendanceDisputeService } from './dispute-service.js';
import type { DisputeNotifier } from '../email/transport.js';

const now = new Date('2026-11-04T09:00:00.000Z');
const sessionId = '267fd4d9-07b4-4a1b-b3c2-3f1d2a41a001';
const disputeId = '5b0f8a9e-8d1c-4c71-9d53-4c1b6c0e2a11';
const statement = 'I was in the lecture hall but my phone could not load the page.';

const baseFacts: DisputeFacts = {
  session: {
    status: 'closed',
    startsAt: new Date('2026-11-03T10:00:00.000Z'),
    endsAt: new Date('2026-11-03T11:00:00.000Z'),
    closedAt: new Date('2026-11-03T11:00:00.000Z'),
  },
  enrollment: { status: 'active', enrolledAt: new Date('2026-09-01T00:00:00.000Z') },
  recordStatus: null,
  priorDisputeStatuses: [],
  openDisputeCount: 0,
};

const studentDispute: StudentDisputeRecord = {
  id: disputeId,
  attendanceSessionId: sessionId,
  courseOfferingId: 'b3aa9508-2ead-444c-8b8f-3051fe8d14df',
  courseCode: 'DEMO-101',
  courseTitle: 'Demo Course',
  sessionTitle: 'Week 1 Lecture',
  sessionStartsAt: baseFacts.session.startsAt,
  kind: 'missing_check_in',
  status: 'open',
  statement,
  resolutionNote: null,
  resolvedByName: null,
  resolvedAt: null,
  createdAt: now,
  appeal: null,
  appealFacts: { disputeStatus: 'open', resolvedAt: null, hasAppeal: false, enrollmentStatus: 'active', recordStatus: null },
};

let repository: { [K in keyof AttendanceDisputeRepository]: ReturnType<typeof vi.fn> };

beforeEach(() => {
  repository = {
    getDisputeFacts: vi.fn(async () => ({
      institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
      courseOfferingId: studentDispute.courseOfferingId,
      facts: baseFacts,
    })),
    insertDispute: vi.fn(async () => ({ kind: 'inserted' as const, dispute: studentDispute })),
    listStudentDisputes: vi.fn(async () => [studentDispute]),
    listStudentDisputeCandidates: vi.fn(async () => ({ candidates: [], openDisputeCount: 0 })),
    withdrawDispute: vi.fn(async () => ({ kind: 'withdrawn' as const, dispute: { ...studentDispute, status: 'withdrawn' as const } })),
    listLecturerDisputes: vi.fn(async () => ({ disputes: [], openCount: 0 })),
    countOpenLecturerDisputes: vi.fn(async () => 0),
    resolveDispute: vi.fn(async () => ({ kind: 'not_found' as const })),
    getDisputeNoticeContext: vi.fn(async () => noticeContext),
    getAppealFacts: vi.fn(async () => null),
    insertAppeal: vi.fn(async () => ({ kind: 'already_appealed' as const })),
    withdrawAppeal: vi.fn(async () => ({ kind: 'not_found' as const })),
    listAdministratorAppeals: vi.fn(async () => ({ appeals: [], openCount: 0 })),
    countOpenAdministratorAppeals: vi.fn(async () => 0),
    decideAppeal: vi.fn(async () => ({ kind: 'not_found' as const })),
    getAppealNoticeContext: vi.fn(async () => null),
  };
});

const noticeContext = {
  courseCode: 'DEMO-101',
  sessionTitle: 'Week 1 Lecture',
  sessionStartsAt: baseFacts.session.startsAt,
  student: { email: 'student@test.invalid', displayName: 'Ada Student' },
  lecturers: [
    { userId: 'lecturer-1', email: 'one@test.invalid', displayName: 'Dr One', openDisputeCount: 3 },
    { userId: 'lecturer-2', email: 'gone@test.invalid', displayName: 'Dr Gone', openDisputeCount: 0 },
  ],
  openForSession: 1,
};

afterEach(() => vi.clearAllMocks());

function service() {
  return new AttendanceDisputeService({ repository: repository as unknown as AttendanceDisputeRepository, now: () => now });
}

describe('attendance dispute service', () => {
  it('trims the statement, derives the kind on the server, and inserts once eligible', async () => {
    await service().submitDispute('student-id', { attendanceSessionId: sessionId, statement: `   ${statement}   ` });
    expect(repository.insertDispute).toHaveBeenCalledWith(expect.objectContaining({
      studentUserId: 'student-id',
      attendanceSessionId: sessionId,
      kind: 'missing_check_in',
      statement,
      now,
    }));
    repository.getDisputeFacts.mockResolvedValueOnce({
      institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
      courseOfferingId: studentDispute.courseOfferingId,
      facts: { ...baseFacts, recordStatus: 'revoked' },
    });
    await service().submitDispute('student-id', { attendanceSessionId: sessionId, statement });
    expect(repository.insertDispute).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'revoked_check_in' }));
  });

  it('rejects bad statements before touching the repository', async () => {
    for (const bad of ['  too short   ', 'x'.repeat(1001)]) {
      await expect(service().submitDispute('student-id', { attendanceSessionId: sessionId, statement: bad }))
        .rejects.toMatchObject({ statusCode: 400, exposeDetail: true });
    }
    expect(repository.getDisputeFacts).not.toHaveBeenCalled();
  });

  it('maps ineligibility and races to user-facing errors with exposed details', async () => {
    repository.getDisputeFacts.mockResolvedValueOnce(null);
    await expect(service().submitDispute('student-id', { attendanceSessionId: sessionId, statement }))
      .rejects.toMatchObject({ statusCode: 404, name: 'DisputeSessionUnavailableError', exposeDetail: true });

    repository.getDisputeFacts.mockResolvedValueOnce({
      institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
      courseOfferingId: studentDispute.courseOfferingId,
      facts: { ...baseFacts, openDisputeCount: 10 },
    });
    await expect(service().submitDispute('student-id', { attendanceSessionId: sessionId, statement }))
      .rejects.toMatchObject({ statusCode: 409, name: 'DisputeTooManyOpenError' });

    repository.insertDispute.mockResolvedValueOnce({ kind: 'already_open' });
    await expect(service().submitDispute('student-id', { attendanceSessionId: sessionId, statement }))
      .rejects.toMatchObject({ statusCode: 409, name: 'DisputeAlreadyOpenError' });
    expect(repository.insertDispute).toHaveBeenCalledTimes(1);
  });

  it('lists only structurally eligible sessions, ignoring the open cap for visibility', async () => {
    repository.listStudentDisputeCandidates.mockResolvedValueOnce({
      openDisputeCount: 10,
      candidates: [
        { attendanceSessionId: sessionId, courseOfferingId: 'o', courseCode: 'DEMO-101', courseTitle: 'Demo', sessionTitle: 'Missed', facts: baseFacts, revocation: null },
        { attendanceSessionId: 'present', courseOfferingId: 'o', courseCode: 'DEMO-101', courseTitle: 'Demo', sessionTitle: 'Attended', facts: { ...baseFacts, recordStatus: 'present' }, revocation: null },
        { attendanceSessionId: 'decided', courseOfferingId: 'o', courseCode: 'DEMO-101', courseTitle: 'Demo', sessionTitle: 'Decided', facts: { ...baseFacts, priorDisputeStatuses: ['rejected'] }, revocation: null },
      ],
    });
    const result = await service().getStudentDisputes('student-id');
    expect(result.disputableSessions).toEqual([expect.objectContaining({
      attendanceSessionId: sessionId,
      kind: 'missing_check_in',
      disputeDeadline: new Date('2026-11-17T11:00:00.000Z'),
    })]);
    expect(result).toMatchObject({ windowDays: 14, openLimit: 10, disputes: [studentDispute] });
  });

  it('maps withdrawal outcomes', async () => {
    expect((await service().withdrawDispute('student-id', disputeId)).status).toBe('withdrawn');
    repository.withdrawDispute.mockResolvedValueOnce({ kind: 'not_found' });
    await expect(service().withdrawDispute('student-id', disputeId)).rejects.toMatchObject({ statusCode: 404 });
    repository.withdrawDispute.mockResolvedValueOnce({ kind: 'not_open' });
    await expect(service().withdrawDispute('student-id', disputeId)).rejects.toMatchObject({ statusCode: 409, name: 'DisputeNotOpenError' });
  });

  it('defaults the lecturer queue to open disputes', async () => {
    await service().listLecturerDisputes('lecturer-id');
    expect(repository.listLecturerDisputes).toHaveBeenCalledWith({ lecturerUserId: 'lecturer-id', now, status: 'open' });
    await service().listLecturerDisputes('lecturer-id', { status: 'all', courseOfferingId: 'o' });
    expect(repository.listLecturerDisputes).toHaveBeenLastCalledWith({ lecturerUserId: 'lecturer-id', now, status: 'all', courseOfferingId: 'o' });
  });

  it('validates the decision note and maps resolution outcomes', async () => {
    await expect(service().resolveDispute('lecturer-id', disputeId, { decision: 'reject', note: '  nope  ' }))
      .rejects.toMatchObject({ statusCode: 400, exposeDetail: true });
    expect(repository.resolveDispute).not.toHaveBeenCalled();

    for (const [kind, statusCode, name] of [
      ['not_found', 404, 'DisputeNotFoundError'],
      ['not_open', 409, 'DisputeNotOpenError'],
      ['not_enrolled', 409, 'DisputeUpholdNotEnrolledError'],
    ] as const) {
      repository.resolveDispute.mockResolvedValueOnce({ kind });
      await expect(service().resolveDispute('lecturer-id', disputeId, { decision: 'uphold', note: 'Seen in class by me.' }))
        .rejects.toMatchObject({ statusCode, name });
    }

    const dispute = { id: disputeId } as LecturerDisputeRecord;
    repository.resolveDispute.mockResolvedValueOnce({ kind: 'resolved', dispute, correction: 'applied' });
    expect(await service().resolveDispute('lecturer-id', disputeId, { decision: 'uphold', note: '  Seen in class by me.  ' }))
      .toEqual({ dispute, correction: 'applied' });
    expect(repository.resolveDispute).toHaveBeenLastCalledWith({
      lecturerUserId: 'lecturer-id',
      disputeId,
      decision: 'uphold',
      note: 'Seen in class by me.',
      now,
    });
  });

  describe('dispute emails', () => {
    function notifyingService(notifier: { sendDisputeSubmittedNotice: ReturnType<typeof vi.fn>; sendDisputeResolvedNotice: ReturnType<typeof vi.fn> }, warn = vi.fn()) {
      return new AttendanceDisputeService({
        repository: repository as unknown as AttendanceDisputeRepository,
        now: () => now,
        notifier: notifier as unknown as DisputeNotifier,
        logger: { warn },
      });
    }

    it('emails lecturers who can see the dispute, once per session batch', async () => {
      const notifier = { sendDisputeSubmittedNotice: vi.fn(async () => undefined), sendDisputeResolvedNotice: vi.fn() };
      await notifyingService(notifier).submitDispute('student-id', { attendanceSessionId: sessionId, statement });
      expect(repository.getDisputeNoticeContext).toHaveBeenCalledWith(disputeId);
      expect(notifier.sendDisputeSubmittedNotice).toHaveBeenCalledTimes(1);
      expect(notifier.sendDisputeSubmittedNotice).toHaveBeenCalledWith({
        to: 'one@test.invalid',
        displayName: 'Dr One',
        courseCode: 'DEMO-101',
        sessionTitle: 'Week 1 Lecture',
        sessionStartsAt: baseFacts.session.startsAt,
        studentName: 'Ada Student',
        openDisputeCount: 3,
      });

      // A second open dispute on the same session does not send another email.
      repository.getDisputeNoticeContext.mockResolvedValueOnce({ ...noticeContext, openForSession: 2 });
      await notifyingService(notifier).submitDispute('student-id', { attendanceSessionId: sessionId, statement });
      expect(notifier.sendDisputeSubmittedNotice).toHaveBeenCalledTimes(1);
    });

    it('emails the student the decision and lecturer note', async () => {
      const notifier = { sendDisputeSubmittedNotice: vi.fn(), sendDisputeResolvedNotice: vi.fn(async () => undefined) };
      const dispute = { id: disputeId, resolvedByName: 'Dr One' } as LecturerDisputeRecord;
      repository.resolveDispute.mockResolvedValueOnce({ kind: 'resolved', dispute, correction: null });
      await notifyingService(notifier).resolveDispute('lecturer-id', disputeId, { decision: 'reject', note: 'You were not in the hall.' });
      expect(notifier.sendDisputeResolvedNotice).toHaveBeenCalledWith({
        to: 'student@test.invalid',
        displayName: 'Ada Student',
        courseCode: 'DEMO-101',
        sessionTitle: 'Week 1 Lecture',
        sessionStartsAt: baseFacts.session.startsAt,
        decision: 'rejected',
        note: 'You were not in the hall.',
        lecturerName: 'Dr One',
      });
    });

    it('never fails the action when email delivery fails', async () => {
      const warn = vi.fn();
      const notifier = {
        sendDisputeSubmittedNotice: vi.fn(async () => { throw new Error('provider down'); }),
        sendDisputeResolvedNotice: vi.fn(async () => { throw new Error('provider down'); }),
      };
      await expect(notifyingService(notifier, warn).submitDispute('student-id', { attendanceSessionId: sessionId, statement }))
        .resolves.toEqual({ ...studentDispute, appealDeadline: null });
      const dispute = { id: disputeId, resolvedByName: null } as LecturerDisputeRecord;
      repository.resolveDispute.mockResolvedValueOnce({ kind: 'resolved', dispute, correction: 'applied' });
      await expect(notifyingService(notifier, warn).resolveDispute('lecturer-id', disputeId, { decision: 'uphold', note: 'Seen in class by me.' }))
        .resolves.toEqual({ dispute, correction: 'applied' });
      expect(notifier.sendDisputeResolvedNotice).toHaveBeenCalledWith(expect.objectContaining({ lecturerName: 'Your lecturer', decision: 'upheld' }));
      expect(warn).toHaveBeenCalledTimes(2);
      for (const [details] of warn.mock.calls) expect(JSON.stringify(details)).not.toContain('test.invalid');

      repository.getDisputeNoticeContext.mockRejectedValueOnce(new Error('db down'));
      await expect(notifyingService(notifier, warn).submitDispute('student-id', { attendanceSessionId: sessionId, statement }))
        .resolves.toEqual({ ...studentDispute, appealDeadline: null });
    });

    it('sends nothing without a notifier', async () => {
      await service().submitDispute('student-id', { attendanceSessionId: sessionId, statement });
      expect(repository.getDisputeNoticeContext).not.toHaveBeenCalled();
    });
  });

  describe('appeals', () => {
    const administrator = {
      accountType: 'administrator' as const,
      id: 'admin-id',
      email: 'hod@test.invalid',
      displayName: 'Prof HOD',
      emailVerified: true as const,
      institutionName: 'Example University',
      institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
      role: 'faculty_administrator' as const,
      scope: { type: 'faculty' as const, id: 'faculty-id', label: 'Engineering', institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8' },
      sessionExpiresAt: now,
    };
    const rejectedAt = new Date(now.getTime() - 2 * 86_400_000);
    const appealFacts = {
      institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
      courseOfferingId: 'offering-id',
      attendanceSessionId: sessionId,
      departmentId: 'department-id',
      facts: { disputeStatus: 'rejected' as const, resolvedAt: rejectedAt, hasAppeal: false, enrollmentStatus: 'active' as const, recordStatus: null },
    };
    const appealed = {
      ...studentDispute,
      status: 'rejected' as const,
      resolvedAt: rejectedAt,
      appeal: {
        id: 'appeal-id', status: 'open' as const, statement, departmentName: 'Engineering', decisionNote: null, decidedByName: null, decidedAt: null, createdAt: now,
      },
      appealFacts: { ...appealFacts.facts, hasAppeal: true },
    };
    const appealNotice = {
      courseCode: 'DEMO-101',
      sessionTitle: 'Week 1 Lecture',
      sessionStartsAt: baseFacts.session.startsAt,
      departmentName: 'Engineering',
      student: { email: 'student@test.invalid', displayName: 'Ada Student' },
      lecturer: { email: 'one@test.invalid', displayName: 'Dr One' },
      administrators: [{ email: 'hod@test.invalid', displayName: 'Prof HOD' }, { email: 'dean@test.invalid', displayName: 'Dean' }],
      openForDepartment: 1,
    };

    it('shows the appeal deadline only while a rejected dispute can still go up', async () => {
      repository.listStudentDisputes.mockResolvedValueOnce([
        { ...studentDispute, status: 'rejected', resolvedAt: rejectedAt, appealFacts: appealFacts.facts },
        { ...studentDispute, id: 'other', status: 'rejected', resolvedAt: rejectedAt, appealFacts: { ...appealFacts.facts, enrollmentStatus: 'completed' } },
        appealed,
      ]);
      const { disputes } = await service().getStudentDisputes('student-id');
      expect(disputes.map((dispute) => dispute.appealDeadline?.toISOString() ?? null)).toEqual([
        new Date(rejectedAt.getTime() + 7 * 86_400_000).toISOString(),
        null,
        null,
      ]);
    });

    it('records an eligible appeal against the course department and tells its administrators once', async () => {
      repository.getAppealFacts.mockResolvedValue(appealFacts);
      repository.insertAppeal.mockResolvedValue({ kind: 'inserted', dispute: appealed });
      repository.getAppealNoticeContext.mockResolvedValue(appealNotice);
      const notifier = { sendDisputeSubmittedNotice: vi.fn(), sendDisputeResolvedNotice: vi.fn(), sendAppealSubmittedNotice: vi.fn(async () => undefined), sendAppealDecidedNotice: vi.fn() };
      const appealing = new AttendanceDisputeService({ repository: repository as unknown as AttendanceDisputeRepository, now: () => now, notifier });
      const result = await appealing.appealDispute('student-id', disputeId, { statement: `  ${statement}  ` });
      expect(result.appeal?.status).toBe('open');
      expect(result.appealDeadline).toBeNull();
      expect(repository.insertAppeal).toHaveBeenCalledWith(expect.objectContaining({ disputeId, departmentId: 'department-id', statement, now }));
      expect(notifier.sendAppealSubmittedNotice).toHaveBeenCalledTimes(2);

      repository.getAppealNoticeContext.mockResolvedValue({ ...appealNotice, openForDepartment: 2 });
      await appealing.appealDispute('student-id', disputeId, { statement });
      expect(notifier.sendAppealSubmittedNotice).toHaveBeenCalledTimes(2);
    });

    it('refuses appeals that are not allowed, with the reason', async () => {
      await expect(service().appealDispute('student-id', disputeId, { statement: 'short' })).rejects.toThrow(/20 to 1000/);
      repository.getAppealFacts.mockResolvedValueOnce(null);
      await expect(service().appealDispute('student-id', disputeId, { statement })).rejects.toMatchObject({ statusCode: 404 });
      repository.getAppealFacts.mockResolvedValueOnce({ ...appealFacts, facts: { ...appealFacts.facts, disputeStatus: 'upheld' } });
      await expect(service().appealDispute('student-id', disputeId, { statement })).rejects.toThrow(/turned down/);
      repository.getAppealFacts.mockResolvedValueOnce({ ...appealFacts, facts: { ...appealFacts.facts, resolvedAt: new Date(now.getTime() - 8 * 86_400_000) } });
      await expect(service().appealDispute('student-id', disputeId, { statement })).rejects.toThrow(/within 7 days/);
      repository.getAppealFacts.mockResolvedValueOnce(appealFacts);
      repository.insertAppeal.mockResolvedValueOnce({ kind: 'already_appealed' });
      await expect(service().appealDispute('student-id', disputeId, { statement })).rejects.toThrow(/can go up once/);
    });

    it('decides within the administrator’s area and tells the student and lecturer', async () => {
      const decidedAppeal = { ...appealed.appeal, status: 'upheld' as const, decisionNote: 'Seen in the hall by the HOD.', decidedByName: 'Prof HOD', decidedAt: now, conflict: false, dispute: {} as LecturerDisputeRecord };
      repository.decideAppeal.mockResolvedValueOnce({ kind: 'decided', appeal: decidedAppeal, correction: 'applied' });
      repository.getAppealNoticeContext.mockResolvedValue(appealNotice);
      const notifier = { sendDisputeSubmittedNotice: vi.fn(), sendDisputeResolvedNotice: vi.fn(), sendAppealSubmittedNotice: vi.fn(), sendAppealDecidedNotice: vi.fn(async () => undefined) };
      const deciding = new AttendanceDisputeService({ repository: repository as unknown as AttendanceDisputeRepository, now: () => now, notifier });
      const result = await deciding.decideAppeal(administrator, 'appeal-id', { decision: 'uphold', note: '  Seen in the hall by the HOD.  ' });
      expect(result.correction).toBe('applied');
      expect(repository.decideAppeal).toHaveBeenCalledWith({
        scope: { institutionId: administrator.institutionId, type: 'faculty', id: 'faculty-id', administratorUserId: 'admin-id' },
        appealId: 'appeal-id',
        decision: 'uphold',
        note: 'Seen in the hall by the HOD.',
        now,
      });
      expect(notifier.sendAppealDecidedNotice).toHaveBeenCalledTimes(2);
      expect(notifier.sendAppealDecidedNotice).toHaveBeenCalledWith(expect.objectContaining({ audience: 'student', decision: 'upheld', deciderName: 'Prof HOD' }));
      expect(notifier.sendAppealDecidedNotice).toHaveBeenCalledWith(expect.objectContaining({ audience: 'lecturer', to: 'one@test.invalid' }));
    });

    it('maps refused decisions to clear errors', async () => {
      const decide = () => service().decideAppeal(administrator, 'appeal-id', { decision: 'reject', note: 'Nothing places you there.' });
      repository.decideAppeal.mockResolvedValueOnce({ kind: 'conflict' });
      await expect(decide()).rejects.toThrow(/another administrator/);
      repository.decideAppeal.mockResolvedValueOnce({ kind: 'not_open' });
      await expect(decide()).rejects.toMatchObject({ statusCode: 409 });
      repository.decideAppeal.mockResolvedValueOnce({ kind: 'not_found' });
      await expect(decide()).rejects.toMatchObject({ statusCode: 404 });
      repository.decideAppeal.mockResolvedValueOnce({ kind: 'not_enrolled' });
      await expect(decide()).rejects.toThrow(/no longer actively enrolled/);
      await expect(service().decideAppeal(administrator, 'appeal-id', { decision: 'reject', note: 'short' })).rejects.toMatchObject({ statusCode: 400 });
    });
  });
});
