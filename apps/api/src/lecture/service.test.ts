import { describe, expect, it } from 'vitest';
import { createLectureQrFrame, generateSessionSecret } from '@lasuatos/verification';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type {
  InsertLectureAttendanceInput,
  LectureAttendeeRecord,
  LectureRepository,
  LectureSessionRecord,
  LectureVenueRecord,
  StudentIdentityRecord,
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
  outline: null,
  allowanceMeters: 0,
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

const STUDENTS: Record<string, { fullName: string; matricNumber: string; email: string }> = {
  ada: { fullName: 'Ada Obi', matricNumber: '220591001', email: 'ada@example.net' },
  tunde: { fullName: 'Tunde Bello', matricNumber: '220591002', email: 'tunde@example.net' },
  bayo: { fullName: 'Bayo Ade', matricNumber: '220591003', email: 'bayo@example.net' },
};

function studentIdentity(userId: string): StudentIdentityRecord | null {
  const known = STUDENTS[userId];
  return known
    ? { userId, fullName: known.fullName, matricNumber: known.matricNumber, email: known.email, departmentId: null, departmentName: null, facultyId: null, facultyName: null, entryYear: 2022 }
    : null;
}

const studentAccount = (id: string) => ({ id, accountType: 'student' } as unknown as AuthenticatedAccount);
const ada = studentAccount('ada');
const tunde = studentAccount('tunde');
const bayo = studentAccount('bayo');

/** Password check for signing in on a borrowed phone: every test student's password is "right-password". */
const credentials = {
  verifyStudent: async (identifier: string, password: string) => {
    if (password !== 'right-password') return null;
    const key = identifier.trim().toLowerCase();
    return Object.entries(STUDENTS).find(([, student]) => student.email === key || student.matricNumber === key.toUpperCase())?.[0] ?? null;
  },
};

function harness(session: LectureSessionRecord, clock: { now: Date }) {
  const inserted: InsertLectureAttendanceInput[] = [];
  const records: LectureAttendeeRecord[] = [];
  const repository = {
    listActiveAttendanceByDevice: async (sessionId: string, device: string) =>
      records.filter((record) => sessionId === session.id && record.deviceHash === device && !record.removedAt),
    findSession: async (id: string) => (id === session.id ? session : null),
    findSessionByPublicCode: async (code: string) => (code === session.publicCode ? session : null),
    listOpenDynamicSessions: async () => [session],
    findActor: async (userId: string) => {
      const student = studentIdentity(userId);
      return student ? { userId, institutionId: session.institutionId, displayName: student.fullName, lecturerDepartmentId: null, lecturerFacultyId: null, student, classRep: null } : null;
    },
    findStudentByUserId: async (institutionId: string, userId: string) => (institutionId === session.institutionId ? studentIdentity(userId) : null),
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
        outsideMeters: input.outsideMeters ?? null,
        accuracyMeters: input.accuracyMeters,
        venueOutcome: input.venueOutcome,
        createdAt: input.now,
        removedAt: null,
        removedReason: null,
        addedByName: null,
      };
      records.push(record);
      return { kind: 'inserted' as const, record };
    },
  } as unknown as LectureRepository;
  return { service: new LectureService({ repository, now: () => clock.now, credentials }), inserted, records };
}

async function ticketFor(service: LectureService, session: LectureSessionRecord, now: Date): Promise<string> {
  const frame = createLectureQrFrame({ secret: session.secret, sessionId: session.id, now });
  return (await service.resolve(null, { challenge: frame.challenge })).ticket;
}

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
    await expect(service.checkIn(ada, { ticket })).resolves.toMatchObject({ status: 'checked_in' });
    expect(inserted).toHaveLength(1);
    clock.now = new Date(session.endsAt.getTime() + 11 * 60_000);
    await expect(service.checkIn(ada, { ticket })).rejects.toMatchObject({ statusCode: 410 });
  });

  it('stops check-in as soon as the session is closed by hand', async () => {
    const session = sessionRecord();
    const clock = { now: new Date(START.getTime() + 60_000) };
    const harnessed = harness(session, clock);
    const ticket = await ticketFor(harnessed.service, session, clock.now);
    const closed = { ...session, closedAt: new Date(START.getTime() + 90_000) };
    clock.now = new Date(START.getTime() + 120_000);
    const after = harness(closed, clock);
    await expect(after.service.checkIn(ada, { ticket })).rejects.toMatchObject({ statusCode: 410 });
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
    await expect(service.checkIn(ada, { ticket })).rejects.toMatchObject({ statusCode: 422 });
    await expect(service.checkIn(ada, { ticket, location: farAway })).rejects.toThrow(/km from Lecture hall 1/);
    await expect(service.checkIn(ada, { ticket, location: inside })).resolves.toMatchObject({ venueOutcome: 'within' });
  });

  it('records but does not block location when the venue is optional', async () => {
    const session = sessionRecord({ venue, requireVenue: false });
    const { service, inserted } = harness(session, { now });
    const ticket = await ticketFor(service, session, now);
    await expect(service.checkIn(ada, { ticket, location: farAway })).resolves.toMatchObject({ venueOutcome: 'outside' });
    await expect(service.checkIn(bayo, { ticket })).resolves.toMatchObject({ venueOutcome: 'unavailable' });
    expect(inserted.map((item) => item.venueOutcome)).toEqual(['outside', 'unavailable']);
  });

  describe('outline venues (the building traced corner by corner)', () => {
    // A 40 m × 24 m hall centred on the fixture venue, with a 10 m allowance.
    const north = (meters: number) => meters / 111_195;
    const east = (meters: number) => meters / (111_195 * Math.cos((6.5841 * Math.PI) / 180));
    const at = (x: number, y: number) => ({ latitude: 6.5841 + north(y), longitude: 3.9833 + east(x) });
    const hall: LectureVenueRecord = {
      ...venue,
      radiusMeters: 24,
      outline: [at(-20, -12), at(20, -12), at(20, 12), at(-20, 12)],
      allowanceMeters: 10,
    };
    const fix = (x: number, y: number, accuracyMeters: number | null, extra: Record<string, unknown> = {}) => ({
      ...at(x, y), accuracyMeters, capturedAt: now.toISOString(), ageMilliseconds: 1_500, sampleCount: 6, ...extra,
    });
    async function attempt(location: ReturnType<typeof fix>, requireVenue = true) {
      const session = sessionRecord({ venue: hall, requireVenue });
      const harnessed = harness(session, { now });
      const ticket = await ticketFor(harnessed.service, session, now);
      return { result: harnessed.service.checkIn(ada, { ticket, location }), inserted: harnessed.inserted };
    }

    it('accepts the back row of the hall and says how precise the fix was', async () => {
      const { result, inserted } = await attempt(fix(18, 11, 9));
      await expect(result).resolves.toMatchObject({ venueOutcome: 'within', locationAccuracyMeters: 9 });
      expect(inserted[0]).toMatchObject({ outsideMeters: 0, accuracyMeters: 9, locationSamples: 6, venueOutcome: 'within' });
      expect(inserted[0]!.distanceMeters).toBeCloseTo(Math.hypot(18, 11), 0);
    });

    it('accepts a reading that drifted a few metres past the wall (within the allowance)', async () => {
      const { result, inserted } = await attempt(fix(0, 19, 12));
      await expect(result).resolves.toMatchObject({ venueOutcome: 'within' });
      expect(inserted[0]!.outsideMeters).toBeCloseTo(7, 0);
    });

    it('refuses a student standing 30 m outside, even with a ±25 m reading', async () => {
      const { result, inserted } = await attempt(fix(0, 42, 25));
      await expect(result).rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/about 30 m outside Lecture hall 1 \(accuracy ±25 m\)/) });
      expect(inserted).toHaveLength(0);
    });

    it('asks for Precise Location when the phone blurs its position', async () => {
      const { result } = await attempt(fix(0, 0, 4_800));
      await expect(result).rejects.toThrow(/Precise Location/);
    });

    it('refuses a coarse reading and offers the manual fallback', async () => {
      const { result } = await attempt(fix(0, 0, 150));
      await expect(result).rejects.toThrow(/could not pin down your position.*ask Dr\. Adeyemi to add you/);
    });

    it('refuses a reading taken minutes ago (the cached-position problem)', async () => {
      const { result } = await attempt(fix(0, 0, 8, { ageMilliseconds: 180_000 }));
      await expect(result).rejects.toThrow(/old location reading/);
    });

    it('trusts the phone-measured age over a phone clock that is wrong', async () => {
      const wrongClock = new Date(now.getTime() - 3 * 60 * 60_000).toISOString();
      const { result } = await attempt(fix(0, 0, 8, { capturedAt: wrongClock, ageMilliseconds: 2_000 }));
      await expect(result).resolves.toMatchObject({ venueOutcome: 'within' });
    });

    it('records but never blocks when location is optional', async () => {
      const outside = await attempt(fix(0, 42, 25), false);
      await expect(outside.result).resolves.toMatchObject({ venueOutcome: 'outside' });
      const coarse = await attempt(fix(0, 0, 150), false);
      await expect(coarse.result).resolves.toMatchObject({ venueOutcome: 'inconclusive' });
      expect(outside.inserted[0]!.outsideMeters).toBeCloseTo(30, 0);
    });

    it('shows students the outline and allowance so the page can tell them live', async () => {
      const session = sessionRecord({ venue: hall, requireVenue: true });
      const harnessed = harness(session, { now });
      const frame = createLectureQrFrame({ secret: session.secret, sessionId: session.id, now });
      const resolved = await harnessed.service.resolve(null, { challenge: frame.challenge });
      expect(resolved.session.venueGuide).toMatchObject({ outline: hall.outline, allowanceMeters: 10, radiusMeters: 24 });
    });
  });

});

describe('students mark only themselves', () => {
  const now = new Date(START.getTime() + 60_000);

  it('asks someone who is not signed in to sign in, and never takes a typed name', async () => {
    const session = sessionRecord();
    const { service, inserted } = harness(session, { now });
    const ticket = await ticketFor(service, session, now);
    await expect(service.checkIn(null, { ticket })).rejects.toMatchObject({ statusCode: 401, message: expect.stringMatching(/Sign in with your student account/) });
    const typed = { ticket, fullName: 'Ada Obi', matricNumber: '220591001' } as unknown as Parameters<LectureService['checkIn']>[1];
    await expect(service.checkIn(null, typed)).rejects.toMatchObject({ statusCode: 401 });
    expect(inserted).toHaveLength(0);
  });

  it('marks the signed-in student with the name and matric number on their account', async () => {
    const session = sessionRecord();
    const { service, inserted } = harness(session, { now });
    await expect(service.checkIn(ada, { ticket: await ticketFor(service, session, now) }))
      .resolves.toMatchObject({ status: 'checked_in', fullName: 'Ada Obi', matricNumber: '220591001' });
    expect(inserted[0]).toMatchObject({ studentUserId: 'ada', fullName: 'Ada Obi', matricNumber: '220591001' });
  });

  it('turns a staff account away: it cannot be marked present', async () => {
    const session = sessionRecord();
    const { service } = harness(session, { now });
    const lecturer = { id: 'lecturer', accountType: 'lecturer' } as unknown as AuthenticatedAccount;
    await expect(service.checkIn(lecturer, { ticket: await ticketFor(service, session, now) })).rejects.toMatchObject({ statusCode: 403 });
  });

  it('lets a student sign in on a classmate’s phone for this check-in only, by email or matric number', async () => {
    const session = sessionRecord();
    const { service, inserted } = harness(session, { now });
    // Tunde's phone is signed in as Tunde; Ada signs in on it with her matric number.
    const ticket = await ticketFor(service, session, now);
    await expect(service.checkIn(tunde, { ticket, signIn: { identifier: '220591001', password: 'right-password' }, deviceToken: 'tunde-phone-token' }))
      .resolves.toMatchObject({ fullName: 'Ada Obi', matricNumber: '220591001' });
    await expect(service.checkIn(null, { ticket, signIn: { identifier: 'BAYO@example.net', password: 'right-password' } }))
      .resolves.toMatchObject({ fullName: 'Bayo Ade' });
    expect(inserted.map((entry) => entry.studentUserId)).toEqual(['ada', 'bayo']);
  });

  it('refuses a wrong password without saying which part was wrong', async () => {
    const session = sessionRecord();
    const { service, inserted } = harness(session, { now });
    const ticket = await ticketFor(service, session, now);
    await expect(service.checkIn(tunde, { ticket, signIn: { identifier: '220591001', password: 'guess' } }))
      .rejects.toMatchObject({ statusCode: 401, message: expect.stringMatching(/do not match a student account/) });
    expect(inserted).toHaveLength(0);
  });
});

describe('a phone marks its owner and one classmate', () => {
  const borrow = (userId: string) => ({ identifier: STUDENTS[userId]!.matricNumber, password: 'right-password' });

  it('lets one classmate use the phone, and refuses a third student', async () => {
    const session = sessionRecord();
    const clock = { now: new Date(START.getTime() + 60_000) };
    const { service, inserted } = harness(session, clock);
    await service.checkIn(ada, { ticket: await ticketFor(service, session, clock.now), deviceToken: 'phone-a-token-0001' });
    await expect(service.checkIn(ada, { ticket: await ticketFor(service, session, clock.now), signIn: borrow('tunde'), deviceToken: 'phone-a-token-0001' }))
      .resolves.toMatchObject({ status: 'checked_in', fullName: 'Tunde Bello' });
    await expect(service.checkIn(ada, { ticket: await ticketFor(service, session, clock.now), signIn: borrow('bayo'), deviceToken: 'phone-a-token-0001' }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringContaining('A phone can mark its owner and one classmate') });
    expect(inserted.map((entry) => entry.matricNumber)).toEqual(['220591001', '220591002']);
  });

  it('lets the same students try again, and other phones check in freely', async () => {
    const session = sessionRecord();
    const clock = { now: new Date(START.getTime() + 60_000) };
    const { service, inserted } = harness(session, clock);
    await service.checkIn(ada, { ticket: await ticketFor(service, session, clock.now), deviceToken: 'phone-a-token-0001' });
    await service.checkIn(ada, { ticket: await ticketFor(service, session, clock.now), signIn: borrow('tunde'), deviceToken: 'phone-a-token-0001' });
    await service.checkIn(ada, { ticket: await ticketFor(service, session, clock.now), deviceToken: 'phone-a-token-0001' });
    await service.checkIn(ada, { ticket: await ticketFor(service, session, clock.now), signIn: borrow('tunde'), deviceToken: 'phone-a-token-0001' });
    await service.checkIn(bayo, { ticket: await ticketFor(service, session, clock.now), deviceToken: 'phone-b-token-0001' });
    expect(inserted).toHaveLength(5);
  });

  it('frees the phone when the person taking attendance removes an earlier entry', async () => {
    const session = sessionRecord();
    const clock = { now: new Date(START.getTime() + 60_000) };
    const { service, records } = harness(session, clock);
    await service.checkIn(ada, { ticket: await ticketFor(service, session, clock.now), deviceToken: 'phone-a-token-0001' });
    await service.checkIn(ada, { ticket: await ticketFor(service, session, clock.now), signIn: borrow('tunde'), deviceToken: 'phone-a-token-0001' });
    records[1] = { ...records[1]!, removedAt: clock.now };
    await expect(service.checkIn(ada, { ticket: await ticketFor(service, session, clock.now), signIn: borrow('bayo'), deviceToken: 'phone-a-token-0001' }))
      .resolves.toMatchObject({ status: 'checked_in' });
  });
});

describe('who can take attendance', () => {
  it('turns students without an appointment away with a clear reason', async () => {
    const repository = {
      findActor: async () => ({
        userId: 'student', institutionId: 'inst', displayName: 'Ada', lecturerDepartmentId: null, lecturerFacultyId: null, student: null, classRep: null,
      }),
      usesEnrolledCourses: async () => false,
    } as unknown as LectureRepository;
    const service = new LectureService({ repository });
    const student = { accountType: 'student', id: 'student' } as unknown as AuthenticatedAccount;
    await expect(service.createSession(student, { courseCode: 'CSC 201', courseTitle: 'Data Structures', lecturerName: undefined, durationMinutes: 60, qrMode: 'static' }))
      .rejects.toThrow(/class representatives/);
    await expect(service.capabilities(student)).resolves.toMatchObject({ canTakeAttendance: false });
  });
});

describe('course register', () => {
  const lecturer = { id: 'lecturer', accountType: 'lecturer', institutionId: 'inst' } as unknown as AuthenticatedAccount;
  const student = { id: 'student', accountType: 'student', institutionId: 'inst' } as unknown as AuthenticatedAccount;
  const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];
  const sessions = ids.map((id, day) => sessionRecord({ id, startsAt: new Date(START.getTime() + day * 86_400_000) }));
  const attendee = (sessionIndex: number, matricNumber: string, fullName: string, extra: Partial<LectureAttendeeRecord> = {}) => ({
    id: `${sessionIndex}-${matricNumber}`,
    lectureSessionId: ids[sessionIndex]!,
    studentUserId: null,
    fullName,
    matricNumber,
    method: 'qr' as const,
    deviceHash: null,
    distanceMeters: null,
    venueOutcome: null,
    createdAt: new Date(START.getTime() + sessionIndex * 86_400_000 + 60_000),
    removedAt: null,
    removedReason: null,
    ...extra,
  });

  function registerService(semesters: { id: string; label: string; startsAt: Date; endsAt: Date }[] = []) {
    const repository = {
      listSemesters: async () => semesters,
      findActor: async (userId: string) => ({ userId, institutionId: 'inst', displayName: 'Someone', lecturerDepartmentId: null, lecturerFacultyId: null, classRep: null, student: null }),
      listCourseSessions: async (_user: string, _visibility: unknown, courseCode: string) => (courseCode === 'CSC 201' ? sessions : []),
      // The repository already leaves removed entries out.
      listAttendeesForSessions: async () => [
        attendee(0, '220591001', 'Ada Obi'),
        attendee(1, '220591001', 'Ada Obi'),
        attendee(2, '220591001', 'Ada N. Obi', { studentUserId: 'ada' }),
        attendee(3, '220591001', 'Ada N. Obi', { studentUserId: 'ada' }),
        attendee(0, '220591002', 'Bola Ade'),
        attendee(1, '220591002', 'Bola Ade'),
      ],
      listRegisterCourses: async () => [{ courseCode: 'CSC 201', courseTitle: 'Data Structures', sessionCount: 4, lastHeldAt: sessions[3]!.startsAt }],
    } as unknown as LectureRepository;
    return new LectureService({ repository, now: () => new Date(START.getTime() + 10 * 86_400_000) });
  }

  it('counts each student once per session, matched by matric number', async () => {
    const register = await registerService().register(lecturer, 'CSC 201');
    expect(register.sessions.map((session) => session.presentCount)).toEqual([2, 2, 1, 1]);
    expect(register.students).toHaveLength(2);
    const [ada, bola] = register.students;
    expect(ada).toMatchObject({ matricNumber: '220591001', fullName: 'Ada N. Obi', hasAccount: true, attended: 4, rate: 100, present: [true, true, true, true] });
    expect(bola).toMatchObject({ matricNumber: '220591002', attended: 2, rate: 50, present: [true, true, false, false] });
  });

  it('lists courses and refuses people who cannot take attendance', async () => {
    await expect(registerService().registerCourses(lecturer)).resolves.toMatchObject({ courses: [{ courseCode: 'CSC 201', sessionCount: 4 }] });
    await expect(registerService().register(student, 'CSC 201')).rejects.toMatchObject({ statusCode: 403 });
    await expect(registerService().register(lecturer, 'EEE 101')).rejects.toMatchObject({ statusCode: 404 });
  });

  describe('across semesters', () => {
    const day = 86_400_000;
    const first = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: '2025/2026 · First Semester', startsAt: new Date(START.getTime() - day), endsAt: new Date(START.getTime() + 2 * day - 1) };
    const second = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', label: '2025/2026 · Second Semester', startsAt: new Date(START.getTime() + 2 * day), endsAt: new Date(START.getTime() + 60 * day) };
    // Semesters come newest first from the repository.
    const semesters = [second, first];

    it('counts only the latest semester by default, so last year does not lower this year', async () => {
      const register = await registerService(semesters).register(lecturer, 'CSC 201');
      expect(register.term).toMatchObject({ id: second.id, sessionCount: 2 });
      expect(register.terms.map((term) => term.id)).toEqual([second.id, first.id, 'all']);
      expect(register.sessions.map((session) => session.id)).toEqual([ids[2], ids[3]]);
      // Bola only attended in the first semester, so is not on this register.
      expect(register.students).toEqual([expect.objectContaining({ matricNumber: '220591001', attended: 2, rate: 100 })]);
    });

    it('opens an earlier semester, every session, or refuses an unknown one', async () => {
      const earlier = await registerService(semesters).register(lecturer, 'CSC 201', first.id);
      expect(earlier.sessions).toHaveLength(2);
      expect(earlier.students.map((row) => row.rate)).toEqual([100, 100]);
      const everything = await registerService(semesters).register(lecturer, 'CSC 201', 'all');
      expect(everything.term).toMatchObject({ id: 'all', sessionCount: 4 });
      expect(everything.students.find((row) => row.matricNumber === '220591002')).toMatchObject({ rate: 50 });
      await expect(registerService(semesters).register(lecturer, 'CSC 201', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).rejects.toMatchObject({ statusCode: 404 });
    });

    it('keeps sessions outside every semester in their own group', async () => {
      const register = await registerService([second]).register(lecturer, 'CSC 201', 'other');
      expect(register.term).toMatchObject({ id: 'other', label: 'Outside the semester dates', sessionCount: 2 });
      expect(register.terms.map((term) => term.id)).toEqual([second.id, 'other', 'all']);
    });

    it('counts everything when no semester dates are set', async () => {
      const register = await registerService().register(lecturer, 'CSC 201');
      expect(register.term).toBeNull();
      expect(register.terms).toEqual([]);
      expect(register.sessions).toHaveLength(4);
    });
  });
});
