import type { DatabaseClient } from '@lasuatos/database';
import { sql } from 'drizzle-orm';

const DAY = 86_400_000;

/**
 * How long an ended sign-in or a spent code stays before the daily retention
 * run deletes it. A day is enough for "that code has expired" and for a
 * session to be shown as signed out; the email-code daily cap is a 24-hour
 * window from the first code, so it has closed by then too.
 */
export const ENDED_SIGN_IN_GRACE_DAYS = 1;

export interface SignInCleanupResult {
  /** Sign-ins (user_sessions) that ended: signed out, replaced or expired. */
  readonly sessions: number;
  /** Email codes, setup codes, password-reset and email-confirmation links. */
  readonly codes: number;
}

const count = (result: unknown) => Number((result as { rows?: { count?: number | string }[] }).rows?.[0]?.count ?? 0);

/**
 * Data minimisation for sign-ins (docs/DECISIONS.md, ADR 032). Sessions and
 * codes are stored only as hashes, but nothing needs them once they have
 * ended, so the privacy notice can say how long they are kept and mean it.
 *
 * Each person's most recent sign-in is kept even after it ends: it is the
 * "last active" date administrators see on the staff list, and holds only a
 * dead token hash and two dates.
 */
export class SignInCleanup {
  readonly #database: DatabaseClient;
  readonly #now: () => Date;

  constructor(database: DatabaseClient, now: () => Date = () => new Date()) {
    this.#database = database;
    this.#now = now;
  }

  async prune(): Promise<SignInCleanupResult> {
    const cutoff = new Date(this.#now().getTime() - ENDED_SIGN_IN_GRACE_DAYS * DAY).toISOString();
    const sessions = count(await this.#database.execute(sql`
      with gone as (
        delete from user_sessions s
        where (s.expires_at < ${cutoff}::timestamptz or s.revoked_at < ${cutoff}::timestamptz)
          and exists (
            select 1 from user_sessions newer
            where newer.user_id = s.user_id and newer.id <> s.id
              and (coalesce(newer.last_seen_at, newer.created_at), newer.id) > (coalesce(s.last_seen_at, s.created_at), s.id)
          )
        returning 1
      )
      select count(*)::int as count from gone
    `));
    let codes = 0;
    codes += count(await this.#database.execute(sql`
      with gone as (delete from email_verification_tokens where expires_at < ${cutoff}::timestamptz returning 1)
      select count(*)::int as count from gone
    `));
    codes += count(await this.#database.execute(sql`
      with gone as (delete from password_reset_tokens where expires_at < ${cutoff}::timestamptz returning 1)
      select count(*)::int as count from gone
    `));
    codes += count(await this.#database.execute(sql`
      with gone as (
        delete from student_email_codes
        where expires_at < ${cutoff}::timestamptz and window_started_at < ${cutoff}::timestamptz
        returning 1
      )
      select count(*)::int as count from gone
    `));
    codes += count(await this.#database.execute(sql`
      with gone as (delete from student_setup_codes where expires_at < ${cutoff}::timestamptz returning 1)
      select count(*)::int as count from gone
    `));
    return { sessions, codes };
  }
}
