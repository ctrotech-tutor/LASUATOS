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

**Decision:** Student, lecturer and scoped administrator authentication plus request-level authorization are implemented. Attendance routes require an assigned lecturer or an enrolled student. The administrator overview is read-only; no administrative data mutation route is exposed. Code-based attendance is not venue verification.

**Reason:** Hiding a button is not an authorization boundary. Each attendance action checks the authenticated role, course assignment or student enrollment, and current session state on the server.

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

## ADR 011: Venue boundaries are circular, registered on site and institution-administered

**Decision:** Venue geofences are circular only (`geofence_kind = 'circle'` with a 5–2000 m radius), stored per venue and editable later to admit polygons without pretending they exist now. Venue coordinates and boundaries must be registered by an authenticated institution administrator from the venue itself (browser Geolocation API with a map review step); map-picked coordinates are only a convenience, never the source of truth for a real venue. Every registration writes an audit event with actor, timestamp, coordinate, radius and reported device accuracy. A venue cannot be activated without a registered boundary, enforced both in the service and by the `venues_active_location_ck` database constraint. Directory reads are open to all institution administrators; writes are institution-administrator only because a shared boundary affects every department that uses the space. Proximity outcomes evaluate `within`, `outside` or `inconclusive` — GPS uncertainty can never turn into automatic punishment.

**Reason:** Circular geofences match real academic spaces (student arrivals disperse around a room, campus GPS rarely achieves building-corner precision) and keep the honest-limits promise: no fake polygon precision. On-site registration with audit events makes a wrong boundary attributable and reversible, and the `inconclusive` outcome gives uncertain readings a fair fallback instead of a false outside.

## ADR 012: Attendance disputes are decided by the course's lecturers through the audited correction path

**Decision:** A student can dispute a missing or revoked check-in. Any lecturer assigned to the offering decides it, with a note the student sees. Upholding applies the existing `mark_present` correction in the same transaction and links it through `attendance_corrections.dispute_id`, so there is no second path that can change attendance. Further rules:
- **Kind:** the server derives it; the client never supplies it.
- **Timing:** missing check-ins become disputable only after check-in closes, and revoked check-ins can be disputed straight away. The window closes 14 days after the session ended.
- **Limits:** one open dispute per student and session, enforced by a partial unique index, and at most 10 open disputes per student.
- **Finality:** upheld and rejected decisions are final, while a withdrawn dispute may be raised again within the window.
- **Database guard:** a trigger forbids deletes and edits after a decision, and keeps the student's statement immutable.

Administrators see open-dispute counts and the age of the oldest waiting dispute but do not decide. No email notification or escalation is built yet.

**Reason:** The lecturers who ran the session are best placed to judge it, and reusing the correction path keeps one audit trail and one set of enrollment and lock rules. Blocking missing-check-in disputes while check-in is open stops students disputing instead of checking in. An immutable statement and final decision make the record trustworthy for both sides. The window, escalation and retention are institutional policy, so they are named constants and documented open items rather than being presented as settled rules.

## ADR 013: Throttle rather than lock out, keep counters in PostgreSQL, and recover passwords only through the verified mailbox

**Decision:**
- **Throttling, not lockout.** Rate limits are fixed windows counted in PostgreSQL and shared by every API instance. Each window is keyed by a digest of policy and subject (client address, normalized email or session). Failed sign-ins are throttled per email and per address; accounts are never locked.
- **Subjects.** Limits that a whole lecture would share (check-in, course-code redemption, disputes) are keyed per session, not per address.
- **Store failures fail open** and are logged.
- **Recovery** works only through the account's verified mailbox. It uses a single-use, 30-minute token, always returns the same response, and a completed reset revokes every session.
- **CSRF** protection uses Fetch Metadata and exact `Origin` matching rather than a token.

**Reason:**
- **Lockout:** a hard lockout lets anyone who knows a student's email deny them sign-in at the start of a lecture. Throttling keeps guessing impractical without handing out that power.
- **Storage:** the pilot already depends on PostgreSQL, so storing counters there avoids a new service (such as Redis) while keeping limits consistent across instances. Digests keep raw addresses and emails out of another table.
- **Per-session keys:** a campus NAT can put hundreds of students behind one address.
- **Fail-open:** an outage of the counter store must not stop sign-in or check-in. The failure is logged so it can be alerted on.
- **CSRF:** every supported browser sends Fetch Metadata or `Origin` on cross-site requests, and the API serves only its own web app, so a check needs no token plumbing.
- **Recovery** through the verified mailbox is the only channel the product can trust today. Recovery for people who have lost their mailbox needs an administrator process with identity checks, which is an institutional decision.

**Revisit when:** traffic outgrows a single PostgreSQL primary for counters (move them to a dedicated store); the institution adopts single sign-on (recovery then belongs to the identity provider); or a staff-assisted recovery process is agreed.

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
- Data retention (including dispute statements), dispute escalation beyond the course's lecturers, decision notifications and the dispute window length.
- Venue registration authority beyond the implemented institution-administrator default (motion-based approval, separate reviewer role) and per-venue geofence radius policy.
- Production hosting, regional data processing and security operations ownership.
- Administrator-assisted account recovery for users who have lost access to their registered mailbox, and the identity checks it requires.
- Final rate-limit values, to be tuned from measured staging and pilot traffic.
