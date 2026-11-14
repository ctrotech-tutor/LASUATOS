/**
 * The newest migration shipped with this code. The readiness check compares it with
 * what the database has applied, so a deploy whose database was not migrated shows up
 * as `schema: "behind"` instead of failing later on a missing table.
 *
 * Keep in sync with drizzle/migrations/meta/_journal.json (a test enforces this).
 */
export const LATEST_MIGRATION = {
  tag: '0022_face_reviews_help_requests',
  createdAt: 1794659557345,
} as const;

export type SchemaStatus = 'current' | 'behind' | 'unknown';
