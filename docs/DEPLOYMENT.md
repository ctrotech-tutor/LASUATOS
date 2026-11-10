# Deployment

## Current state

The project is prepared for local development and an Arena preview. It is not ready for a live university pilot. There is no institutional database, identity provider, production secret store, venue register, backup plan, monitoring service or incident process configured.

## Local setup

Use Node 22.12 or newer in the Node 22 line and Corepack. Run:

```sh
corepack enable
corepack pnpm install
cp .env.example .env
corepack pnpm dev
```

The web app binds to `0.0.0.0:3000`; the API binds to `0.0.0.0:4000`. Next.js serves the browser-facing origin and rewrites `/api/v1/*` to the API using `API_INTERNAL_URL`. Browser code must use relative URLs only.

`DATABASE_URL` is blank by default. Set it only to a dedicated development PostgreSQL database if you intend to test migrations. `db:generate` does not connect to PostgreSQL; `db:migrate` does.

## Production checklist

Before any production or pilot deployment:

- Select an approved hosting and PostgreSQL provider with supported regions and documented data processing terms.
- Set production origins and internal API origin explicitly. Do not carry the preview wildcard host allowlist into production.
- Terminate TLS, configure trusted proxy behavior deliberately and test secure cookie settings after authentication exists.
- Use managed secrets. Do not commit `.env` or print connection strings in logs.
- Set database SSL requirements, connection limits, timeouts, backups, restore testing and a migration runbook.
- Configure structured logs, metrics, error monitoring, uptime checks and retention limits.
- Add deployment health checks using `/api/v1/health` for liveness and `/api/v1/ready` for readiness.
- Run security review, accessibility checks, browser tests and representative load tests.
- Obtain institutional approvals for identity, venue registration, privacy, data retention and pilot operations.

## Hosting note

The current web app expects the Fastify API to be reachable from the Next.js server at `API_INTERNAL_URL`. A platform deployment must provide both processes or provide an equivalent private network route. The API is not a public cross-origin browser API in this design.
