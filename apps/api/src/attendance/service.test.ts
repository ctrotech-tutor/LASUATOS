import { hashOpaqueToken } from '@lasuatos/auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceRepository, AttendanceSessionRecord } from './repository.js';
import {
  AttendanceNotEnrolledError,
  AttendanceSemesterUnavailableError,
  AttendanceSessionClosedError,
  AttendanceSessionDurationError,
  AttendanceSessionUnavailableError,
  InvalidAttendanceCodeError,
  AttendanceService,
} from './service.js';

const now = new Date('2026-11-10T12:00:00.000Z');
const session: AttendanceSessionRecord = {
  id: '7a5d513c-5e22-4d0e-a8ce-98d8b029865b',
  courseOfferingId: 'b3aa9508-2ead-444c-8b8f-3051fe8d14df',
  courseCode: 'DEMO-101',
  courseTitle: 'Demonstration course',
  title: 'Week 4 lecture',
  status: 'open',
  startsAt: now,
  endsAt: new Date(now.getTime() + 60 * 60_000),
  closedAt: null,
  attendanceCount: 0,
};

const repositoryMock = vi.hoisted(() => ({
  createSession: vi.fn(),
  listLecturerSessions: vi.fn(),
  getLecturerSession: vi.fn(),
  closeSession: vi.fn(),
  rotateSessionCode: vi.fn(),
  checkIn: vi.fn(),
  listStudentHistory: vi.fn(),
  listStudentOpenSessions: vi.fn(),
}));

function makeRepository(overrides: Partial<AttendanceRepository> = {}): AttendanceRepository {
  return {
    createSession: repositoryMock.createSession,
    listLecturerSessions: repositoryMock.listLecturerSessions,
    getLecturerSession: repositoryMock.getLecturerSession,
    closeSession: repositoryMock.closeSession,
    rotateSessionCode: repositoryMock.rotateSessionCode,
    checkIn: repositoryMock.checkIn,
    listStudentHistory: repositoryMock.listStudentHistory,
    listStudentOpenSessions: repositoryMock.listStudentOpenSessions,
    ...overrides,
  } as AttendanceRepository;
}

function service(repository = makeRepository()) {
  return new AttendanceService({ repository, now: () => now });
}

afterEach(() => vi.clearAllMocks());

describe('attendance service', () => {
  it('creates a random session code and passes only its hash to the repository', async () => {
    repositoryMock.createSession.mockImplementation(async (input: Parameters<AttendanceRepository['createSession']>[0]) => ({
      kind: 'created',
      session: { ...session, endsAt: input.endsAt },
    }));
    const result = await service().createSession('lecturer-id', {
      courseOfferingId: session.courseOfferingId,
      title: '  Week 4 lecture  ',
      durationMinutes: 60,
    });

    expect(result.code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
    expect(repositoryMock.createSession).toHaveBeenCalledWith(expect.objectContaining({
      lecturerUserId: 'lecturer-id',
      title: 'Week 4 lecture',
      codeHash: hashOpaqueToken(result.code),
      startsAt: now,
      endsAt: new Date(now.getTime() + 60 * 60_000),
    }));
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

  it('keeps lecturer and semester scope failures distinct', async () => {
    repositoryMock.createSession.mockResolvedValueOnce({ kind: 'not_assigned' });
    await expect(service().createSession('lecturer-id', {
      courseOfferingId: session.courseOfferingId, title: 'Lecture', durationMinutes: 30,
    })).rejects.toBeInstanceOf(AttendanceSessionUnavailableError);

    repositoryMock.createSession.mockResolvedValueOnce({ kind: 'semester_unavailable' });
    await expect(service().createSession('lecturer-id', {
      courseOfferingId: session.courseOfferingId, title: 'Lecture', durationMinutes: 30,
    })).rejects.toBeInstanceOf(AttendanceSemesterUnavailableError);
  });

  it('normalizes and hashes student input and returns idempotent check-in results', async () => {
    repositoryMock.checkIn.mockResolvedValue({
      kind: 'already_checked_in',
      attendance: {
        attendanceSessionId: session.id,
        courseCode: session.courseCode,
        courseTitle: session.courseTitle,
        sessionTitle: session.title,
        checkedInAt: now,
      },
    });
    const result = await service().checkIn('student-id', ' abcd-efgh-jk23 ');
    expect(repositoryMock.checkIn).toHaveBeenCalledWith({
      studentUserId: 'student-id',
      codeHash: hashOpaqueToken('ABCDEFGHJK23'),
      now,
    });
    expect(result.kind).toBe('already_checked_in');
    expect(result.attendance.attendanceSessionId).toBe(session.id);
  });

  it('does not query the repository for malformed or invalid codes', async () => {
    await expect(service().checkIn('student-id', 'not a session code'))
      .rejects.toBeInstanceOf(InvalidAttendanceCodeError);
    expect(repositoryMock.checkIn).not.toHaveBeenCalled();
  });

  it('returns clear state errors for closed sessions and non-enrolled students', async () => {
    repositoryMock.checkIn.mockResolvedValueOnce({ kind: 'session_closed' });
    await expect(service().checkIn('student-id', 'ABCDEFGHJK23'))
      .rejects.toBeInstanceOf(AttendanceSessionClosedError);
    repositoryMock.checkIn.mockResolvedValueOnce({ kind: 'not_enrolled' });
    await expect(service().checkIn('student-id', 'ABCDEFGHJK23'))
      .rejects.toBeInstanceOf(AttendanceNotEnrolledError);
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
      endsAt: session.endsAt,
    };
    repositoryMock.listStudentOpenSessions.mockResolvedValue([open]);
    await expect(service().listStudentOpenSessions('student-id')).resolves.toEqual([open]);
    expect(repositoryMock.listStudentOpenSessions).toHaveBeenCalledWith({ studentUserId: 'student-id', now });
  });
});
