/**
 * The newest migration shipped with this code. The readiness check compares it with
 * what the database has applied, so a deploy whose database was not migrated shows up
 * as `schema: "behind"` instead of failing later on a missing table.
 *
 * Keep in sync with drizzle/migrations/meta/_journal.json (a test enforces this).
 */
export const LATEST_MIGRATION = {
  tag: '0029_dispute_appeals',
  createdAt: 1794922080219,
} as const;

export type SchemaStatus = 'current' | 'behind' | 'unknown';
