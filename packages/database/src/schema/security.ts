import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, timestamp, varchar } from 'drizzle-orm/pg-core';

/**
 * Fixed-window request counters shared by every API instance. `key_hash` is a
 * SHA-256 digest of the policy name and subject (client address, normalized
 * email or session), so raw addresses and emails are never stored here. Rows
 * are disposable: expired windows are reset on the next hit and pruned.
 */
export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    keyHash: varchar('key_hash', { length: 64 }).primaryKey(),
    count: integer('count').notNull(),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
  (table) => [
    index('rate_limit_counters_expiry_idx').on(table.expiresAt),
    check('rate_limit_counters_count_ck', sql`${table.count} > 0`),
  ],
);
