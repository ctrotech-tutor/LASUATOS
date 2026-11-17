import { sql } from 'drizzle-orm';
import { check, date, index, integer, pgTable, primaryKey, timestamp, uuid, varchar } from 'drizzle-orm/pg-core';

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

/**
 * One row per email provider per UTC day (ADR 029): how many messages it
 * delivered and how many it refused, the last refusal (reason with
 * credentials removed) and, when it is out of quota or misconfigured, until
 * when every API instance should skip it and use the next provider. Holds no
 * recipient addresses or message content. Rows older than 90 days are pruned
 * by the daily retention run.
 */
export const emailProviderDays = pgTable(
  'email_provider_days',
  {
    provider: varchar('provider', { length: 16 }).notNull(),
    day: date('day', { mode: 'string' }).notNull(),
    sent: integer('sent').notNull().default(0),
    failed: integer('failed').notNull().default(0),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true, mode: 'date' }),
    lastFailureAt: timestamp('last_failure_at', { withTimezone: true, mode: 'date' }),
    lastFailureKind: varchar('last_failure_kind', { length: 16 }),
    lastFailureReason: varchar('last_failure_reason', { length: 400 }),
    pausedUntil: timestamp('paused_until', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    primaryKey({ name: 'email_provider_days_pk', columns: [table.provider, table.day] }),
    check('email_provider_days_provider_ck', sql`${table.provider} IN ('brevo', 'gmail', 'resend', 'mailpit')`),
    check('email_provider_days_counts_ck', sql`${table.sent} >= 0 AND ${table.failed} >= 0`),
  ],
);

/**
 * Operator alerts as they were raised (ADR 029), for the administrators'
 * System health page: what went wrong and whether it was emailed or held back
 * as a repeat. Only the one-line summary is kept (no request details, no
 * personal data). Pruned after 30 days by the daily retention run.
 */
export const operatorAlertEvents = pgTable(
  'operator_alert_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: varchar('kind', { length: 32 }).notNull(),
    summary: varchar('summary', { length: 300 }).notNull(),
    fingerprint: varchar('fingerprint', { length: 24 }).notNull(),
    outcome: varchar('outcome', { length: 12 }).notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('operator_alert_events_occurred_idx').on(table.occurredAt),
    check('operator_alert_events_outcome_ck', sql`${table.outcome} IN ('emailed', 'throttled', 'logged')`),
  ],
);
