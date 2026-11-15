import { randomInt } from 'node:crypto';
import {
  CONTACT_TOPIC_LABELS,
  type ContactInbox,
  type ContactMessage,
  type ContactMessageInput,
  type ContactMessageStatus,
  type ContactTopic,
} from '@lasuatos/contracts';
import type { AuthenticatedAccount } from '../auth/repository.js';
import type { ContactMessageRow, ContactRecipient, ContactRepository, NewContactMessage } from './repository.js';

export class ContactError extends Error {
  readonly exposeDetail = true;
  constructor(readonly statusCode: number, message: string) {
    super(message);
    this.name = 'ContactError';
  }
}

/** What the team is told about a new message (the email is sent with Reply-To: the sender). */
export interface ContactTeamNotice {
  readonly to: ContactRecipient;
  readonly reference: string;
  readonly topicLabel: string;
  readonly senderName: string;
  readonly senderEmail: string;
  /** What the sender told us beyond name, email and topic (role, department, matric…). */
  readonly facts: readonly { readonly label: string; readonly value: string; readonly mono?: boolean }[];
  /** Whether the sender was signed in to the account that uses this email. */
  readonly signedIn: boolean;
  readonly message: string;
  readonly receivedAt: Date;
}

/** The sender's receipt. Never repeats the message itself, so the form cannot be used to send text to strangers. */
export interface ContactReceipt {
  readonly to: string;
  readonly name: string;
  readonly reference: string;
  readonly topicLabel: string;
}

export interface ContactNotifier {
  sendContactToTeam(notice: ContactTeamNotice): Promise<void>;
  sendContactReceipt(receipt: ContactReceipt): Promise<void>;
}

export interface ContactServiceOptions {
  readonly repository: ContactRepository;
  readonly notifier?: ContactNotifier | undefined;
  /** Used when no institution administrator is active yet (normally ALERT_EMAIL). */
  readonly fallbackRecipients?: readonly string[];
  readonly logger?: { warn(details: Record<string, unknown>, message: string): void };
  readonly now?: () => Date;
}

const PAGE_SIZE = 30;
/** Bots post the moment the page loads; nobody writes a useful message in under 3 seconds. */
const MIN_FILL_MILLISECONDS = 3_000;
const MAX_LINKS = 3;
const HANDLED_KEEP_DAYS = 365;
const ANY_KEEP_DAYS = 730;
// No 0/O or 1/I: references are read out over the phone and typed back.
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

const ROLE_FACT: Record<string, string> = {
  student: 'Student',
  class_rep: 'Class rep (HOC or GHOC)',
  lecturer: 'Lecturer',
  administrator: 'HOD, dean or administrator',
  university_staff: 'Other university staff',
  other: 'Someone else',
};

const PRIVACY_FACT: Record<string, string> = {
  copy: 'A copy of their data',
  correct: 'Correct something about them',
  delete_face: 'Delete their face data',
  object: 'Object to how their data is used',
  other: 'Another privacy question',
};

export function newContactReference(): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) code += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return `LA-${code}`;
}

function isUniqueViolation(error: unknown): boolean {
  const value = error as { code?: unknown; cause?: { code?: unknown } } | null;
  return value?.code === '23505' || value?.cause?.code === '23505';
}

function countLinks(text: string): number {
  return (text.match(/https?:\/\/|www\./gi) ?? []).length;
}

function encodeCursor(row: Pick<ContactMessageRow, 'createdAt' | 'id'>): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { at: Date; id: string } | null {
  const [at, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  const date = new Date(at ?? '');
  if (Number.isNaN(date.getTime()) || !id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  return { at: date, id };
}

/** Only the fields that belong to the topic are kept, so a message never carries stray data. */
function fieldsFor(topic: ContactTopic, input: ContactMessageInput) {
  const isStudent = input.role === 'student' || input.role === 'class_rep';
  return {
    role: input.role ?? null,
    department: input.department ?? null,
    matricNumber: isStudent && (topic === 'privacy' || topic === 'account' || topic === 'problem') ? input.matricNumber ?? null : null,
    privacyRequest: topic === 'privacy' ? input.privacyRequest ?? 'other' : null,
    page: topic === 'problem' ? input.page ?? null : null,
    device: topic === 'problem' ? input.device ?? null : null,
    students: topic === 'adoption' ? input.students ?? null : null,
  };
}

/**
 * Messages to the LASUATOS team from the public contact page: saved first (so
 * nothing is lost), then emailed to the institution administrators with the
 * sender as Reply-To, and a short receipt sent to the sender.
 */
export class ContactService {
  readonly #repository: ContactRepository;
  readonly #notifier: ContactNotifier | undefined;
  readonly #fallbackRecipients: readonly string[];
  readonly #logger: ContactServiceOptions['logger'];
  readonly #now: () => Date;

  constructor(options: ContactServiceOptions) {
    this.#repository = options.repository;
    this.#notifier = options.notifier;
    this.#fallbackRecipients = options.fallbackRecipients ?? [];
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
  }

  /**
   * Saves a message and returns its reference. Spam (the hidden field filled
   * in, or a form posted within seconds) gets a convincing reference too, but
   * is neither saved nor emailed, so bots learn nothing.
   * `delivered` resolves when the emails have been handed over (or failed).
   */
  async submit(input: ContactMessageInput, sender: AuthenticatedAccount | null): Promise<{ readonly reference: string; readonly delivered: Promise<void> }> {
    if (input.website || (input.elapsedMs !== undefined && input.elapsedMs < MIN_FILL_MILLISECONDS)) {
      this.#logger?.warn({ event: 'contact_spam_dropped', reason: input.website ? 'honeypot' : 'too_fast' }, 'Contact message dropped as spam');
      return { reference: newContactReference(), delivered: Promise.resolve() };
    }
    if (countLinks(input.message) > MAX_LINKS) {
      throw new ContactError(400, `Include at most ${MAX_LINKS} links in your message.`);
    }
    const now = this.#now();
    const signedIn = sender !== null && sender.email.toLowerCase() === input.email;
    const base = {
      topic: input.topic,
      name: input.name.replace(/\s+/g, ' '),
      email: input.email,
      ...fieldsFor(input.topic, input),
      message: input.message,
      senderUserId: signedIn ? sender.id : null,
      createdAt: now,
    };
    let saved: NewContactMessage | null = null;
    for (let attempt = 0; attempt < 4 && !saved; attempt += 1) {
      const candidate: NewContactMessage = { ...base, reference: newContactReference() };
      try {
        await this.#repository.create(candidate);
        saved = candidate;
      } catch (error) {
        if (!isUniqueViolation(error) || attempt === 3) throw error;
      }
    }
    if (!saved) throw new Error('No free message reference.');
    return { reference: saved.reference, delivered: this.#notify(saved) };
  }

  async #notify(message: NewContactMessage): Promise<void> {
    const notifier = this.#notifier;
    if (!notifier) return;
    const topicLabel = CONTACT_TOPIC_LABELS[message.topic];
    let recipients: ContactRecipient[] = [];
    try {
      recipients = await this.#repository.teamRecipients();
    } catch {
      recipients = [];
    }
    if (recipients.length === 0) recipients = this.#fallbackRecipients.map((email) => ({ email, displayName: 'LASUATOS team' }));
    const facts = [
      message.role ? { label: 'Role', value: ROLE_FACT[message.role] ?? message.role } : null,
      message.department ? { label: 'Department or unit', value: message.department } : null,
      message.matricNumber ? { label: 'Matric number', value: message.matricNumber, mono: true } : null,
      message.privacyRequest ? { label: 'Request', value: PRIVACY_FACT[message.privacyRequest] ?? message.privacyRequest } : null,
      message.students ? { label: 'Students', value: `About ${message.students.toLocaleString('en-NG')}` } : null,
      message.page ? { label: 'Where', value: message.page } : null,
      message.device ? { label: 'Device', value: message.device } : null,
    ].filter((fact) => fact !== null);
    const sends = [
      ...recipients.map((to) => notifier.sendContactToTeam({
        to,
        reference: message.reference,
        topicLabel,
        senderName: message.name,
        senderEmail: message.email,
        facts,
        signedIn: Boolean(message.senderUserId),
        message: message.message,
        receivedAt: message.createdAt,
      })),
      notifier.sendContactReceipt({ to: message.email, name: message.name, reference: message.reference, topicLabel }),
    ];
    const results = await Promise.allSettled(sends);
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) this.#logger?.warn({ event: 'contact_email_failed', failed, reference: message.reference }, 'Some contact emails were not sent; the message is saved');
  }

  #requireTeam(account: AuthenticatedAccount): void {
    if (account.accountType !== 'administrator' || account.role !== 'institution_administrator') {
      throw new ContactError(403, 'Only institution administrators can read messages to the team.');
    }
  }

  #toMessage(row: ContactMessageRow): ContactMessage {
    return {
      id: row.id,
      reference: row.reference,
      topic: row.topic,
      status: row.status,
      name: row.name,
      email: row.email,
      role: row.role,
      department: row.department,
      matricNumber: row.matricNumber,
      privacyRequest: row.privacyRequest,
      page: row.page,
      device: row.device,
      students: row.students,
      message: row.message,
      signedIn: row.senderUserId !== null,
      createdAt: row.createdAt.toISOString(),
      handledAt: row.handledAt ? row.handledAt.toISOString() : null,
      handledByName: row.handledByName,
    };
  }

  async inbox(account: AuthenticatedAccount, query: { readonly status?: 'new' | 'handled' | 'all' | undefined; readonly topic?: ContactTopic | undefined; readonly cursor?: string | undefined }): Promise<ContactInbox> {
    this.#requireTeam(account);
    const before = query.cursor ? decodeCursor(query.cursor) : null;
    if (query.cursor && !before) throw new ContactError(400, 'That page link is not valid. Reload the messages.');
    const [rows, counts] = await Promise.all([
      this.#repository.list({
        status: query.status === 'all' ? undefined : query.status ?? 'new',
        topic: query.topic,
        before: before ?? undefined,
        limit: PAGE_SIZE + 1,
      }),
      this.#repository.counts(),
    ]);
    const page = rows.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      messages: page.map((row) => this.#toMessage(row)),
      nextCursor: rows.length > PAGE_SIZE && last ? encodeCursor(last) : null,
      counts,
    };
  }

  async newCount(account: AuthenticatedAccount): Promise<{ readonly new: number }> {
    this.#requireTeam(account);
    const counts = await this.#repository.counts();
    return { new: counts.new };
  }

  async setStatus(account: AuthenticatedAccount, id: string, status: ContactMessageStatus): Promise<ContactMessage> {
    this.#requireTeam(account);
    const row = await this.#repository.setStatus({ id, status, actorUserId: account.id, now: this.#now() });
    if (!row) throw new ContactError(404, 'That message no longer exists.');
    return this.#toMessage(row);
  }

  /** Daily: handled messages go after a year, anything after two. */
  async prune(): Promise<number> {
    const now = this.#now().getTime();
    return this.#repository.prune({
      handledBefore: new Date(now - HANDLED_KEEP_DAYS * 86_400_000),
      anyBefore: new Date(now - ANY_KEEP_DAYS * 86_400_000),
    });
  }
}
