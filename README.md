# LASUATOS

LASUATOS is a university attendance and venue verification platform being designed for Lagos State University. The first intended pilot is the Faculty of Engineering. The product and data model are being built to support more faculties, campuses, departments and institutions without treating LASU as the only possible tenant.

## Current status

This repository contains a foundation build plus a local academic-data preparation workflow, not a live attendance system. It has a Next.js workspace, a Fastify API, a PostgreSQL schema and migration, shared contracts, scoped authorization primitives, and a setup interface. The course roster preflight checks a user-selected CSV in the browser against a draft LASUATOS column contract. It does not upload, save, import or verify the records. It has no LASU identity connection, production database, institutional records, venue register, attendance-session workflow or QR verification. It cannot create or confirm attendance.

No student, staff or venue records are seeded into the project. The interface labels the current workspace and the missing integrations rather than showing sample records as live data.

## Local development

Requirements:

- Node.js 22.12 or newer in the Node 22 line
- Corepack
- pnpm 12.18.0, selected through the `packageManager` field

```sh
corepack enable
corepack pnpm install
cp .env.example .env
corepack pnpm dev
```

Open the web workspace at `http://localhost:3000`. The API listens on port `4000`. The web app calls it through the same-origin `/api/v1/*` rewrite. Browser code does not call `localhost` or another loopback address.

Without `DATABASE_URL`, the web and API still start, but the readiness check correctly reports that the database is not configured. No attendance or user data can be saved.

To connect a local PostgreSQL database, set `DATABASE_URL` in `.env` to a database dedicated to development, then apply the checked-in migrations:

```sh
corepack pnpm db:migrate
```

Do not point local development at production data. The migration has been generated and reviewed, but has not been applied to an institutional database.

## Checks

```sh
corepack pnpm typecheck
corepack pnpm lint
corepack pnpm test
corepack pnpm build
```

`db:generate` updates the Drizzle migration from the schema. Review the generated SQL before applying it. `db:migrate` requires a configured PostgreSQL URL.

## Project map

```text
apps/
  api/                  Fastify API and health/readiness routes
  web/                  Next.js workspace and same-origin API rewrite
packages/
  auth/                 Scoped authorization primitives
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
