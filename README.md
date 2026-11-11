# LASUATOS

LASUATOS is a course and attendance platform for Lagos State University. The first academic scope is the Faculty of Engineering, with departments and role-scoped workspaces designed to grow across LASU.

## Current status

The current release includes the student, lecturer and administrator entry paths; server-managed accounts and sessions; department-scoped course setup; student self-enrollment by lecturer-issued code; and an administrator overview limited to each assigned LASU scope. These workflows require a configured database. Student email confirmation proves mailbox access only, and a matric number is not checked against an official LASU identity source. Attendance sessions, venue verification and QR check-in are not part of this release.

No official institutional, student, staff, course or venue records are seeded. The guarded local setup creates only clearly labelled synthetic data under `LASUATOS local demo tenant`, including a demo faculty, department, academic session, semester and department-scoped lecturer account. These records are not LASU records. Student registration and confirmation in Mailpit can be used to exercise code-based enrollment. The roster preflight checks a selected CSV in the browser against a draft LASUATOS contract. It does not upload, save, import or verify those records.

## Local development

Requirements:

- Node.js 22.12 or newer in the Node 22 line
- pnpm 12.18.0, pinned through the `packageManager` field

```sh
pnpm install
cp .env.example .env
pnpm dev:setup
pnpm dev
```

`dev:setup` starts loopback-only PostgreSQL and Mailpit containers, applies the checked-in migrations to the guarded `lasuatos_dev` database, and creates synthetic local demo records only. It refuses remote databases and local database connections that do not match the dedicated Compose settings. Docker Engine with the Compose plugin is required. The example database password is for local development only.

Open the web workspace at `http://localhost:3000`. The API listens on port `4000`. Open `http://localhost:8025` to read confirmation emails captured by Mailpit. With the supplied local settings, messages are captured in Mailpit rather than sent to real inboxes.

The local demo tenant is named `LASUATOS local demo tenant`; it is not a LASU institutional record. The first seed run creates a demo lecturer at `lecturer@lasuatos.example.net` with a generated password printed once in the terminal. Save it for local testing; later setup runs neither reset nor reprint it. To select a fixed local password before first provisioning, set `LOCAL_DEMO_LECTURER_PASSWORD` (12–128 characters) in `.env`. Sign in, create an offering, and issue a code. To try the student flow, register a synthetic student, open Mailpit at `http://localhost:8025` to confirm the email, sign in and use the code. Email confirmation verifies mailbox access only; the matric number remains unverified. Do not use real student data until the purpose and handling have been approved.

To stop the local services while preserving the PostgreSQL volume, run `docker compose down`. Do not add `-v` unless you intend to delete the local database.

For an existing, separately authorized development database, set `DATABASE_URL` and `SELF_REGISTRATION_INSTITUTION_SLUG` yourself, apply migrations only after reviewing the target, and configure a server-side email provider such as Gmail via Nodemailer, Brevo or Resend. Do not point local development at production or an institutional system without authorization. See [Deployment](docs/DEPLOYMENT.md) and [Security](docs/SECURITY.md).

## Checks

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`db:generate` updates the Drizzle migration from the schema. Review the generated SQL before applying it. `db:migrate` requires a configured PostgreSQL URL.

## Project map

```text
apps/
  api/                  Fastify API, role-based auth, course enrollment and admin overview routes
  web/                  Next.js student, lecturer and administrator workspaces
packages/
  auth/                 Password hashing, token helpers and scoped authorization
  contracts/            Shared Zod contracts
  database/             Drizzle schema, PostgreSQL client and migrations
docs/                   Product, architecture, security and delivery notes
```

## Product and engineering notes

- [Product requirements](docs/PRD.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [API](docs/API.md)
- [Administrator access](docs/ADMINISTRATION.md)
- [Academic roster preflight](docs/ACADEMIC_IMPORT.md)
- [Security and privacy](docs/SECURITY.md)
- [Venue system](docs/VENUE_SYSTEM.md)
- [Verification model](docs/VERIFICATION.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Testing](docs/TESTING.md)
- [Implementation plan and risk register](docs/IMPLEMENTATION_PLAN.md)
- [Technical decisions and LASU visual research](docs/DECISIONS.md)
- [Contribution guide](CONTRIBUTING.md)

## Naming and identity

The product name is **LASUATOS**. The interface uses a purpose-built wordmark and a restrained blue, ochre and charcoal palette. It does not use or recreate the University's coat of arms. The selected screen colors are product design tokens, not claimed official LASU color codes. See the visual research and source notes in `docs/DECISIONS.md`.
