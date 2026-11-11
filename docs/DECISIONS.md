# Technical decisions and visual research

## ADR 001: Product name

**Decision:** Use LASUATOS as the working product name, as requested. It is presented as a product name, not expanded into an unapproved institutional acronym. The product descriptor is "Attendance and venue verification".

**Status:** Accepted for this build. Institutional naming approval remains open.

## ADR 002: Start as a modular monolith

**Decision:** Use a pnpm workspace with a Next.js web app, a Fastify API and focused shared packages. Keep PostgreSQL as the system of record. Do not add Redis, a worker, PostGIS or microservices before there is a measured requirement.

**Reason:** The initial repository was empty, and attendance integrity benefits from a small number of clear, testable boundaries. A monolith is easier to review and operate for the first pilot.

## ADR 003: Same-origin browser API access

**Decision:** The browser requests relative `/api/v1/*` paths. Next.js rewrites them server-side to `API_INTERNAL_URL`.

**Reason:** Avoid hardcoded browser localhost URLs, a second browser origin and unnecessary CORS configuration. Production deployment must provide the private API route explicitly.

## ADR 004: Server-owned access and decisions

**Decision:** Shared role names and a tested scope helper are implemented, but no attendance or administration route will be exposed until authentication and request-level authorization exist.

**Reason:** Hiding a button is not an authorization boundary. A standalone helper does not authenticate a caller or check course assignment, student ownership or object state.

## ADR 005: Location is evidence, not proof

**Decision:** GPS will be treated as a proximity signal with accuracy and freshness, not proof of classroom presence. Inconclusive evidence must have a retry or human-reviewed alternative.

**Reason:** Indoor positioning and device-reported coordinates are uncertain and can be manipulated. A single fixed radius cannot represent all venues or devices fairly.

## ADR 006: Pin compatible stable dependencies

**Decision:** Pin direct framework and tooling versions in manifests and the pnpm lockfile. Use the latest available stable versions exercised by the local checks where ecosystem compatibility allows. Drizzle ORM 0.45.4 is selected instead of the announced 1.0 beta. TypeScript 6.0.3 is used because the current TypeScript ESLint parser did not support TypeScript 7.0.2 during validation. ESLint 10 is paired with TypeScript ESLint 8.72.2 and the React Hooks plugin; the Next.js shared lint preset was not retained because its bundled plugins still declare ESLint 9-only peer ranges.

**Reason:** A registry's newest release is not automatically a compatible release. Build, lint and peer dependency compatibility take priority over selecting a version solely because it is the newest tag.

## ADR 007: Patch vulnerable transitive tooling dependencies

**Decision:** The pnpm workspace overrides `esbuild@0.18.20` to patched `0.25.12` and `minimatch@10.2.6` to patched `11.0.5`. These are scoped compatibility overrides for transitive development tools. The full dependency audit and peer-dependency check pass with the overrides in place.

**Reason:** The initial development dependency audit reported advisories for those transitive versions. The chosen patched releases meet the advisory's fixed-version requirements and pass the workspace tests. Remove an override when upstream dependencies provide the fix and the lockfile is re-audited.

## ADR 008: Student self-registration verifies mailbox access only

**Decision:** Let students create an account with an email address and a self-reported matric number. Accept non-school email addresses normally. Confirm access to the mailbox through a one-time link, but do not treat the domain, email confirmation or matric number as proof of LASU student status. Only assign the student role after mailbox confirmation. Public registration cannot assign staff roles.

**Reason:** No University-wide identity integration or authorized student-data source is available. Requiring a school-domain address would exclude legitimate users without proving status. Matric numbers must remain unverified until an approved source or review process exists.

## ADR 009: Select email delivery through server configuration

**Decision:** Choose the email adapter through `EMAIL_PROVIDER` in server-side environment configuration. Local development supports Mailpit, which captures messages without external delivery. The external options are Gmail via Nodemailer, Brevo and Resend. Credentials stay out of browser code. Sender verification remains the operator's responsibility with each external provider.

**Reason:** The pilot should not be coupled to a single sender before the University chooses its approved mail service.

## ADR 010: Prefer course self-enrollment over individual approval

**Decision:** Course enrollment uses a lecturer-controlled join code that same-institution student accounts can redeem without individual approval. The implementation stores only a hash, expires codes at semester end and lets the assigned lecturer rotate or revoke them. Rate limiting, abuse monitoring and authoritative student-status checks remain open.

**Reason:** Requiring a lecturer to approve each student would create avoidable administration for a course pilot. A course code grants course membership only; it does not verify LASU registration or attendance.

## LASU visual research

### Sources reviewed

- The [official LASU homepage](https://lasu.edu.ng/home/) shows the University's public identity and current institutional messaging.
- The [official LASU e-Payment portal](https://lasu.edu.ng/tsa/epayment/default_new_conv.php) displays the LASU logo and the phrase "For Truth and Service".
- An [official LASU Faculty of Education handbook](https://lasu.edu.ng/home/handbook_brochure/Handbook%20for%20Physical%20%20%20Health%20Education%20Programme-1654017817.pdf) identifies that faculty colour as blue. That faculty-specific reference is not treated as an Engineering brand specification.
- A [secondary reference about the LASU coat of arms](https://www.lasu-info.com/2020/02/lasu-coat-of-arms.html) describes yellow ochre, two shades of blue and black, and lists yellow, blue, gold and black as University colours. It is not an official digital brand manual.

No official machine-readable LASU palette with approved HEX, RGB or accessibility tokens was found in the material reviewed. No third-party color extraction is presented as an official specification.

### Product palette

The workspace uses a deliberately restrained blue, ochre and charcoal scheme, with white and cool neutral surfaces. The exact values below are product design choices, selected for readable contrast and practical interface use. They are not official LASU color codes and need review by LASU Communications before adoption.

| Token | Value | Use |
| --- | --- | --- |
| Institutional blue | `#153B5B` | Primary navigation, brand mark and headings |
| Deep blue | `#0E304D` | Strong text and high-emphasis states |
| Ochre | `#C59A42` | Small accents and active markers, not small text on white |
| Charcoal | `#172635` | Main text |
| Cool canvas | `#F5F7F8` | Application background |
| White | `#FFFFFF` | Content surfaces |
| Muted text | `#61707C` | Secondary text |

The interface uses a custom typographic mark rather than copying the University coat of arms. No external stock illustration, invented campus photo or unverified logo asset has been added. The visual direction uses a clear hierarchy, restrained borders and compact information layouts rather than decorative gradients or glow effects.

## Open decisions

- Whether LASU wants the product name, motto treatment and digital palette adopted.
- Approved login and identity provisioning mechanism.
- Data retention and dispute procedure.
- Venue registration authority and geofence policy.
- Production hosting, regional data processing and security operations ownership.
