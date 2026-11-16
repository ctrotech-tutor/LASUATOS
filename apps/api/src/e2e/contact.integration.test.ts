import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { hashPassword } from '@lasuatos/auth';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { StudentAuthService } from '../auth/service.js';
import { PostgresAuthRepository } from '../auth/postgres-repository.js';
import { PostgresContactRepository } from '../contact/postgres-repository.js';
import { ContactService, type ContactReceipt, type ContactTeamNotice } from '../contact/service.js';
import { contactReceiptMessage, contactTeamMessage } from '../email/transport.js';
import { INSTITUTION_SLUG, LECTURER_EMAIL, LECTURER_PASSWORD, applyMigrations, ids, jsonBody, seedLecturerFixture, sessionCookie } from './harness.js';

/**
 * The contact page: a message is saved, the institution administrators are
 * emailed (Reply-To: the sender) and the sender gets a receipt; spam is
 * dropped quietly; only institution administrators can read and handle
 * messages; old messages are deleted by the daily retention run.
 */

const ADMIN_ID = 'c7777777-7777-4777-8777-777777777777';
const ADMIN_EMAIL = 'admin@e2e.invalid';
const ADMIN_PASSWORD = 'e2e-admin-passphrase';

it('contact messages: sending, spam, the inbox, handling and retention', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    await seedLecturerFixture(client);
    await client.query(
      `INSERT INTO users (id, institution_id, email, display_name, password_hash, status) VALUES ($1, $2, $3, 'E2E Admin', $4, 'active')`,
      [ADMIN_ID, ids.institution, ADMIN_EMAIL, await hashPassword(ADMIN_PASSWORD)],
    );
    await client.query(
      `INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, 'institution_administrator', 'institution', $2)`,
      [ADMIN_ID, ids.institution],
    );

    const database = drizzle(client) as unknown as DatabaseClient;
    const team: ContactTeamNotice[] = [];
    const receipts: ContactReceipt[] = [];
    let clock = new Date('2026-11-10T09:00:00Z');
    const auth = new StudentAuthService({ repository: new PostgresAuthRepository(database), institutionSlug: INSTITUTION_SLUG });
    const contact = new ContactService({
      repository: new PostgresContactRepository(database),
      notifier: {
        sendContactToTeam: async (notice) => { team.push(notice); },
        sendContactReceipt: async (receipt) => { receipts.push(receipt); },
      },
      now: () => clock,
    });
    const server = buildServer({ logger: false, secureCookies: false, auth, contact, openStudentSignUp: false });
    const post = (url: string, payload: unknown, cookie?: string) =>
      server.inject({ method: 'POST', url, payload: payload as Record<string, unknown>, ...(cookie ? { headers: { cookie } } : {}) });
    const get = (url: string, cookie?: string) => server.inject({ method: 'GET', url, ...(cookie ? { headers: { cookie } } : {}) });

    // A lecturer, signed in, asks for their department.
    const lecturerCookie = sessionCookie((await post('/api/v1/auth/login', { email: LECTURER_EMAIL, password: LECTURER_PASSWORD })).headers);
    const sent = await post('/api/v1/contact', {
      topic: 'adoption',
      name: 'Dr. Ada Bello-Ojo',
      email: LECTURER_EMAIL.toUpperCase(),
      role: 'lecturer',
      department: 'Mechanical Engineering',
      students: 420,
      matricNumber: '220591001',
      page: 'should be dropped',
      message: 'We would like to use LASUATOS for MEE 300 level this Rain semester.\nWho do we talk to?',
      elapsedMs: 42_000,
    }, lecturerCookie);
    expect(sent.statusCode).toBe(201);
    const { reference } = jsonBody(sent) as { reference: string };
    expect(reference).toMatch(/^LA-[2-9A-HJ-NP-Z]{6}$/);
    expect(team).toHaveLength(1);
    expect(team[0]).toMatchObject({ to: { email: ADMIN_EMAIL }, reference, senderEmail: LECTURER_EMAIL, topicLabel: 'Bring LASUATOS to a department' });
    const factText = team[0]!.facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n');
    expect(factText).toContain('Students: About 420');
    expect(team[0]!.signedIn).toBe(true);
    expect(factText).not.toMatch(/Matric|should be dropped/);
    expect(receipts).toEqual([{ to: LECTURER_EMAIL, name: 'Dr. Ada Bello-Ojo', reference, topicLabel: 'Bring LASUATOS to a department' }]);

    // The emails: the team can reply straight to the sender; the receipt never repeats the message.
    const teamEmail = contactTeamMessage(team[0]!, 'https://lasuatos.example');
    expect(teamEmail.replyTo).toEqual({ email: LECTURER_EMAIL, name: 'Dr. Ada Bello-Ojo' });
    expect(teamEmail.subject).toContain(reference);
    expect(teamEmail.html).toContain('Who do we talk to?');
    expect(teamEmail.html).toContain(`https://lasuatos.example/admin/messages?message=${reference}`);
    const receiptEmail = contactReceiptMessage(receipts[0]!);
    expect(receiptEmail.text).toContain(reference);
    expect(receiptEmail.text).not.toContain('MEE 300');

    // Spam: the hidden field, or a form posted within seconds. Looks sent, but nothing is kept or emailed.
    for (const extra of [{ website: 'https://spam.example' }, { elapsedMs: 400 }]) {
      const spam = await post('/api/v1/contact', { topic: 'other', name: 'Buy Now', email: 'bot@spam.example', message: 'Cheap followers for your page, click here today!', ...extra });
      expect(spam.statusCode).toBe(201);
      expect((jsonBody(spam) as { reference: string }).reference).toMatch(/^LA-/);
    }
    expect(team).toHaveLength(1);

    // Too many links, and a bad email: plain explanations.
    const links = await post('/api/v1/contact', { topic: 'other', name: 'Tunde', email: 'tunde@example.com', message: 'See http://a.example http://b.example http://c.example http://d.example', elapsedMs: 9_000 });
    expect(links.statusCode).toBe(400);
    expect(jsonBody(links).detail).toMatch(/at most 3 links/);
    const badEmail = await post('/api/v1/contact', { topic: 'other', name: 'Tunde', email: 'tunde@', message: 'This message is long enough to be accepted.', elapsedMs: 9_000 });
    expect(badEmail.statusCode).toBe(400);
    expect(jsonBody(badEmail).detail).toBe('Enter an email address we can reply to.');

    // A privacy request from a student who is not signed in.
    clock = new Date('2026-11-10T10:00:00Z');
    const privacy = await post('/api/v1/contact', {
      topic: 'privacy', name: 'Chioma Okafor', email: 'chioma.okafor@st.lasu.edu.ng', role: 'student', matricNumber: '240 591 002', privacyRequest: 'delete_face',
      message: 'I graduated last session. Please delete my face data.', elapsedMs: 15_000,
    });
    expect(privacy.statusCode).toBe(201);

    // Only institution administrators read the inbox.
    expect((await get('/api/v1/admin/messages')).statusCode).toBe(401);
    expect((await get('/api/v1/admin/messages', lecturerCookie)).statusCode).toBe(403);
    const adminCookie = sessionCookie((await post('/api/v1/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASSWORD })).headers);
    const inbox = jsonBody(await get('/api/v1/admin/messages', adminCookie)) as { messages: Array<Record<string, unknown>>; counts: { new: number; handled: number } };
    expect(inbox.counts).toEqual({ new: 2, handled: 0 });
    expect(inbox.messages.map((message) => message.topic)).toEqual(['privacy', 'adoption']);
    expect(inbox.messages[0]).toMatchObject({ matricNumber: '240591002', privacyRequest: 'delete_face', signedIn: false, page: null });
    expect(inbox.messages[1]).toMatchObject({ signedIn: true, students: 420, matricNumber: null, page: null, department: 'Mechanical Engineering' });
    expect(jsonBody(await get('/api/v1/admin/messages/count', adminCookie))).toEqual({ new: 2 });

    // Handle one; it leaves "new" and shows who handled it.
    const id = inbox.messages[1]!.id as string;
    const handled = await post(`/api/v1/admin/messages/${id}`, { status: 'handled' }, adminCookie);
    expect(handled.statusCode).toBe(200);
    expect(jsonBody(handled)).toMatchObject({ status: 'handled', handledByName: 'E2E Admin' });
    expect(jsonBody(await get('/api/v1/admin/messages/count', adminCookie))).toEqual({ new: 1 });
    const done = jsonBody(await get('/api/v1/admin/messages?status=handled', adminCookie)) as { messages: Array<{ id: string }> };
    expect(done.messages.map((message) => message.id)).toEqual([id]);
    expect((await post(`/api/v1/admin/messages/${id}`, { status: 'archived' }, adminCookie)).statusCode).toBe(400);

    // A note says what was done. Changing it later keeps who handled the message, and when.
    clock = new Date('2026-11-10T12:00:00Z');
    const noted = jsonBody(await post(`/api/v1/admin/messages/${id}`, { status: 'handled', note: '  Called Dr Bello; class lists due Friday.  ' }, adminCookie));
    expect(noted).toMatchObject({ status: 'handled', note: 'Called Dr Bello; class lists due Friday.', handledByName: 'E2E Admin' });
    expect(noted.handledAt).toBe((jsonBody(handled) as { handledAt: string }).handledAt);
    const tooLong = await post(`/api/v1/admin/messages/${id}`, { status: 'handled', note: 'x'.repeat(1001) }, adminCookie);
    expect(tooLong.statusCode).toBe(400);
    expect(jsonBody(tooLong).detail).toMatch(/under 1000 characters/);

    // Search: a reference exactly, or words in the name, email or message; summary counts the whole inbox.
    const privacyRef = (inbox.messages[0]!.reference as string);
    const byRef = jsonBody(await get(`/api/v1/admin/messages?status=all&q=${privacyRef.toLowerCase()}`, adminCookie)) as { messages: Array<{ reference: string }> };
    expect(byRef.messages.map((message) => message.reference)).toEqual([privacyRef]);
    const byWords = jsonBody(await get('/api/v1/admin/messages?status=all&q=rain%20semester', adminCookie)) as { messages: Array<{ id: string }> };
    expect(byWords.messages.map((message) => message.id)).toEqual([id]);
    const wildcard = jsonBody(await get('/api/v1/admin/messages?status=all&q=%25', adminCookie)) as { messages: unknown[] };
    expect(wildcard.messages).toEqual([]);
    clock = new Date('2026-11-13T12:00:00Z');
    const later = jsonBody(await get('/api/v1/admin/messages', adminCookie)) as { summary: Record<string, unknown> };
    expect(later.summary).toMatchObject({
      newByTopic: { adoption: 0, problem: 0, account: 0, privacy: 1, other: 0 },
      overdue: 0,
      oldestNewAt: '2026-11-10T10:00:00.000Z',
      privacyOpen: [{ reference: privacyRef, name: 'Chioma Okafor', topic: 'privacy', privacyRequest: 'delete_face' }],
      overdueOldest: [],
      handledLast30Days: 1,
      medianHandleHours: 1,
    });
    // Privacy requests have 30 days; after that they count as overdue.
    clock = new Date('2026-12-11T12:00:00Z');
    expect((jsonBody(await get('/api/v1/admin/messages', adminCookie)) as { summary: { overdue: number } }).summary.overdue).toBe(1);

    // One message by its reference, with the sender's other messages.
    const again = await post('/api/v1/contact', { topic: 'privacy', name: 'Chioma Okafor', email: 'Chioma.Okafor@st.lasu.edu.ng', privacyRequest: 'copy', message: 'Also, please send me a copy of my data.', elapsedMs: 9_000 });
    const detail = jsonBody(await get(`/api/v1/admin/messages/${privacyRef.toLowerCase()}`, adminCookie)) as { message: { reference: string }; others: Array<{ reference: string }> };
    expect(detail.message.reference).toBe(privacyRef);
    expect(detail.others.map((message) => message.reference)).toEqual([(jsonBody(again) as { reference: string }).reference]);
    expect((await get('/api/v1/admin/messages/LA-NOPE22', adminCookie)).statusCode).toBe(404);
    expect((await get('/api/v1/admin/messages/not-a-ref', adminCookie)).statusCode).toBe(400);
    expect((await get(`/api/v1/admin/messages/${privacyRef}`, lecturerCookie)).statusCode).toBe(403);

    // Moving a message back to new clears who handled it and the note.
    const reopened = jsonBody(await post(`/api/v1/admin/messages/${id}`, { status: 'new', note: 'ignored' }, adminCookie));
    expect(reopened).toMatchObject({ status: 'new', handledAt: null, handledByName: null, note: null });
    await post(`/api/v1/admin/messages/${id}`, { status: 'handled' }, adminCookie);
    await client.query(`DELETE FROM contact_messages WHERE reference = $1`, [(jsonBody(again) as { reference: string }).reference]);
    expect((await post('/api/v1/admin/messages/c0000000-0000-4000-8000-000000000000', { status: 'handled' }, adminCookie)).statusCode).toBe(404);

    // A year and a bit later the daily run deletes the handled message; the unhandled one stays (for now).
    clock = new Date('2027-12-01T09:00:00Z');
    await client.query(`UPDATE contact_messages SET handled_at = '2026-11-10T11:00:00Z' WHERE id = $1`, [id]);
    // (The daily cron route calls this after the face-data retention run.)
    expect(await contact.prune()).toBe(1);
    const left = await client.query<{ topic: string }>('SELECT topic FROM contact_messages');
    expect(left.rows.map((row) => row.topic)).toEqual(['privacy']);
    await server.close();
  } finally {
    await client.close();
  }
}, 60_000);
