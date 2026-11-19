import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { hashOpaqueToken } from '@lasuatos/auth';
import type { DatabaseClient } from '@lasuatos/database';
import { drizzle } from 'drizzle-orm/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import { packCentroid, unpackCentroid } from '../students/centroid-pack.js';
import { PostgresLectureRepository } from '../lecture/postgres-repository.js';
import { PostgresStudentRepository } from '../students/postgres-repository.js';
import { INSTITUTION_SLUG, applyMigrations, ids, seedLecturerFixture } from './harness.js';

/**
 * What the pilot-morning rehearsal (pnpm load:pilot) changed, held in place:
 * - a student's session is one database round trip (it was three), with the
 *   same answer as checking administrator, then student, then lecturer;
 * - signing in reads a student's credentials in one (two) and starts the
 *   session in two (five, in a transaction);
 * - the lecture routes learn who is asking in one (three);
 * - "last seen" is only written when it is due;
 * - sign-in by matric number can use an index;
 * - the duplicate-face search reads packed centroids, the same bytes the
 *   migration packs older rows into.
 */

const migrations = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../packages/database/drizzle/migrations');
const NOW = new Date('2026-11-19T08:00:00.000Z');
const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);

const people = {
  student: 'e1111111-1111-4111-8111-111111111111',
  adminStudent: 'e2222222-2222-4222-8222-222222222222',
  dormantAdminStudent: 'e3333333-3333-4333-8333-333333333333',
  profileOnly: 'e4444444-4444-4444-8444-444444444444',
  suspended: 'e5555555-5555-4555-8555-555555555555',
  starting: 'e6666666-6666-4666-8666-666666666666',
} as const;
const closedDepartment = 'e7777777-7777-4777-8777-777777777777';

let client: PGlite;
let auth: PostgresAuthRepository;
let students: PostgresStudentRepository;
let lectures: PostgresLectureRepository;
let roundTrips: ReturnType<typeof vi.spyOn>;

async function person(id: string, input: { email: string; matric?: string; studentRole?: boolean; status?: string; passwordIsDefault?: boolean }) {
  await client.query(
    `INSERT INTO users (id, institution_id, email, display_name, password_hash, password_is_default, status) VALUES ($1, $2, $3, $4, 'x', $5, $6)`,
    [id, ids.institution, input.email, `Person ${input.email}`, input.passwordIsDefault ?? false, input.status ?? 'active'],
  );
  if (input.matric) {
    await client.query('INSERT INTO student_profiles (user_id, institution_id, department_id, student_number) VALUES ($1, $2, $3, $4)', [id, ids.institution, ids.department, input.matric]);
  }
  if (input.studentRole) {
    await client.query(`INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, 'student', 'institution', $2)`, [id, ids.institution]);
  }
}

async function session(userId: string, token: string, input: { lastSeen?: Date | null; expires?: Date; revoked?: boolean; startingPassword?: boolean } = {}) {
  await client.query(
    `INSERT INTO user_sessions (user_id, token_hash, expires_at, last_seen_at, revoked_at, starting_password) VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, hashOpaqueToken(token), input.expires ?? new Date(NOW.getTime() + 86_400_000), input.lastSeen === undefined ? minutesAgo(1) : input.lastSeen, input.revoked ? minutesAgo(1) : null, input.startingPassword ?? false],
  );
}

async function lastSeen(token: string): Promise<Date | null> {
  const result = await client.query<{ last_seen_at: Date | null }>('SELECT last_seen_at FROM user_sessions WHERE token_hash = $1', [hashOpaqueToken(token)]);
  return result.rows[0]?.last_seen_at ?? null;
}

/** Round trips made by `run` (each statement Drizzle sends is one client.query). */
async function counted<T>(run: () => Promise<T>): Promise<{ result: T; trips: number }> {
  roundTrips.mockClear();
  const result = await run();
  return { result, trips: roundTrips.mock.calls.length };
}

beforeEach(async () => {
  client = new PGlite();
  await applyMigrations(client);
  await seedLecturerFixture(client);
  await client.query(`INSERT INTO departments (id, institution_id, faculty_id, code, name, is_active) VALUES ($1, $2, $3, 'OLD', 'Closed Department', false)`, [closedDepartment, ids.institution, ids.faculty]);
  await person(people.student, { email: 'ada@e2e.invalid', matric: '250211184', studentRole: true });
  await person(people.starting, { email: 'bola@e2e.invalid', matric: '250211185', studentRole: true, passwordIsDefault: true });
  await person(people.adminStudent, { email: 'chidi@e2e.invalid', matric: '250211186', studentRole: true });
  await client.query(`INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, 'institution_administrator', 'institution', $2)`, [people.adminStudent, ids.institution]);
  await person(people.dormantAdminStudent, { email: 'dayo@e2e.invalid', matric: '250211187', studentRole: true });
  await client.query(`INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id, department_id) VALUES ($1, 'department_administrator', 'department', $2, $3)`, [people.dormantAdminStudent, ids.institution, closedDepartment]);
  await person(people.profileOnly, { email: 'efe@e2e.invalid', matric: '250211188' });
  await person(people.suspended, { email: 'femi@e2e.invalid', matric: '250211189', studentRole: true, status: 'suspended' });
  const database = drizzle(client) as unknown as DatabaseClient;
  auth = new PostgresAuthRepository(database);
  students = new PostgresStudentRepository(database);
  lectures = new PostgresLectureRepository(database);
  roundTrips = vi.spyOn(client, 'query');
});

afterEach(async () => {
  roundTrips.mockRestore();
  await client.close();
});

describe('session lookup', () => {
  it('finds a student in one round trip, and writes "last seen" only when it is due', async () => {
    await session(people.student, 'fresh-student-token', { lastSeen: minutesAgo(1) });
    const fresh = await counted(() => auth.findSession(hashOpaqueToken('fresh-student-token'), NOW));
    expect(fresh.result).toEqual({
      accountType: 'student', id: people.student, email: 'ada@e2e.invalid', displayName: 'Person ada@e2e.invalid',
      matricNumber: '250211184', matricNumberVerified: false, sessionExpiresAt: expect.any(Date),
    });
    expect(fresh.trips).toBe(1);
    expect(await lastSeen('fresh-student-token')).toEqual(minutesAgo(1));

    await session(people.student, 'stale-student-token', { lastSeen: minutesAgo(6) });
    const stale = await counted(() => auth.findSession(hashOpaqueToken('stale-student-token'), NOW));
    expect(stale.result?.accountType).toBe('student');
    expect(stale.trips).toBe(2);
    expect(await lastSeen('stale-student-token')).toEqual(NOW);

    await session(people.student, 'never-seen-token', { lastSeen: null });
    await auth.findSession(hashOpaqueToken('never-seen-token'), NOW);
    expect(await lastSeen('never-seen-token')).toEqual(NOW);
  });

  it('marks a starting-password session only while the password is still the starting one', async () => {
    await session(people.starting, 'starting-token', { startingPassword: true });
    expect(await auth.findSession(hashOpaqueToken('starting-token'), NOW)).toMatchObject({ accountType: 'student', startingPasswordSession: true });
    await client.query('UPDATE users SET password_is_default = false WHERE id = $1', [people.starting]);
    expect(await auth.findSession(hashOpaqueToken('starting-token'), NOW)).not.toHaveProperty('startingPasswordSession');
  });

  it('keeps the order administrator, student, lecturer', async () => {
    // An administrator who also has a student profile is signed in as the administrator.
    await session(people.adminStudent, 'admin-student-token');
    const admin = await counted(() => auth.findSession(hashOpaqueToken('admin-student-token'), NOW));
    expect(admin.result).toMatchObject({ accountType: 'administrator', role: 'institution_administrator', id: people.adminStudent });
    expect(admin.trips).toBe(2);

    // An administrator role whose department is closed does not count: the student account it is.
    await session(people.dormantAdminStudent, 'dormant-token');
    expect(await auth.findSession(hashOpaqueToken('dormant-token'), NOW)).toMatchObject({ accountType: 'student', matricNumber: '250211187' });

    // A lecturer (no student profile) takes the lecturer lookup.
    await session(ids.lecturer, 'lecturer-token');
    const lecturer = await counted(() => auth.findSession(hashOpaqueToken('lecturer-token'), NOW));
    expect(lecturer.result).toMatchObject({ accountType: 'lecturer', id: ids.lecturer, staffNumber: 'E2E-STAFF-1' });
    expect(lecturer.trips).toBe(2);

    // A student profile without the student role is not a student account (and not a lecturer).
    await session(people.profileOnly, 'profile-only-token');
    expect(await auth.findSession(hashOpaqueToken('profile-only-token'), NOW)).toBeNull();
  });

  it('refuses revoked, expired and suspended sessions without touching them', async () => {
    await session(people.student, 'revoked-token', { revoked: true, lastSeen: minutesAgo(60) });
    await session(people.student, 'expired-token', { expires: minutesAgo(1), lastSeen: minutesAgo(60) });
    await session(people.suspended, 'suspended-token', { lastSeen: minutesAgo(60) });
    for (const token of ['revoked-token', 'expired-token', 'suspended-token', 'no-such-token']) {
      const lookup = await counted(() => auth.findSession(hashOpaqueToken(token), NOW));
      expect(lookup.result, token).toBeNull();
      expect(lookup.trips, token).toBe(1);
    }
    expect(await lastSeen('revoked-token')).toEqual(minutesAgo(60));
  });
});

describe('signing in', () => {
  it('reads a student\'s credentials in one round trip, keeping the order administrator, student, lecturer', async () => {
    const student = await counted(() => auth.findCredentials('bola@e2e.invalid', INSTITUTION_SLUG));
    expect(student.result).toEqual({ accountType: 'student', id: people.starting, passwordHash: 'x', passwordIsDefault: true, status: 'active', emailVerified: false });
    expect(student.trips).toBe(1);

    expect(await auth.findCredentials('chidi@e2e.invalid', INSTITUTION_SLUG)).toMatchObject({ accountType: 'administrator', id: people.adminStudent });
    expect(await auth.findCredentials('dayo@e2e.invalid', INSTITUTION_SLUG)).toMatchObject({ accountType: 'student', id: people.dormantAdminStudent });
    expect(await auth.findCredentials('lecturer@e2e.invalid', INSTITUTION_SLUG)).toMatchObject({ accountType: 'lecturer', id: ids.lecturer });
    // Status is the service's to judge (it refuses anything but active), as before.
    expect(await auth.findCredentials('femi@e2e.invalid', INSTITUTION_SLUG)).toMatchObject({ accountType: 'student', status: 'suspended' });
    expect(await auth.findCredentials('efe@e2e.invalid', INSTITUTION_SLUG)).toBeNull();
    const unknown = await counted(() => auth.findCredentials('nobody@e2e.invalid', INSTITUTION_SLUG));
    expect(unknown.result).toBeNull();
    expect(unknown.trips).toBe(1);
    expect(await auth.findCredentials('bola@e2e.invalid', 'another-institution')).toBeNull();
  });

  it('starts a student\'s session in two round trips, and the session reads back as the same account', async () => {
    const expires = new Date(NOW.getTime() + 86_400_000);
    const started = await counted(() => auth.createSession(people.starting, hashOpaqueToken('new-starting'), NOW, expires, { startingPassword: true }));
    expect(started.trips).toBe(2);
    expect(started.result).toMatchObject({ accountType: 'student', id: people.starting, matricNumber: '250211185', startingPasswordSession: true });
    expect(await auth.findSession(hashOpaqueToken('new-starting'), NOW)).toEqual(started.result);

    // Not on the starting password any more: never a starting-password session, whatever the caller says.
    expect(await auth.createSession(people.student, hashOpaqueToken('new-own'), NOW, expires, { startingPassword: true })).not.toHaveProperty('startingPasswordSession');
    const flags = await client.query<{ starting_password: boolean }>('SELECT starting_password FROM user_sessions WHERE token_hash = $1', [hashOpaqueToken('new-own')]);
    expect(flags.rows[0]?.starting_password).toBe(false);

    const admin = await counted(() => auth.createSession(people.adminStudent, hashOpaqueToken('new-admin'), NOW, expires, { startingPassword: true }));
    expect(admin.result).toMatchObject({ accountType: 'administrator', role: 'institution_administrator' });
    expect(admin.trips).toBe(3);
    expect(await auth.findSession(hashOpaqueToken('new-admin'), NOW)).toEqual(admin.result);
    expect(await auth.createSession(people.dormantAdminStudent, hashOpaqueToken('new-dormant'), NOW, expires)).toMatchObject({ accountType: 'student' });
    const lecturer = await auth.createSession(ids.lecturer, hashOpaqueToken('new-lecturer'), NOW, expires);
    expect(lecturer).toMatchObject({ accountType: 'lecturer', staffNumber: 'E2E-STAFF-1' });
    expect(await auth.findSession(hashOpaqueToken('new-lecturer'), NOW)).toEqual(lecturer);

    // No account to sign in as: no session row either.
    for (const [userId, token] of [[people.profileOnly, 'new-profile-only'], [people.suspended, 'new-suspended']] as const) {
      expect(await auth.createSession(userId, hashOpaqueToken(token), NOW, expires), token).toBeNull();
      const rows = await client.query('SELECT 1 FROM user_sessions WHERE token_hash = $1', [hashOpaqueToken(token)]);
      expect(rows.rows, token).toHaveLength(0);
    }
  });
});

describe('who is asking (lecture routes)', () => {
  async function appoint(studentUserId: string, input: { entryYear: number; assistantOf?: string; permissions?: string[]; revoked?: boolean }): Promise<string> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO class_representatives (institution_id, student_user_id, role, faculty_id, department_id, entry_year, appointed_by_user_id, assistant_of_id, permissions, revoked_at)
       VALUES ($1, $2, 'hoc', $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [ids.institution, studentUserId, ids.faculty, ids.department, input.entryYear, ids.lecturer, input.assistantOf ?? null, input.permissions ?? [], input.revoked ? NOW : null],
    );
    return result.rows[0]!.id;
  }

  it('reads the account, its student identity and its live class-rep appointment in one round trip', async () => {
    const hoc = await appoint(people.student, { entryYear: 2025 });
    await appoint(people.starting, { entryYear: 2025, assistantOf: hoc, permissions: ['registers', 'setup_codes'] });
    await appoint(people.adminStudent, { entryYear: 2024, revoked: true });
    await client.query('UPDATE student_profiles SET entry_year = 2025 WHERE user_id = $1', [people.starting]);

    const assistant = await counted(() => lectures.findActor(people.starting));
    expect(assistant.trips).toBe(1);
    expect(assistant.result).toEqual({
      userId: people.starting,
      institutionId: ids.institution,
      displayName: 'Person bola@e2e.invalid',
      lecturerDepartmentId: null,
      lecturerFacultyId: null,
      student: {
        userId: people.starting, fullName: 'Person bola@e2e.invalid', email: 'bola@e2e.invalid', matricNumber: '250211185',
        departmentId: ids.department, departmentName: 'Electronic and Computer Engineering', facultyId: ids.faculty, facultyName: 'Faculty of Engineering', entryYear: 2025,
      },
      classRep: {
        id: expect.any(String), role: 'hoc', studentUserId: people.starting, facultyId: ids.faculty, facultyName: 'Faculty of Engineering',
        departmentId: ids.department, departmentName: 'Electronic and Computer Engineering', entryYear: 2025,
        assistantOfId: hoc, permissions: ['registers', 'setup_codes'], principalName: 'Person ada@e2e.invalid',
      },
    });
    expect((await lectures.findActor(people.student))?.classRep).toMatchObject({ id: hoc, assistantOfId: null, permissions: [], principalName: null });
    // A revoked appointment is no appointment.
    expect(await lectures.findActor(people.adminStudent)).toMatchObject({ classRep: null, student: { matricNumber: '250211186' } });
  });

  it('gives a lecturer their department and no student side, and nobody for a suspended account', async () => {
    // An appointment on an account with no student profile does not make it a class rep.
    await appoint(ids.lecturer, { entryYear: 2023 });
    expect(await lectures.findActor(ids.lecturer)).toEqual({
      userId: ids.lecturer, institutionId: ids.institution, displayName: 'E2E Lecturer',
      lecturerDepartmentId: ids.department, lecturerFacultyId: ids.faculty, student: null, classRep: null,
    });
    expect(await lectures.findActor(people.suspended)).toBeNull();
    expect(await lectures.findActor('e9999999-9999-4999-8999-999999999999')).toBeNull();
  });
});

/** A department's worth of students with accounts, so the planner weighs each query as it would on the day. */
async function addBulkStudents(): Promise<void> {
  await client.exec(`
    INSERT INTO users (id, institution_id, email, display_name, password_hash, status)
      SELECT gen_random_uuid(), '${ids.institution}', 'bulk' || n || '@e2e.invalid', 'Bulk ' || n, 'x', 'active' FROM generate_series(1, 3000) AS n;
    INSERT INTO student_profiles (user_id, institution_id, department_id, student_number)
      SELECT id, institution_id, '${ids.department}', '26' || lpad(substr(email, 5, position('@' in email) - 5), 7, '0') FROM users WHERE email LIKE 'bulk%';
    INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id)
      SELECT id, 'student', 'institution', institution_id FROM users WHERE email LIKE 'bulk%';
    ANALYZE;
  `);
}

/** The plan of the statement the repository just sent (the first one since the counter was cleared). */
async function planOfFirstStatement(): Promise<string> {
  const [statement, params] = roundTrips.mock.calls[0] as [string, unknown[]];
  const plan = await client.query<{ 'QUERY PLAN': string }>(`EXPLAIN ${statement}`, params);
  return plan.rows.map((row) => row['QUERY PLAN']).join('\n');
}

describe('at the size of a department', () => {
  it('checks a signing-in account\'s roles by looking that account up, not by reading every role', async () => {
    await addBulkStudents();
    const lookup = await counted(() => auth.findCredentials('ada@e2e.invalid', INSTITUTION_SLUG));
    expect(lookup.result).toMatchObject({ accountType: 'student', id: people.student });
    expect(await planOfFirstStatement()).not.toMatch(/Seq Scan on user_role_assignments/);

    const started = await counted(() => auth.createSession(people.student, hashOpaqueToken('scale-token'), NOW, new Date(NOW.getTime() + 86_400_000)));
    expect(started.result).toMatchObject({ accountType: 'student' });
    expect(await planOfFirstStatement()).not.toMatch(/Seq Scan on user_role_assignments/);
    const session = await counted(() => auth.findSession(hashOpaqueToken('scale-token'), NOW));
    expect(session.result).toMatchObject({ accountType: 'student' });
    expect(await planOfFirstStatement()).not.toMatch(/Seq Scan on user_role_assignments/);
  });
});

describe('sign-in by matric number', () => {
  it('finds the account (spaces and case ignored) and the query can use the matric index', async () => {
    await client.query(`UPDATE student_profiles SET student_number = '250 211 184' WHERE user_id = $1`, [people.student]);
    await addBulkStudents();
    roundTrips.mockClear();
    const lookup = await counted(() => auth.findStudentEmailByMatric('250211184', INSTITUTION_SLUG));
    expect(lookup.result).toBe('ada@e2e.invalid');
    // The exact statement the repository sent must find the student through the matric index.
    expect(await planOfFirstStatement()).toContain('student_profiles_matric_key_idx');
  });
});

describe('packed face centroids', () => {
  const centroid = Array.from({ length: 128 }, (_, index) => Math.round(Math.sin(index + 1) * 0.12 * 1e6) / 1e6);

  it('packs to big-endian float32 and back within a millionth', () => {
    expect(packCentroid([0.5, -2])).toEqual(Buffer.from([0x3f, 0x00, 0x00, 0x00, 0xc0, 0x00, 0x00, 0x00]));
    const back = unpackCentroid(packCentroid(centroid))!;
    expect(back).toHaveLength(128);
    for (const [index, value] of centroid.entries()) expect(Math.abs(back[index]! - value)).toBeLessThan(1e-6);
    expect(unpackCentroid(Buffer.alloc(0))).toBeNull();
    expect(unpackCentroid(Buffer.alloc(6))).toBeNull();
  });

  it('stores the packed copy on registration, reads it back, and packs older rows the same way in SQL', async () => {
    const write = { institutionId: ids.institution, model: 'sface-2021dec', templates: [centroid], centroid, photo: Buffer.from([1]), quality: {}, consentedAt: NOW, now: NOW };
    expect(await students.saveFaceProfile({ ...write, userId: people.student })).toBe('saved');
    const stored = await client.query<{ centroid_packed: Uint8Array }>('SELECT centroid_packed FROM student_face_profiles WHERE user_id = $1', [people.student]);
    expect(Buffer.from(stored.rows[0]!.centroid_packed)).toEqual(packCentroid(centroid));

    // A face registered before migration 0033: JSON only, until the migration's backfill packs it.
    await client.query(
      `INSERT INTO student_face_profiles (user_id, institution_id, model, templates, centroid, photo, quality, consented_at) VALUES ($1, $2, 'sface-2021dec', $3, $4, $5, '{}', $6)`,
      [people.starting, ids.institution, JSON.stringify([centroid]), JSON.stringify(centroid), Buffer.from([1]), NOW],
    );
    const before = await students.listFaceCentroids(ids.institution, people.adminStudent);
    expect(before.find((row) => row.userId === people.starting)?.centroid).toEqual(centroid);
    expect(before.find((row) => row.userId === people.student)?.centroid).toBeInstanceOf(Float32Array);

    const migration = await readFile(path.join(migrations, (await readdir(migrations)).find((file) => file.startsWith('0033_'))!), 'utf8');
    const backfill = migration.split('--> statement-breakpoint').find((part) => part.includes('UPDATE "student_face_profiles"'))!;
    await client.exec(backfill);
    const packed = await client.query<{ user_id: string; centroid_packed: Uint8Array }>('SELECT user_id, centroid_packed FROM student_face_profiles');
    for (const row of packed.rows) expect(Buffer.from(row.centroid_packed), row.user_id).toEqual(packCentroid(centroid));

    const after = await students.listFaceCentroids(ids.institution, people.student);
    expect(after.map((row) => row.userId)).toEqual([people.starting]);
    expect(after[0]!.centroid).toBeInstanceOf(Float32Array);
  });
});
