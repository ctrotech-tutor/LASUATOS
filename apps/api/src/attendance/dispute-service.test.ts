import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceDisputeRepository, LecturerDisputeRecord, StudentDisputeRecord } from './dispute-repository.js';
import type { DisputeFacts } from './dispute-policy.js';
import { AttendanceDisputeService } from './dispute-service.js';

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
  };
});

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
    expect(repository.listLecturerDisputes).toHaveBeenCalledWith({ lecturerUserId: 'lecturer-id', status: 'open' });
    await service().listLecturerDisputes('lecturer-id', { status: 'all', courseOfferingId: 'o' });
    expect(repository.listLecturerDisputes).toHaveBeenLastCalledWith({ lecturerUserId: 'lecturer-id', status: 'all', courseOfferingId: 'o' });
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
});
