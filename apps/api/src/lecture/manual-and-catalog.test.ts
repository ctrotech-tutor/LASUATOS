import { describe, expect, it } from 'vitest';
import { generateSessionSecret } from '@lasuatos/verification';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type {
  InsertLectureAttendanceInput,
  InstitutionCourseRecord,
  LectureAttendeeRecord,
  LectureRepository,
  LectureSessionRecord,
} from './repository.js';
import { LectureService, MAX_REP_ADDS_PER_SESSION } from './service.js';

const START = new Date('2026-11-12T09:00:00.000Z');
const DURING = new Date(START.getTime() + 20 * 60_000);
const AFTER = new Date(START.getTime() + 2 * 60 * 60_000);

const hall = {
  id: '1a6d3a52-6c1b-4f0e-9a51-2a9a3f1c7d10',
  code: 'LT-01',
  name: 'Lecture hall 1',
  campusName: 'Epe Campus',
  buildingName: null,
  floorLabel: null,
  sectionLabel: null,
  latitude: 6.5841,
  longitude: 3.9833,
  radiusMeters: 30,
  outline: null,
  allowanceMeters: 0,
  active: true,
};

function sessionRecord(overrides: Partial<LectureSessionRecord> = {}): LectureSessionRecord {
  return {
    id: '0f6d3a52-6c1b-4f0e-9a51-2a9a3f1c7d10',
    institutionId: 'inst',
    createdByUserId: 'rep',
    creatorName: 'Kemi (HOC)',
    creatorRole: 'hoc',
    courseCode: 'GET 201',
    courseTitle: 'Applied Electricity I',
    lecturerName: 'Dr. Adeyemi',
    facultyId: 'fac',
    departmentId: 'dep',
    entryYear: 2023,
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

const rep = { id: 'rep', accountType: 'student' } as unknown as AuthenticatedAccount;
const lecturer = { id: 'lecturer', accountType: 'lecturer', institutionId: 'inst' } as unknown as AuthenticatedAccount;
const otherLecturer = { id: 'other-lecturer', accountType: 'lecturer', institutionId: 'inst' } as unknown as AuthenticatedAccount;
const admin = {
  id: 'admin', accountType: 'administrator', institutionId: 'inst', role: 'institution_administrator',
  scope: { type: 'institution', id: 'inst', label: 'LASU' },
} as unknown as AuthenticatedAccount;

const actors: Record<string, unknown> = {
  rep: {
    userId: 'rep', institutionId: 'inst', displayName: 'Kemi Bello', lecturerDepartmentId: null, lecturerFacultyId: null, student: null,
    classRep: { id: 'cr', role: 'hoc', studentUserId: 'rep', facultyId: 'fac', facultyName: 'Engineering', departmentId: 'dep', departmentName: 'ECE', entryYear: 2023 },
  },
  lecturer: { userId: 'lecturer', institutionId: 'inst', displayName: 'Dr. Adeyemi', lecturerDepartmentId: 'dep', lecturerFacultyId: 'fac', student: null, classRep: null },
  'other-lecturer': { userId: 'other-lecturer', institutionId: 'inst', displayName: 'Dr. Okon', lecturerDepartmentId: 'dep', lecturerFacultyId: 'fac', student: null, classRep: null },
  admin: { userId: 'admin', institutionId: 'inst', displayName: 'O.A Abraham', lecturerDepartmentId: null, lecturerFacultyId: null, student: null, classRep: null },
};

function manualHarness(session: LectureSessionRecord, now: Date) {
  const records: LectureAttendeeRecord[] = [];
  const repository = {
    findSession: async (id: string) => (id === session.id ? session : null),
    findActor: async (userId: string) => actors[userId] ?? null,
    listAttendees: async () => records,
    findStudentForAppointment: async () => null,
    insertAttendance: async (input: InsertLectureAttendanceInput) => {
      const existing = records.find((record) => record.matricNumber === input.matricNumber);
      if (existing) return { kind: 'duplicate' as const, record: existing };
      const record: LectureAttendeeRecord = {
        id: `a-${records.length + 1}`,
        lectureSessionId: input.lectureSessionId,
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
        addedByUserId: input.addedByUserId ?? null,
        addedByName: null,
      } as unknown as LectureAttendeeRecord;
      records.push(record);
      return { kind: 'inserted' as const, record };
    },
  } as unknown as LectureRepository;
  return { service: new LectureService({ repository, now: () => now }), records };
}

const student = (n: number) => ({ fullName: `Student Number${n}`, matricNumber: `2305910${String(n).padStart(2, '0')}` });

describe('adding a student by hand (the class rep problem)', () => {
  it('lets a class rep add a classmate while attendance is open', async () => {
    const { service, records } = manualHarness(sessionRecord(), DURING);
    await expect(service.addAttendee(rep, sessionRecord().id, student(1))).resolves.toMatchObject({ status: 'added' });
    expect(records[0]).toMatchObject({ method: 'manual', addedByUserId: 'rep' });
  });

  it('stops class reps once attendance has closed, so absent students cannot be added after class', async () => {
    const ended = manualHarness(sessionRecord(), AFTER);
    await expect(ended.service.addAttendee(rep, sessionRecord().id, student(1)))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/class reps can no longer add students/) });
    const closedEarly = sessionRecord({ closedAt: new Date(START.getTime() + 10 * 60_000) });
    await expect(manualHarness(closedEarly, DURING).service.addAttendee(rep, closedEarly.id, student(2)))
      .rejects.toMatchObject({ statusCode: 409 });
    expect(ended.records).toHaveLength(0);
  });

  it(`caps a class rep at ${MAX_REP_ADDS_PER_SESSION} hand-added students per class`, async () => {
    const { service, records } = manualHarness(sessionRecord(), DURING);
    for (let n = 1; n <= MAX_REP_ADDS_PER_SESSION; n += 1) await service.addAttendee(rep, sessionRecord().id, student(n));
    await expect(service.addAttendee(rep, sessionRecord().id, student(99)))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/the most a class rep can/) });
    expect(records).toHaveLength(MAX_REP_ADDS_PER_SESSION);
  });

  it('makes the class rep be in the venue when the session checks it', async () => {
    const session = sessionRecord({ venue: hall, requireVenue: true });
    const { service } = manualHarness(session, DURING);
    const at = (latitude: number, longitude: number) => ({ latitude, longitude, accuracyMeters: 8, capturedAt: DURING.toISOString(), ageMilliseconds: 1_000 });
    await expect(service.addAttendee(rep, session.id, student(1))).rejects.toThrow(/Turn on location/);
    await expect(service.addAttendee(rep, session.id, { ...student(1), location: at(6.6, 3.99) })).rejects.toThrow(/from Lecture hall 1/);
    await expect(service.addAttendee(rep, session.id, { ...student(1), location: at(6.5841, 3.9833) })).resolves.toMatchObject({ status: 'added' });
  });

  it('lets the lecturer add after class, and the list marks it as added after class', async () => {
    const session = sessionRecord({ createdByUserId: 'lecturer', creatorRole: 'lecturer', creatorName: 'Dr. Adeyemi' });
    const { service } = manualHarness(session, AFTER);
    await expect(service.addAttendee(lecturer, session.id, student(1))).resolves.toMatchObject({ status: 'added' });
    const repository = {
      findSession: async () => session,
      findActor: async (userId: string) => actors[userId] ?? null,
      listAttendees: async () => [{
        id: 'a-1', lectureSessionId: session.id, studentUserId: null, fullName: 'Student Number1', matricNumber: '230591001', method: 'manual',
        deviceHash: null, distanceMeters: null, venueOutcome: null, createdAt: AFTER, removedAt: null, removedReason: null, addedByUserId: 'lecturer', addedByName: 'Dr. Adeyemi',
      }],
    } as unknown as LectureRepository;
    const detail = await new LectureService({ repository, now: () => AFTER }).getSession(lecturer, session.id);
    expect(detail.attendees[0]).toMatchObject({ method: 'manual', addedAfterClose: true });
  });
});

describe('course catalog', () => {
  function catalogHarness(rows: InstitutionCourseRecord[] = []) {
    const created: Array<Record<string, unknown>> = [];
    const sessions: Array<Record<string, unknown>> = [];
    const repository = {
      findActor: async (userId: string) => actors[userId] ?? null,
      listInstitutionCourses: async () => rows,
      listRecentCourseUse: async () => [{ courseCode: 'GET 209', lecturerName: 'Engr. Bello' }, { courseCode: 'OLD 101', lecturerName: null }],
      insertInstitutionCourse: async (input: { code: string; title: string; units: number; addedByUserId: string }) => {
        const id = `00000000-0000-4000-8000-00000000000${rows.length + 1}`;
        rows.push({ id, code: input.code, title: input.title, units: input.units, addedByUserId: input.addedByUserId, addedByName: 'Dr. Adeyemi' });
        created.push(input);
        return { kind: 'created' as const, id };
      },
      updateInstitutionCourse: async (input: { id: string; title?: string; units?: number }) => {
        const index = rows.findIndex((row) => row.id === input.id);
        rows[index] = { ...rows[index]!, ...(input.title ? { title: input.title } : {}), ...(input.units !== undefined ? { units: input.units } : {}) };
      },
      deleteInstitutionCourse: async () => 'deleted' as const,
      usesEnrolledCourses: async () => false,
      createSession: async (input: Record<string, unknown>) => {
        sessions.push(input);
        return { kind: 'created' as const, id: '0f6d3a52-6c1b-4f0e-9a51-2a9a3f1c7d10' };
      },
      findSession: async () => ({ ...sessionRecord(), ...sessions.at(-1), createdByUserId: 'lecturer', creatorRole: 'lecturer' }),
    } as unknown as LectureRepository;
    return { service: new LectureService({ repository, now: () => DURING }), created, sessions, rows };
  }

  it('offers the built-in engineering list with recent courses for the person', async () => {
    const { service } = catalogHarness();
    const catalog = await service.courseCatalog(lecturer);
    expect(catalog.courses.find((course) => course.code === 'GET 201')).toMatchObject({ title: 'Applied Electricity I', units: 3, level: 200, semester: 1, source: 'standard' });
    expect(catalog.courses.length).toBeGreaterThanOrEqual(40);
    // A course no longer on the list is left out of the recent ones.
    expect(catalog.recent).toEqual([{ code: 'GET 209', lecturerName: 'Engr. Bello' }]);
  });

  it('opens a session with the title from the list, whatever title was typed', async () => {
    const harness = catalogHarness();
    await harness.service.createSession(lecturer, { courseCode: 'get201', courseTitle: 'Applied Electrcity', lecturerName: undefined, durationMinutes: 60, qrMode: 'dynamic' });
    expect(harness.sessions[0]).toMatchObject({ courseCode: 'GET 201', courseTitle: 'Applied Electricity I' });
    await expect(harness.service.createSession(lecturer, { courseCode: 'ECE 305', courseTitle: 'Digital Electronics', lecturerName: undefined, durationMinutes: 60, qrMode: 'dynamic' }))
      .rejects.toMatchObject({ statusCode: 422, message: expect.stringMatching(/not in the course list/) });
  });

  it('lets a lecturer add a departmental course that everyone can then pick', async () => {
    const harness = catalogHarness();
    const added = await harness.service.addCourse(lecturer, { code: 'ECE 305', title: 'Digital Electronics', units: 3 });
    expect(added).toMatchObject({ code: 'ECE 305', level: 300, source: 'institution', canEdit: true, group: 'Departmental courses' });
    await harness.service.createSession(lecturer, { courseCode: 'ECE 305', lecturerName: undefined, durationMinutes: 60, qrMode: 'dynamic' });
    expect(harness.sessions[0]).toMatchObject({ courseTitle: 'Digital Electronics' });
    await expect(harness.service.addCourse(otherLecturer, { code: 'ece 305', title: 'Digital Electronics I', units: 2 }))
      .rejects.toMatchObject({ statusCode: 409, message: expect.stringMatching(/already in the list/) });
    await expect(harness.service.addCourse(lecturer, { code: 'GET 201', title: 'Electricity', units: 3 })).rejects.toMatchObject({ statusCode: 409 });
  });

  it('lets only the person who added a course, or an administrator, change it', async () => {
    const harness = catalogHarness([{ id: '00000000-0000-4000-8000-000000000009', code: 'MEE 211', title: 'Applied Mechanic', units: 3, addedByUserId: 'lecturer', addedByName: 'Dr. Adeyemi' }]);
    await expect(harness.service.updateCourse(otherLecturer, '00000000-0000-4000-8000-000000000009', { title: 'X' })).rejects.toMatchObject({ statusCode: 403 });
    await expect(harness.service.updateCourse(lecturer, '00000000-0000-4000-8000-000000000009', { title: 'Applied  Mechanics' }))
      .resolves.toMatchObject({ title: 'Applied Mechanics' });
    await expect(harness.service.removeCourse(admin, '00000000-0000-4000-8000-000000000009')).resolves.toBeUndefined();
    const others = await harness.service.courseCatalog(otherLecturer);
    expect(others.courses.find((course) => course.code === 'MEE 211')).toMatchObject({ canEdit: false, addedByName: 'Dr. Adeyemi' });
  });

  it('turns away students who cannot take attendance', async () => {
    const harness = catalogHarness();
    const plain = { id: 'plain', accountType: 'student' } as unknown as AuthenticatedAccount;
    actors.plain = { userId: 'plain', institutionId: 'inst', displayName: 'Ada', lecturerDepartmentId: null, lecturerFacultyId: null, student: null, classRep: null };
    await expect(harness.service.courseCatalog(plain)).rejects.toThrow(/class representatives/);
  });
});
