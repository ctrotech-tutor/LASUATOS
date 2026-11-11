# Database

LASUATOS uses PostgreSQL with Drizzle ORM. The schema covers institution, academic, identity, course, attendance-session/record, and authorization-scope records. The student-account slice adds pending verification and server-session storage. It is designed for controlled development but does not contain official LASU records or imported University data.

## Before connecting

- Obtain approval for a dedicated development database and its data-handling rules.
- Use a least-privilege database account and keep credentials in the deployment secret store, never in source control.
- Review and test the migrations against a disposable database before any institutional environment.
- Do not import production student, staff, or course records into local development.

## Local Docker development

The repository includes `compose.yaml` for loopback-only PostgreSQL and Mailpit services. With Docker Engine and Compose installed, copy `.env.example` to `.env`, then run:

```sh
pnpm dev:setup
```

The guarded setup accepts only the `lasuatos_dev` database on a loopback address at the configured Compose port, with matching local Compose credentials. It rejects remote hosts and other local database ports before starting Docker or applying migrations. It applies migrations and seeds only synthetic local demo data: a clearly labelled tenant, demo faculty and department, a future-dated academic session and semester, and a department-scoped lecturer account. These are not official LASU records. No student or official course data is seeded. A generated lecturer password is printed once on first provisioning; alternatively set `LOCAL_DEMO_LECTURER_PASSWORD` in `.env` before the first seed. Mailpit captures student registration confirmation messages at `http://localhost:8025`.

Use synthetic account details only. `docker compose down` stops containers and preserves the named database volume. Removing the volume is destructive and should be done only when the local demo database can be discarded.

## Generate migrations

After changing `packages/database/src/schema`, generate SQL with:

```sh
pnpm db:generate
```

Generated SQL is stored under `packages/database/drizzle/migrations`. Inspect and review it before use. `0002_cloudy_vertigo.sql` makes semester labels institution-defined text rather than a fixed enum. Migration `0003_modern_franklin_richards.sql` adds one-time email-verification token storage, makes student department assignment optional during self-registration, and records whether a matric number has been checked by an authorized source. Migration `0004_short_zarda.sql` adds hashed course enrollment codes with one-active-code-per-offering and expiry constraints. It removes uniqueness on self-reported matric numbers so a typo or unverified claim cannot reserve a number. Migration `0005_zippy_bushwacker.sql` adds timed attendance sessions, hashed check-in codes, and attendance records with tenant-aware foreign keys and one record per student/session. The base migration's unique indexes are ordered before composite foreign keys, as PostgreSQL requires. None of the checked-in migrations has been applied to a database in this sandbox.

## Apply migrations

Set `DATABASE_URL` only after an authorized, dedicated development database has been provisioned. The migration script refuses to start without it:

```sh
DATABASE_URL='postgresql://…' pnpm db:migrate
```

The script invokes Drizzle Kit's migration runner. Do not point it at production or an institutional system without written authorization, a reviewed change plan, backup and recovery arrangements, and an approved maintenance window. Never commit a real connection string.

`packages/database/drizzle.config.ts` is used for schema generation and does not require a live connection. Migration execution is guarded both by `packages/database/scripts/migrate.mjs` and a dedicated migration configuration that requires `DATABASE_URL`.

## Current status

The schema now includes attendance sessions, check-in records with venue evidence, and audited corrections (migration `0008`: `attendance_record_method` gains `manual`; `attendance_records` gains `status` (`present`/`revoked`) and `revoked_at`, with a check that `revoked_at` is set exactly when revoked; and the append-only `attendance_corrections` table, whose trigger rejects `UPDATE` and `DELETE`). Migration `0008` uses `ALTER TYPE … ADD VALUE`. On PostgreSQL versions before 12 that statement cannot run inside a transaction block, so check the deployed migration runner before applying it. Migration `0009` adds student attendance disputes:
- The `attendance_dispute_kind` (`missing_check_in`/`revoked_check_in`) and `attendance_dispute_status` (`open`/`upheld`/`rejected`/`withdrawn`) enums.
- The `attendance_disputes` table:
  - Tenant-aware composite foreign keys to the session/offering, the student profile and the resolving lecturer profile.
  - A partial unique index allowing one `open` dispute per session and student.
  - Indexes for each offering's queue and each student's history.
  - A check that ties `resolved_at`, `resolved_by_user_id` and `resolution_note` to the status.
  - A `BEFORE UPDATE OR DELETE` guard trigger: deletes are rejected, decided or withdrawn disputes are frozen, and submission fields are immutable.
- A nullable `attendance_corrections.dispute_id` foreign key, linking the correction an upheld dispute produced.

Migration `0010` adds account-security storage:
- **`password_reset_tokens`:** at most one row per user (the user id is the primary key, `ON DELETE RESTRICT`). It holds a unique SHA-256 `token_hash`, `requested_at` (used for the two-minute re-issue cooldown), `expires_at` (a check requires it to be after `requested_at`), `consumed_at` and an expiry index. A new request overwrites the row; completing a reset or changing the password sets `consumed_at`.
- **`rate_limit_counters`:** `key_hash` (the primary key: a SHA-256 digest of policy and subject, never a raw address, email or token), `count` (a check requires it to be positive), `window_started_at`, `expires_at` and an expiry index. One `INSERT … ON CONFLICT DO UPDATE` either starts a new window or increments the current one atomically. About 1% of hits delete expired rows.

Phase 10 also refreshes `user_sessions.last_seen_at` when a session is used, at most once every 5 minutes, so the session list reflects activity without writing on every request.

This sandbox has no `DATABASE_URL`, Docker or PostgreSQL service, so readiness reports `database: not_configured`. Embedded PGlite integration tests apply migrations `0000`–`0010` locally and exercise the attendance, dispute and account-security SQL paths, but migration application through the deployed driver, external PostgreSQL services and concurrency tests have not been run here. Local Docker setup is available through `pnpm dev:setup`; it applies migrations only to the guarded `lasuatos_dev` database and creates clearly labelled synthetic demo records, never official University records.
