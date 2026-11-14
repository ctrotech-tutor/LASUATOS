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

Migration `0011` adds staff provisioning:
- **Enums:** `staff_invitation_role` (`lecturer`, `department_administrator`, `faculty_administrator`, `institution_administrator`) and `staff_audit_action` (`invitation_created`, `invitation_resent`, `invitation_revoked`, `invitation_accepted`, `staff_suspended`, `staff_reactivated`).
- **`staff_invitations`:** the invitee's email, name and role, a faculty or department reference (tenant-aware composite foreign keys), the staff number, a unique SHA-256 `token_hash`, `sent_at`/`expires_at`, the inviting user (nullable for the bootstrap command) and the accept or revoke outcome. Checks require:
  - the scope columns to match the role (institution: none; faculty administrator: faculty; department administrator and lecturer: department);
  - a staff number (optional, migration 0020) only on lecturer invitations;
  - at most one outcome, with its actor and time.
  A partial unique index on `lower(email)` allows only one pending invitation per address per institution.
- **`staff_audit_events`:** an append-only log of actor, action, target user or invitation, reason and time. A hand-written `BEFORE UPDATE OR DELETE` trigger rejects changes.

Migration `0012` adds QR, device and level columns:
- `attendance_sessions.qr_only` (default `false`): typed codes are refused while it is on.
- `attendance_records.device_hash` (nullable, 64 hex characters): SHA-256 of `<sessionId>:<browser token>`, with an index on (session, hash) for the shared-device flag. Hashes cannot be linked across sessions.
- `student_profiles.entry_level` (100, 200 or 300; default 100) for Direct Entry, and a check on `entry_year`.
- `departments.programme_years` (1–8, default 4), which caps the derived level.

Migration `0013` adds academic-structure editing:
- **`structure_audit_events`:** institution, acting user, action, target type and id, and a JSON before/after diff, indexed by institution and time and by target. A hand-appended `BEFORE UPDATE OR DELETE` trigger makes it append-only (drizzle-kit does not generate triggers).
- A unique index on (`institution_id`, `upper(code)`) so department codes cannot differ only by case.

Migration `0021` adds class lists and face verification (see [FACE_VERIFICATION.md](FACE_VERIFICATION.md)):
- **`class_list_entries`:** the class data HOCs upload. Matric number (unique per institution), surname, first name, optional middle name, optional LASU email (unique per institution, case-insensitive), department, `entry_year` (the set) and `entry_level` (100, or 200/300 for Direct Entry). `student_user_id` links the account once opened (unique), with `added_by`/`updated_by` users. Indexed by (institution, department, entry year).
- **`student_email_codes`:** one pending code per class-list entry: the SHA-256 of the 6-digit code, the address it went to, attempts, sends in the current day window and expiry. Deleted with the entry.
- **`student_face_profiles`:** one row per student (`ON DELETE CASCADE` with the account): SFace model id, one 128-number template per registration photo, their normalized average, a 200 × 250 JPEG, quality measurements and `consented_at`.
- **`lecture_face_checks`:** one row per lecture and student: match, anti-spoof and liveness scores, `needs_review`, and a photo only when `needs_review`. Cascades with the lecture session and the account.
- **`student_audit_events`:** append-only (a hand-appended `BEFORE UPDATE OR DELETE` trigger) log of class-list imports and edits, account openings, email confirmations, face registrations, resets, refused duplicates and failed face checks. Details never contain photos or face templates.
- `users.password_is_default`: true while the account still uses the starting password `LASU<matric><SURNAME>`.
- `lecture_attendance.face_score`: the check-in's face match score (null when no face check applied).

The migration runs automatically during the Vercel build (`scripts/migrate-on-deploy.mjs`).

Phase 10 also refreshes `user_sessions.last_seen_at` when a session is used, at most once every 5 minutes, so the session list reflects activity without writing on every request.

This sandbox has no `DATABASE_URL`, Docker or PostgreSQL service, so readiness reports `database: not_configured`. Embedded PGlite integration tests apply migrations `0000`–`0013` locally and exercise the attendance, dispute, account-security and staff-provisioning SQL paths, but migration application through the deployed driver, external PostgreSQL services and concurrency tests have not been run here. Local Docker setup is available through `pnpm dev:setup`; it applies migrations only to the guarded `lasuatos_dev` database and creates clearly labelled synthetic demo records, never official University records.
