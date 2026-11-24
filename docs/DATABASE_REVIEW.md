# Database review — 23 November 2026

A deep review of the LASUATOS database layer: the whole schema, every repository, the migrations and triggers, the retention and backup machinery, and the measured behaviour under load. Written to be read once, then kept as the reference for "how healthy is the database, and where are its limits".

## Scope and method

- **Read in full:** all 12 schema files (`packages/database/src/schema/`, 47 tables), all 13 PostgreSQL repositories (~11,400 lines), migrations `0000`–`0035` including every trigger, the rate-limit store, the daily retention run, the backup pipeline, and the connection/pool setup.
- **Evidence used:** the two production-wired load suites (`pnpm load:rush`, `pnpm load:pilot`, `docs/LOAD_TESTING.md`), which ran the real API against a real PostgreSQL seeded to LASU size (20,000 students, ~196,000 attendance rows) and planned the hot queries with `EXPLAIN ANALYZE`; plus current Neon/PgBouncer behaviour checked against vendor documentation and field reports.
- **Not done:** the production Neon instance itself was not profiled (no access to it, and no `pg_stat_statements` yet — see R7). Every claim below is from the code and the load evidence, marked as such.

## Verdict

The database layer is in genuinely good shape — better than most production systems at this age. Integrity is enforced by the database itself (constraints, composite tenant-scoped foreign keys, immutability triggers), writes are idempotent, secrets are stored only as digests, every list read is bounded, and the two hottest minutes of the product's life — the lecture-start rush and the first pilot morning — have been rehearsed against a LASU-sized database with the query plans inspected. The work that remains is operational hardening and knowing the scale boundaries, not redesign.

## What is done well, and why it matters

**Tenancy cannot leak.** Every tenant-owned table carries `institution_id`, foreign keys are composite `(id, institution_id)` → `(id, institution_id)` against matching composite unique indexes, and deletes are `restrict`. A join that forgot the tenant simply cannot resolve. This is the strongest available defence against the classic multi-tenant bug, and it is enforced by PostgreSQL, not by reviewers.

**Integrity lives in the database.** ~40 check constraints keep impossible states unrepresentable (a closed session must have `closed_at`; a resolved dispute must have resolver, note and time; coordinates must be on Earth; a revoked record must say when). Partial unique indexes encode the one-live-thing rules (one open dispute per student per session, one unrevoked enrollment code per offering, one current academic session per institution, one live class-rep appointment per student). Expression unique indexes make emails case-insensitive (`lower(email)`) without trusting the app to normalise.

**Audit trails are append-only in the database.** Triggers reject `UPDATE` and `DELETE` on `attendance_corrections`, `staff_audit_events`, `structure_audit_events` and `student_audit_events`; guard triggers make decided disputes and appeals immutable. A compromised or buggy application cannot rewrite history — it physically cannot issue the statement.

**Writes are idempotent.** Check-in inserts use `ON CONFLICT (session, matric) DO NOTHING` and then read the winner, so a retried submit answers "already marked present" instead of duplicating; the rush test verified 0 duplicates across 1,800 same-instant check-ins. Face registration and the rate-limit counter use the same pattern. Retries — from flaky campus networks, from the phone's own busy-retry loop — are free.

**Secrets are digests.** Sessions, email codes, setup codes, password resets, invitations, enrollment codes and rate-limit keys are stored only as SHA-256 hashes. A full database read (or a leaked backup that missed the encryption) yields no usable credential.

**Nothing sensitive is kept longer than its purpose.** The daily cron (`/api/v1/cron/retention`, Vercel Cron 02:30) prunes ended sessions and spent codes after a day's grace, contact messages, alert history (30 days), email-provider daily counters and backup reports (90 days), and face photos past their review window (the governance policy). The privacy notice can say how long things are kept and be true.

**The hot paths are measured, and were fixed where they hurt.** Sign-in by matric number uses an expression index (`student_profiles_matric_key_idx`, migration 0033) instead of scanning every student. Session resolution — the query every signed-in request starts with — is one indexed round trip for a student (down from three), with "last seen" written at most every five minutes. The duplicate-face check reads packed float32 centroids (a third of the JSON size, nothing to parse). The face models run on a worker thread with admission control, so a face queue can never stall scans, the projector or the lecturer's list. Round trips per request are known per route (see below).

**Operations are treated as part of the design.** Migrations apply on deploy before the build (a failed migration keeps the old deployment live), the API refuses to serve when the schema ledger is behind, the nightly backup is encrypted and *restore-verified* before it is kept, the production connection goes through Neon's pooler, and System health exposes this instance's pool statistics.

## Measured today

From `docs/LOAD_TESTING.md` (production wiring, real PostgreSQL, LASU-sized seed):

| Path | Result |
| --- | --- |
| 300-student face-check rush, 2 instances | 300/300 recorded, submit p95 5.8 s, zero errors |
| Session read (`GET /auth/session`) | 73 / 131 ms (p50/p95) at **1,228 reads/second** on one small instance |
| Sign in | 103 / 279 ms |
| Check-in without face (900 students, 3 halls) | 900/900, p95 39 ms |
| Round trips per request | session 1, sign-in ~6, attendance page ~3 per read, check-in ~5 |

Every route's queries were planned with `EXPLAIN ANALYZE` on the seeded database; the hot ones are index probes, and a test fails the build if the sign-in query ever degenerates into a scan again.

## Findings and recommendations

Ranked. Only R1 needs action now; it shipped with this review.

### R1 — Give the database role a statement timeout (done)

**Found:** the app pool sets connection and idle timeouts, but no `statement_timeout`: one slow statement would hold one of the instance's three pooled connections until the platform killed the whole request (30 s), turning one bad query into instance-wide queueing.

**Subtlety, researched:** Neon's pooler (PgBouncer, transaction mode) **rejects** timeouts sent as connection startup options (`unsupported startup parameter in options: statement_timeout`) — the app would fail to connect at all. Session-level `SET` does not survive transaction pooling either. The form that works through both the pooler and the direct connection is a **role default**.

**Done:** `docs/DEPLOYMENT.md` now has the one-time SQL-editor step (`alter role neondb_owner set statement_timeout = '15s';` plus `idle_in_transaction_session_timeout = '30s'`), and `scripts/backup/tools.mjs` exempts the nightly `pg_dump` from it (`PGOPTIONS=-c statement_timeout=0`, safe because the backup uses the direct connection), so a growing database can never make the dump hit the cap. 15 s is far above every legitimate statement (all are milliseconds) and just under the face-queue budget.

### R2 — The duplicate-face search is a deliberate, bounded full scan (know the boundary)

At registration, every other face centroid in the institution is read and compared in memory to catch one face registering twice. This is O(institution faces) per registration: packed, that is ~0.5 KB per face — ~7 MB at 14,000 faces, ~25 MB at 50,000 — plus 128-float dot products, which are microseconds each. Registration happens once per student and is off the check-in path, so this is fine well past pilot scale. **Boundary:** past roughly 50,000 registered faces, move the duplicate search to `pgvector` (Neon supports it) with an HNSW index over the centroid. Do not do this now: it adds an extension, a migration and operational surface for a path that is not slow.

### R3 — Typed rotating codes resolve by a bounded linear scan (know it)

A student who types the rotating code instead of scanning is matched by trying the code against every currently open dynamic session (`listOpenDynamicSessions`, capped at 2,000) — HMAC comparisons in memory, microseconds each. Correct and fast at any realistic number of simultaneous classes (hundreds). **Boundary:** if the whole university ever runs thousands of sessions at once, prefix the typed code with a session-derived fragment so the lookup is direct. Not worth changing before then.

### R4 — Two attendance stores is a product split, not a defect (leave it)

`attendance_records` (enrolled-course offerings, corrections, disputes) and `lecture_attendance` (quick sessions anyone can join with a code) are separate tables with separate rules. Merging them would couple two deliberately different lifecycles; both measured hot paths are fast. Revisit only if reporting across both ever becomes a product requirement — and then with a read model, not a merge.

### R5 — Random UUID primary keys fragment over years (low priority)

`gen_random_uuid()` (v4) inserts in random order, so the B-trees of insert-heavy tables (`lecture_attendance`, `attendance_records`) slowly lose locality — a few percent of buffer efficiency per year at these volumes, repairable online with `REINDEX CONCURRENTLY`. UUIDv7 (time-ordered) removes the effect; PostgreSQL 18 ships it natively. **Do nothing now**; note it for the eventual Postgres 18 upgrade.

### R6 — ANALYZE after bulk class-list imports (ops habit)

A class-list import changes thousands of rows in one transaction. Autovacuum/auto-analyze will refresh planner statistics within the hour, and Neon manages this; running `ANALYZE class_list_entries; ANALYZE student_profiles;` right after a big import makes the first hour's plans exactly right too. Cheap, harmless, worth doing at each intake.

### R7 — Turn on `pg_stat_statements` on Neon (one toggle, then a quarterly look)

This review could not profile the live instance. Neon supports the `pg_stat_statements` extension from the console; enabling it and glancing at top-by-total-time once a term closes the last observability gap. Combined with the pool stats already on System health, that is full visibility.

### R8 — Rate-limit hot keys under one campus address (watch only)

Every rule hit is one upsert on one row per policy+subject; a whole class behind campus NAT shares the per-address rows, so those rows serialize briefly under a rush. Measured: 330 sign-ins in two minutes from one address passed with room, and the 429-refusal burst alerts exist (ADR 036). Only revisit if per-address limits ever need to be far higher.

### R9 — Pool sizing is already right (no change)

Three connections per serverless instance (ten standalone), all client concurrency multiplexed by Neon's pooler. Small pools per instance are the correct serverless posture; the load suites ran exactly this configuration. Do not "tune up": more connections per instance would make cold instances heavier and help nothing.

## Growth and storage math

Honest projections, using measured row shapes (check-in ≈ 250–400 bytes with its indexes; a face profile ≈ 10–12 KB with photo and signatures):

| Data | Pilot year (≈3,000 students) | University year (≈30,000 students) |
| --- | --- | --- |
| Quick-session attendance (≈5 marks/student/day, 190 days) | ≈2.9M rows, ≈1 GB | ≈29M rows, ≈8–10 GB |
| Face profiles (once per student) | ≈35 MB | ≈350 MB |
| Sessions, codes, audit, everything else | tens of MB (most pruned) | low hundreds of MB |

Against Neon Free (1 GB): the pilot fits for about a year; the university does not — which is already what the cost document says (Neon Launch, ~$15/mo, is on the growth ladder). The real long-term lever is an **attendance-row retention policy** (how many years stay online vs. archived into the encrypted backup store) — a decision to make with the university, since audit-keeping argues for keeping and storage cost argues for archiving. Both directions are easy later; neither is needed now.

## What was deliberately not recommended

- **No cache layer (Redis etc.).** Hot reads are 1–4 indexed round trips already; a cache would add a failure mode and an invalidation problem for milliseconds.
- **No read replicas.** Reads are index probes; Neon Free has no replicas and nothing measured needs one.
- **No table partitioning.** Millions of rows per year is years away from needing it, and it complicates every future migration.
- **No PostGIS.** Venue checks are a circle or a ≤24-point outline evaluated in app code on one row; the geography workload does not exist.
- **No materialized views.** The summary queries are small aggregations over indexed rows.
- **No schema "unification" of the two attendance stores.** See R4.

## Limits of this review

Everything above is static analysis of the code and schema, the existing load evidence, and vendor documentation. The production database was not inspected (no production access, no `pg_stat_statements` yet — R7). The growth figures are estimates from row shapes, not measurements of the live database. Where the two disagree in future, believe the measurement.
