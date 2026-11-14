import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity.js';

/**
 * Messages sent to the LASUATOS team from the public contact page. Kept so a
 * message is never lost when an email bounces; institution administrators read
 * them in Administration → Messages. Handled messages are deleted after 12
 * months, any message after 24 (see the daily retention run).
 */
export const contactMessages = pgTable(
  'contact_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reference: varchar('reference', { length: 12 }).notNull(),
    topic: varchar('topic', { length: 16 }).notNull(),
    status: varchar('status', { length: 12 }).notNull().default('new'),
    name: varchar('name', { length: 120 }).notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    role: varchar('role', { length: 24 }),
    department: varchar('department', { length: 160 }),
    matricNumber: varchar('matric_number', { length: 20 }),
    privacyRequest: varchar('privacy_request', { length: 16 }),
    page: varchar('page', { length: 200 }),
    device: varchar('device', { length: 300 }),
    students: integer('students'),
    message: text('message').notNull(),
    /** The account that sent it, when the sender was signed in. */
    senderUserId: uuid('sender_user_id').references(() => users.id, { onDelete: 'set null' }),
    handledAt: timestamp('handled_at', { withTimezone: true, mode: 'date' }),
    handledByUserId: uuid('handled_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('contact_messages_reference_uq').on(table.reference),
    index('contact_messages_status_created_idx').on(table.status, table.createdAt),
    index('contact_messages_created_idx').on(table.createdAt),
    check('contact_messages_topic_ck', sql`${table.topic} IN ('adoption', 'problem', 'account', 'privacy', 'other')`),
    check('contact_messages_status_ck', sql`${table.status} IN ('new', 'handled')`),
    check('contact_messages_message_length_ck', sql`char_length(${table.message}) BETWEEN 1 AND 3000`),
    check('contact_messages_handled_ck', sql`(${table.status} = 'handled') = (${table.handledAt} IS NOT NULL)`),
  ],
);
