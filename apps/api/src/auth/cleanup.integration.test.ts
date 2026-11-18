import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import { applyMigrations, ids, seedLecturerFixture } from '../e2e/harness.js';
import { SignInCleanup } from './cleanup.js';

const OTHER = 'c9999999-9999-4999-8999-999999999999';
const NOW = new Date('2026-11-20T08:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

it('deletes ended sign-ins and spent codes after a day, keeping each person’s last sign-in', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);
    await seedLecturerFixture(client);
    await client.query(
      `INSERT INTO users (id, institution_id, email, display_name, status) VALUES ($1, $2, 'other@e2e.invalid', 'Other', 'active')`,
      [OTHER, ids.institution],
    );
    const session = (label: string, user: string, created: string, expires: string, revoked: string | null, seen: string | null) =>
      client.query(
        `INSERT INTO user_sessions (user_id, token_hash, created_at, expires_at, revoked_at, last_seen_at) VALUES ($1, $2, $3, $4, $5, $6)`,
        [user, label.padEnd(64, '0'), created, expires, revoked, seen],
      );
    // The lecturer: an expired sign-in, one signed out three days ago, one live.
    await session('expired', ids.lecturer, ago(45), ago(10), null, ago(40));
    await session('signedout', ids.lecturer, ago(5), ago(-25), ago(3), ago(3));
    await session('signedoutnow', ids.lecturer, ago(2), ago(-28), ago(0.5), ago(0.5));
    await session('live', ids.lecturer, ago(1), ago(-29), null, ago(0));
    // Someone who has not signed in for two months: only their last sign-in stays.
    await session('older', OTHER, ago(120), ago(90), null, ago(95));
    await session('last', OTHER, ago(90), ago(60), null, ago(61));

    await client.query(`INSERT INTO password_reset_tokens (user_id, token_hash, requested_at, expires_at) VALUES ($1, $2, $3, $4)`, [ids.lecturer, 'a'.repeat(64), ago(3), ago(2.9)]);
    await client.query(`INSERT INTO password_reset_tokens (user_id, token_hash, requested_at, expires_at) VALUES ($1, $2, $3, $4)`, [OTHER, 'b'.repeat(64), ago(0.01), ago(-0.01)]);
    await client.query(`INSERT INTO email_verification_tokens (user_id, token_hash, requested_at, expires_at) VALUES ($1, $2, $3, $4)`, [ids.lecturer, 'c'.repeat(64), ago(0.6), ago(0.5)]);
    await client.query(`INSERT INTO email_verification_tokens (user_id, token_hash, requested_at, expires_at) VALUES ($1, $2, $3, $4)`, [OTHER, 'd'.repeat(64), ago(9), ago(8)]);

    const cleanup = new SignInCleanup(drizzle(client) as unknown as DatabaseClient, () => NOW);
    expect(await cleanup.prune()).toEqual({ sessions: 3, codes: 2 });

    const left = await client.query<{ token_hash: string }>(`SELECT token_hash FROM user_sessions ORDER BY created_at`);
    expect(left.rows.map((row) => row.token_hash.replace(/0+$/, ''))).toEqual(['last', 'signedoutnow', 'live']);
    expect((await client.query(`SELECT user_id FROM password_reset_tokens`)).rows).toEqual([{ user_id: OTHER }]);
    expect((await client.query(`SELECT user_id FROM email_verification_tokens`)).rows).toEqual([{ user_id: ids.lecturer }]);

    // Running again changes nothing.
    expect(await cleanup.prune()).toEqual({ sessions: 0, codes: 0 });
  } finally {
    await client.close();
  }
});
