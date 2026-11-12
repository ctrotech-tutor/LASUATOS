import { describe, expect, it } from 'vitest';
import { createLectureQrFrame, generateSessionSecret } from '@lasuatos/verification';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type {
  InsertLectureAttendanceInput,
  LectureAttendeeRecord,
  LectureRepository,
  LectureSessionRecord,
  LectureVenueRecord,
} from './repository.js';
import { LectureService } from './service.js';

const SESSION_ID = '0f6d3a52-6c1b-4f0e-9a51-2a9a3f1c7d10';
const START = new Date('2026-11-12T09:00:00.000Z');

const venue: LectureVenueRecord = {
  id: '1a6d3a52-6c1b-4f0e-9a51-2a9a3f1c7d10',
  code: 'LT-01',
  name: 'Lecture hall 1',
  campusName: 'Epe Campus',
  buildingName: null,
  floorLabel: null,
  sectionLabel: null,
  latitude: 6.5841,
  longitude: 3.9833,
  radiusMeters: 40,
  active: true,
};

function sessionRecord(overrides: Partial<LectureSessionRecord> = {}): LectureSessionRecord {
  return {
    id: SESSION_ID,
    institutionId: 'inst',
    createdByUserId: 'lecturer',
    creatorName: 'Dr. Adeyemi',
    creatorRole: 'lecturer',
    courseCode: 'CSC 201',
    courseTitle: 'Data Structures',
    lecturerName: 'Dr. Adeyemi',
    facultyId: null,
    departmentId: null,
    entryYear: null,
    venue: null,
    requireVenue: false,
    qrMode: 'dynamic',
    secret: generateSessionSecret(),
    publicCode: 'K7M29QXD',
    startsAt: START,
    endsAt: new Date(START.getTime() + 60 * 60_000),
    closedAt: null,
    presentCount: 0,
    ...overrides,
  };
}

function harness(session: LectureSessionRecord, clock: { now: Date }) {
  const inserted: InsertLectureAttendanceInput[] = [];
  const repository = {
    findSession: async (id: string) => (id === session.id ? session : null),
    findSessionByPublicCode: async (code: string) => (code === session.publicCode ? session : null),
    listOpenDynamicSessions: async () => [session],
    findActor: async () => null,
    findAttendanceByStudent: async () => null,
    insertAttendance: async (input: InsertLectureAttendanceInput) => {
      inserted.push(input);
      const record: LectureAttendeeRecord = {
        id: 'att',
        studentUserId: input.studentUserId,
        fullName: input.fullName,
        matricNumber: input.matricNumber,
        method: input.method,
        deviceHash: input.deviceHash,
        distanceMeters: input.distanceMeters,
        venueOutcome: input.venueOutcome,
        createdAt: input.now,
        removedAt: null,
        removedReason: null,
      };
      return { kind: 'inserted' as const, record };
    },
  } as unknown as LectureRepository;
  return { service: new LectureService({ repository, now: () => clock.now }), inserted };
}

async function ticketFor(service: LectureService, session: LectureSessionRecord, now: Date): Promise<string> {
  const frame = createLectureQrFrame({ secret: session.secret, sessionId: session.id, now });
  return (await service.resolve(null, { challenge: frame.challenge })).ticket;
}

const guest = { fullName: 'Ada Obi', matricNumber: '220591001' };

describe('lecture check-in timing', () => {
  it('refuses codes before the session starts and after it ends', async () => {
    const session = sessionRecord({ qrMode: 'static' });
    const clock = { now: new Date(START.getTime() - 60_000) };
    const { service } = harness(session, clock);
    await expect(service.resolve(null, { code: 'K7M29QXD' })).rejects.toMatchObject({ statusCode: 409 });
    clock.now = new Date(session.endsAt.getTime() + 1);
    await expect(service.resolve(null, { code: 'K7M29QXD' })).rejects.toMatchObject({ statusCode: 410 });
  });

  it('lets a student who scanned before the end finish typing after it', async () => {
    const session = sessionRecord();
    const clock = { now: new Date(session.endsAt.getTime() - 30_000) };
    const { service, inserted } = harness(session, clock);
    const ticket = await ticketFor(service, session, clock.now);
    clock.now = new Date(session.endsAt.getTime() + 3 * 60_000);
    await expect(service.checkIn(null, { ticket, ...guest })).resolves.toMatchObject({ status: 'checked_in' });
    expect(inserted).toHaveLength(1);
    clock.now = new Date(session.endsAt.getTime() + 11 * 60_000);
    await expect(service.checkIn(null, { ticket, ...guest })).rejects.toMatchObject({ statusCode: 410 });
  });

  it('stops check-in as soon as the session is closed by hand', async () => {
    const session = sessionRecord();
    const clock = { now: new Date(START.getTime() + 60_000) };
    const harnessed = harness(session, clock);
    const ticket = await ticketFor(harnessed.service, session, clock.now);
    const closed = { ...session, closedAt: new Date(START.getTime() + 90_000) };
    clock.now = new Date(START.getTime() + 120_000);
    const after = harness(closed, clock);
    await expect(after.service.checkIn(null, { ticket, ...guest })).rejects.toMatchObject({ statusCode: 410 });
  });

  it('only accepts the fixed code when the session uses a printed QR', async () => {
    const session = sessionRecord({ qrMode: 'dynamic' });
    const { service } = harness(session, { now: new Date(START.getTime() + 60_000) });
    await expect(service.resolve(null, { code: 'K7M2-9QXD' })).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('lecture check-in venue rules', () => {
  const now = new Date(START.getTime() + 5 * 60_000);
  const inside = { latitude: 6.5841, longitude: 3.9834, accuracyMeters: 10, capturedAt: now.toISOString() };
  const farAway = { latitude: 6.6, longitude: 3.99, accuracyMeters: 10, capturedAt: now.toISOString() };

  it('requires location when the venue must be checked', async () => {
    const session = sessionRecord({ venue, requireVenue: true });
    const { service } = harness(session, { now });
    const ticket = await ticketFor(service, session, now);
    await expect(service.checkIn(null, { ticket, ...guest })).rejects.toMatchObject({ statusCode: 422 });
    await expect(service.checkIn(null, { ticket, ...guest, location: farAway })).rejects.toThrow(/outside Lecture hall 1/);
    await expect(service.checkIn(null, { ticket, ...guest, location: inside })).resolves.toMatchObject({ venueOutcome: 'within' });
  });

  it('records but does not block location when the venue is optional', async () => {
    const session = sessionRecord({ venue, requireVenue: false });
    const { service, inserted } = harness(session, { now });
    const ticket = await ticketFor(service, session, now);
    await expect(service.checkIn(null, { ticket, ...guest, location: farAway })).resolves.toMatchObject({ venueOutcome: 'outside' });
    await expect(service.checkIn(null, { ticket, fullName: 'Bayo Ade', matricNumber: '220591002' })).resolves.toMatchObject({ venueOutcome: 'unavailable' });
    expect(inserted.map((item) => item.venueOutcome)).toEqual(['outside', 'unavailable']);
  });

  it('asks guests for a matric number that looks real', async () => {
    const session = sessionRecord();
    const { service } = harness(session, { now });
    const ticket = await ticketFor(service, session, now);
    await expect(service.checkIn(null, { ticket, fullName: 'Ada Obi', matricNumber: 'ABCDE' })).rejects.toMatchObject({ statusCode: 422 });
  });
});

describe('who can take attendance', () => {
  it('turns students without an appointment away with a clear reason', async () => {
    const repository = {
      findActor: async () => ({
        userId: 'student', institutionId: 'inst', displayName: 'Ada', lecturerDepartmentId: null, lecturerFacultyId: null, student: null, classRep: null,
      }),
    } as unknown as LectureRepository;
    const service = new LectureService({ repository });
    const student = { accountType: 'student', id: 'student' } as unknown as AuthenticatedAccount;
    await expect(service.createSession(student, { courseCode: 'CSC 201', courseTitle: 'Data Structures', lecturerName: undefined, durationMinutes: 60, qrMode: 'static' }))
      .rejects.toThrow(/class representatives/);
    await expect(service.capabilities(student)).resolves.toMatchObject({ canTakeAttendance: false });
  });
});
