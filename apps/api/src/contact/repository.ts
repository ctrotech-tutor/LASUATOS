import type { ContactMessageStatus, ContactPrivacyRequest, ContactRole, ContactTopic } from '@lasuatos/contracts';

export interface NewContactMessage {
  readonly reference: string;
  readonly topic: ContactTopic;
  readonly name: string;
  readonly email: string;
  readonly role: ContactRole | null;
  readonly department: string | null;
  readonly matricNumber: string | null;
  readonly privacyRequest: ContactPrivacyRequest | null;
  readonly page: string | null;
  readonly device: string | null;
  readonly students: number | null;
  readonly message: string;
  readonly senderUserId: string | null;
  readonly createdAt: Date;
}

export interface ContactMessageRow extends NewContactMessage {
  readonly id: string;
  readonly status: ContactMessageStatus;
  readonly handledAt: Date | null;
  readonly handledByName: string | null;
  readonly note: string | null;
}

export interface ContactListFilter {
  readonly status?: ContactMessageStatus | undefined;
  readonly topic?: ContactTopic | undefined;
  /** A reference (exact) or words in the name, email or message. */
  readonly query?: string | undefined;
  /** Keyset pagination: messages strictly older than this one. */
  readonly before?: { readonly at: Date; readonly id: string } | undefined;
  readonly limit: number;
}

export interface ContactBriefRow {
  readonly id: string;
  readonly reference: string;
  readonly name: string;
  readonly topic: ContactTopic;
  readonly privacyRequest: ContactPrivacyRequest | null;
  readonly createdAt: Date;
}

export interface ContactSummaryRow {
  /** Every new message (briefly), oldest first. */
  readonly newMessages: readonly ContactBriefRow[];
  readonly handledSince: number;
  readonly medianHandleHours: number | null;
}

export interface ContactRecipient {
  readonly email: string;
  readonly displayName: string;
}

export interface ContactRepository {
  /** Fails with a unique violation (code 23505) when the reference is taken. */
  create(message: NewContactMessage): Promise<{ readonly id: string }>;
  list(filter: ContactListFilter): Promise<ContactMessageRow[]>;
  counts(): Promise<{ readonly new: number; readonly handled: number }>;
  /** The inbox at a glance: new messages by topic, open privacy requests, handled lately. */
  summary(input: { readonly handledSince: Date; readonly medianSince: Date }): Promise<ContactSummaryRow>;
  findByReference(reference: string): Promise<ContactMessageRow | null>;
  /** Other messages from one email address, newest first. */
  listByEmail(input: { readonly email: string; readonly excludeId: string; readonly limit: number }): Promise<ContactMessageRow[]>;
  /**
   * Marks a message handled (with an optional note) or new again. Marking an already handled
   * message handled only changes the note: who handled it, and when, stay.
   */
  setStatus(input: { readonly id: string; readonly status: ContactMessageStatus; readonly note: string | null; readonly actorUserId: string; readonly now: Date }): Promise<ContactMessageRow | null>;
  /** Active institution administrators: they are told about new messages. */
  teamRecipients(): Promise<ContactRecipient[]>;
  /** Deletes handled messages older than `handledBefore` and every message older than `anyBefore`. */
  prune(input: { readonly handledBefore: Date; readonly anyBefore: Date }): Promise<number>;
}
