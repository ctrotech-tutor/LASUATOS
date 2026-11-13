import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { StudentAuthService } from '../auth/service.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import { LectureService } from '../lecture/service.js';
import { PostgresLectureRepository } from '../lecture/postgres-repository.js';
import {
  INSTITUTION_SLUG,
  LECTURER_EMAIL,
  LECTURER_PASSWORD,
  applyMigrations,
  ids,
  jsonBody,
  seedLecturerFixture,
  sessionCookie,
} from './harness.js';

/**
 * A whole semester and the start of the next one, over HTTP against embedded
 * PostgreSQL, with the attendance clock moved forward: a course is taught all
 * semester, a session left open at the end closes by itself, the administrator
 * adds the next semester, the same course code runs again for a new class, and
 * registers, student rates and history keep the two semesters apart.
 */

const DAY = 86_400_000;
const SECOND_SEMESTER_ID = 'c8888888-8888-4888-8888-888888888888';

type Row = Record<string, unknown>;

it('keeps registers and student rates per semester across the end of a semester', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    // The fixture's first semester runs from 30 days ago to 90 days from now.
    await seedLecturerFixture(client);
    const base = Date.now();
    let clock = new Date(base - 20 * DAY);
    const at = (days: number) => { clock = new Date(base + days * DAY); };

    const database = drizzle(client) as unknown as DatabaseClient;
    const server = buildServer({
      logger: false,
      secureCookies: false,
      auth: new StudentAuthService({ repository: new PostgresAuthRepository(database), institutionSlug: INSTITUTION_SLUG }),
      lecture: new LectureService({ repository: new PostgresLectureRepository(database), now: () => clock }),
    });
    const post = (url: string, payload: unknown, cookie?: string) =>
      server.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, ...(cookie ? { headers: { cookie } } : {}) });
    const get = (url: string, cookie?: string) => server.inject({ method: 'GET', url, ...(cookie ? { headers: { cookie } } : {}) });

    const lecturer = sessionCookie((await post('/api/v1/auth/login', { email: LECTURER_EMAIL, password: LECTURER_PASSWORD })).headers);
    const signUp = async (displayName: string, email: string, matricNumber: string) => {
      const response = await post('/api/v1/auth/register', { displayName, email, matricNumber, password: `${matricNumber}-passphrase`, entryLevel: 100 });
      expect(response.statusCode).toBe(201);
      return sessionCookie(response.headers);
    };
    const chidi = await signUp('Chidi Okeke', 'chidi@e2e.invalid', '220591010');
    const dayo = await signUp('Dayo Bello', 'dayo@e2e.invalid', '230591020');

    type Attendee = { readonly name: string; readonly matric: string } | { readonly cookie: string };
    /** Opens a one-hour CSC 301 lecture on a given day and checks the attendees in. */
    async function lecture(day: number, attendees: readonly Attendee[]): Promise<string> {
      at(day);
      const created = await post('/api/v1/lecture/sessions', { courseCode: 'CSC 301', courseTitle: 'Operating Systems', durationMinutes: 60, qrMode: 'static' }, lecturer);
      expect(created.statusCode).toBe(201);
      const id = String(jsonBody(created).id);
      const code = String(jsonBody(await get(`/api/v1/lecture/sessions/${id}/qr`, lecturer)).code);
      clock = new Date(clock.getTime() + 5 * 60_000);
      for (const attendee of attendees) {
        const cookie = 'cookie' in attendee ? attendee.cookie : undefined;
        const resolved = await post('/api/v1/lecture/resolve', { code, scanned: true }, cookie);
        expect(resolved.statusCode).toBe(200);
        const ticket = jsonBody(resolved).ticket;
        const checkIn = await post('/api/v1/lecture/check-in', 'cookie' in attendee ? { ticket } : { ticket, fullName: attendee.name, matricNumber: attendee.matric }, cookie);
        expect(checkIn.statusCode).toBe(201);
      }
      return id;
    }
    const ada = { name: 'Ada Obi', matric: '220591001' };
    const bola = { name: 'Bola Ade', matric: '220591002' };

    // 1. First semester: three lectures.
    await lecture(-20, [ada, bola, { cookie: chidi }]);
    await lecture(-13, [ada, bola]);
    await lecture(-6, [ada, { cookie: chidi }]);

    // 2. The last lecture of the semester is left open; it closes by itself.
    const lastId = await lecture(90 - 30 / 1440, []);
    const lastCode = String(jsonBody(await get(`/api/v1/lecture/sessions/${lastId}/qr`, lecturer)).code);
    at(91);
    expect(jsonBody(await get(`/api/v1/lecture/sessions/${lastId}`, lecturer)).session).toMatchObject({ status: 'closed' });
    expect((await post('/api/v1/lecture/resolve', { code: lastCode, scanned: true })).statusCode).toBe(410);

    // 3. The administrator adds the second semester (structure screen).
    await client.query(
      `INSERT INTO semesters (id, institution_id, academic_session_id, name, starts_at, ends_at)
       VALUES ($1, $2, $3, 'Second Semester', to_timestamp($4 / 1000.0), to_timestamp($5 / 1000.0))`,
      [SECOND_SEMESTER_ID, ids.institution, ids.academicSession, base + 100 * DAY, base + 220 * DAY],
    );

    // 4. Second semester: the same course code runs again; Dayo is new, Chidi carries it over.
    await lecture(110, [{ cookie: dayo }]);
    await lecture(117, [{ cookie: dayo }, { cookie: chidi }]);
    at(120);

    // 5. The register opens on the current semester only.
    const current = jsonBody(await get('/api/v1/lecture/register?course=csc301', lecturer));
    expect(current.term).toMatchObject({ id: SECOND_SEMESTER_ID, label: '2026/27 · Second Semester', sessionCount: 2 });
    expect((current.terms as Row[]).map((term) => [term.id, term.sessionCount])).toEqual([
      [SECOND_SEMESTER_ID, 2],
      [ids.semester, 4],
      ['all', 6],
    ]);
    expect((current.students as Row[]).map((row) => [row.matricNumber, row.attended, row.rate])).toEqual([
      ['220591010', 1, 50],
      ['230591020', 2, 100],
    ]);

    // 6. Last semester's register is unchanged and still complete.
    const previous = jsonBody(await get(`/api/v1/lecture/register?course=CSC%20301&term=${ids.semester}`, lecturer));
    expect((previous.sessions as Row[]).map((session) => session.presentCount)).toEqual([3, 2, 2, 0]);
    expect((previous.students as Row[]).map((row) => [row.fullName, row.attended, row.rate])).toEqual([
      ['Ada Obi', 3, 75],
      ['Bola Ade', 2, 50],
      ['Chidi Okeke', 2, 50],
    ]);
    const everything = jsonBody(await get('/api/v1/lecture/register?course=CSC%20301&term=all', lecturer));
    expect(everything.sessions).toHaveLength(6);
    expect((await get('/api/v1/lecture/register?course=CSC%20301&term=other', lecturer)).statusCode).toBe(404);
    expect((await get('/api/v1/lecture/register?course=CSC%20301&term=not-a-term', lecturer)).statusCode).toBe(400);

    // 7. Students' own rates count only the semesters they took the course in.
    const dayoHistory = jsonBody(await get('/api/v1/student/lecture-history', dayo));
    expect(dayoHistory.courses).toEqual([{ courseCode: 'CSC 301', courseTitle: 'Operating Systems', held: 2, attended: 2, rate: 100 }]);
    const chidiHistory = jsonBody(await get('/api/v1/student/lecture-history', chidi));
    expect(chidiHistory.courses).toEqual([{ courseCode: 'CSC 301', courseTitle: 'Operating Systems', held: 6, attended: 3, rate: 50 }]);
    expect(chidiHistory.entries).toHaveLength(3);

    // 8. Every session stays in the lecturer's history and course list.
    const sessions = jsonBody(await get('/api/v1/lecture/sessions', lecturer));
    expect((sessions.sessions as Row[]).length).toBe(6);
    expect((sessions.sessions as Row[]).every((session) => session.status === 'closed')).toBe(true);
    expect(jsonBody(await get('/api/v1/lecture/registers', lecturer)).courses).toEqual([
      expect.objectContaining({ courseCode: 'CSC 301', sessionCount: 6 }),
    ]);

    await server.close();
  } finally {
    await client.close();
  }
}, 120_000);
