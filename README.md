# LASUATOS

LASUATOS is a university attendance and venue verification platform being designed for Lagos State University. The first intended pilot is the Faculty of Engineering. The product and data model are being built to support more faculties, campuses, departments and institutions without treating LASU as the only possible tenant.

## Current status

This repository contains a development build, not a live attendance system. It has a Next.js workspace, a Fastify API, a PostgreSQL schema and migrations, shared contracts, scoped authorization primitives, and a local roster preflight. A first student-account flow supports email confirmation, password sign-in and server-managed sessions when a database, institution row and email provider are configured. Email confirmation proves mailbox access only. Matric numbers remain self-reported, public sign-up cannot grant staff roles, and no LASU identity source is connected. Course self-enrollment, attendance sessions, venue verification and QR check-in are not implemented.

No official institutional, student, staff or venue records are seeded. The guarded local setup creates only a clearly named `LASUATOS local demo tenant` so the account flow can be exercised without inventing a LASU faculty, course or student record. The roster preflight checks a selected CSV in the browser against a draft LASUATOS contract. It does not upload, save, import or verify those records.

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

`dev:setup` starts loopback-only PostgreSQL and Mailpit containers, applies the checked-in migrations to the guarded `lasuatos_dev` database, and creates only the labelled local demo tenant. It refuses remote databases and local database connections that do not match the dedicated Compose settings. Docker Engine with the Compose plugin is required. The example database password is for local development only.

Open the web workspace at `http://localhost:3000`. The API listens on port `4000`. Open `http://localhost:8025` to read confirmation emails captured by Mailpit. With the supplied local settings, messages are captured in Mailpit rather than sent to real inboxes.

The local demo tenant is named `LASUATOS local demo tenant`; it is not a LASU institutional record. Use synthetic account details only. Email confirmation verifies mailbox access, and the matric number remains unverified. Do not use real student data until the purpose and handling have been approved.

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
  api/                  Fastify API, student account routes and email adapters
  web/                  Next.js workspace and same-origin API rewrite
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
