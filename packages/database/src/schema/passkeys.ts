import { sql } from 'drizzle-orm';
import { bigint, boolean, check, index, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { users } from './identity.js';
import { bytea } from './students.js';

/**
 * Passkeys for staff sign-in (ADR 037): one row per passkey a lecturer or
 * administrator added. Only the public half is stored: the private key never
 * leaves the person's phone, computer or password manager, so a copy of this
 * table cannot be used to sign in. `credential_id` is the base64url ID the
 * browser hands back; `sign_count` catches a cloned security key (synced
 * passkeys always report 0). Deleted with the account (accounts are not
 * normally deleted; they are suspended or closed, which already stops sign-in).
 */
export const passkeys = pgTable(
  'passkeys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    credentialId: varchar('credential_id', { length: 1400 }).notNull(),
    publicKey: bytea('public_key').notNull(),
    signCount: bigint('sign_count', { mode: 'number' }).notNull().default(0),
    /** How the browser can reach it: internal, hybrid (a phone), usb, nfc, ble… */
    transports: text('transports').array().notNull().default(sql`'{}'::text[]`),
    /** Synced across the person's devices (Google Password Manager, iCloud Keychain). */
    backedUp: boolean('backed_up').notNull().default(false),
    /** Which password manager or security key made it, when the browser says (all zeros otherwise). */
    aaguid: varchar('aaguid', { length: 36 }),
    /** The person's own label, prefilled from the password manager or the browser. */
    name: varchar('name', { length: 60 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    uniqueIndex('passkeys_credential_id_uq').on(table.credentialId),
    index('passkeys_user_idx').on(table.userId),
    check('passkeys_sign_count_ck', sql`${table.signCount} >= 0`),
    check('passkeys_name_ck', sql`length(btrim(${table.name})) > 0`),
  ],
);

/**
 * One-time WebAuthn challenges, five minutes each. A challenge is deleted when
 * it is used (`DELETE … RETURNING`), so a signed answer cannot be replayed, and
 * expired ones go with the daily clean-up. `user_id` is set for adding a
 * passkey (the challenge belongs to that account) and empty for signing in,
 * where the passkey itself says whose it is.
 */
export const passkeyChallenges = pgTable(
  'passkey_challenges',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    challenge: varchar('challenge', { length: 128 }).notNull(),
    purpose: varchar('purpose', { length: 16 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('passkey_challenges_expiry_idx').on(table.expiresAt),
    check('passkey_challenges_purpose_ck', sql`${table.purpose} IN ('register', 'sign_in')`),
    check('passkey_challenges_owner_ck', sql`(${table.purpose} = 'register') = (${table.userId} IS NOT NULL)`),
  ],
);
