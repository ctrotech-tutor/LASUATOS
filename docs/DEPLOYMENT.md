# Deployment

## Current state

The project is prepared for local development and an Arena preview. It is not ready for a live university pilot. There is no institutional database, identity provider, production secret store, venue register, backup plan, monitoring service or incident process configured.

## Local setup

Use Node 22.12 or newer in the Node 22 line, pnpm 12.18.0, Docker Engine and the Docker Compose plugin. Run:

```sh
pnpm install
cp .env.example .env
pnpm dev:setup
pnpm dev
```

The web app binds to `0.0.0.0:3000`; the API binds to `0.0.0.0:4000`. Next.js serves the browser-facing origin and rewrites `/api/v1/*` to the API using `API_INTERNAL_URL`. Browser code must use relative URLs only.

`compose.yaml` starts PostgreSQL on loopback port `5433` and Mailpit on `1025` for SMTP and `8025` for its inbox. The local `.env.example` selects the Mailpit adapter, so confirmation messages stay inside the development environment. Open `http://localhost:8025` to retrieve them.

`pnpm dev:setup` checks that `DATABASE_URL` targets `lasuatos_dev` on a loopback address and the configured Compose port, with matching local Compose credentials. It also requires loopback Mailpit settings. It stops before Docker or migrations if the environment does not match those local-only settings, then starts the containers, applies migrations and seeds synthetic records only: the labelled `LASUATOS local demo tenant`, demo faculty/department/calendar and a scoped lecturer test account. None is an official LASU record. A generated lecturer password is printed once on first seed; set `LOCAL_DEMO_LECTURER_PASSWORD` before first setup to choose a local value without printing it. The sample database password is weak by design, ports bind to loopback, and neither setting is for production.

`db:generate` does not connect to PostgreSQL; `db:migrate` does. Do not configure real student data or institutional credentials in an unapproved preview environment. The database can be started without the application using `docker compose up -d --wait`; `docker compose down` preserves its named volume.

## Production checklist

Before any production or pilot deployment:

- Select an approved hosting and PostgreSQL provider with supported regions and documented data processing terms.
- Set production origins and internal API origin explicitly. Do not carry the preview wildcard host allowlist into production.
- Terminate TLS, configure trusted proxy behavior deliberately and test secure cookie settings. Set `TRUST_PROXY` to the load balancer's address or CIDR (the default `loopback` fits only the bundled single-host topology). Never use `true` on an API that clients can reach directly.
- Keep `RATE_LIMIT_STORE=postgres` (production refuses `off`). Set `PUBLIC_APP_URL` to the HTTPS public origin; it is the origin allowed to send state-changing requests, and HTTPS also turns on HSTS and `upgrade-insecure-requests` for pages. List any additional legitimate origins in `TRUSTED_ORIGINS`. Pass the same `PUBLIC_APP_URL` to the web build.
- Add trusted-edge limits and alerting on top of the application rate limits: alert on bursts of `429` and cross-origin `403` responses and on "Rate-limit store failed" log lines (the limiter fails open).
- Use managed secrets. Do not commit `.env` or print connection strings, email API keys, Gmail OAuth credentials or App Passwords in logs.
- Configure and verify a transactional email sender. Gmail should use Nodemailer with OAuth2 where possible, or an eligible Google App Password. Brevo requires a verified sender. Resend requires a verified sending domain and DNS authentication.
- Ensure production institution and academic rows are created by an authorized process. Every seeded local tenant, faculty, department, semester and lecturer is synthetic demo data and must never be promoted or presented as an official record.
- Set database SSL requirements, connection limits, timeouts, backups, restore testing and a migration runbook.
- Configure structured logs, metrics, error monitoring, uptime checks and retention limits.
- Add deployment health checks using `/api/v1/health` for liveness and `/api/v1/ready` for readiness.
- Run security review, accessibility checks, browser tests and the staging load plan in `docs/LOAD_TESTING.md`, and record the measured results with their conditions.
- Obtain institutional approvals for identity, venue registration, privacy, data retention and pilot operations.

## Hosting note

The current web app expects the Fastify API to be reachable from the Next.js server at `API_INTERNAL_URL`. A platform deployment must provide both processes or provide an equivalent private network route. The API is not a public cross-origin browser API in this design.
