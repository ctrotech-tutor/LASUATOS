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

## ADR 014: Staff join by scoped email invitation; only the first administrator needs the server

**Decision:**
- **Bootstrap.** The first administrator is invited by a server-side command (`pnpm admin:bootstrap`). It is the only provisioning step that needs shell access, and it records no inviting user.
- **Invitations.** Every other lecturer and administrator is invited from the Staff page. An invitation is a 256-bit random token stored only as a SHA-256 digest, valid for 7 days and single use. It travels in the URL fragment. Resending rotates the token.
- **Acceptance** sets the password, confirms the email (the link reached that mailbox), and creates the profile, the scoped role assignment and the session in one step.
- **Scope rule.** Administrators may invite and manage people at or below their own level, inside their own area (see `docs/ADMINISTRATION.md`). System-administrator roles are never invitable, and nobody manages their own account.
- **Suspension** blocks sign-in and revokes every session at once. Reactivation restores access with the existing password.
- **Audit.** Every invitation, acceptance, suspension and reactivation is written to an append-only `staff_audit_events` table with actor, target, reason and time.

**Reason:**
- Without this, lecturer and administrator accounts could only come from hand-written database rows, which are unaudited and error prone.
- Email invitations reuse the trust the product already relies on (the mailbox) and need no new infrastructure.
- **Scope rule:** the institution did not specify one. "At or below, within your area" lets departments onboard their own lecturers without giving anyone power over people above them or in other faculties. It is one small policy function, so a stricter rule (for example, only institution administrators invite administrators) is a one-file change.
- Suspension must take effect immediately, so sessions are revoked rather than left to expire.
- Storing only token digests means a database leak does not yield usable links.

**Limits:** the inviting administrator vouches for the person's identity and staff status; the product does not verify either. Role or area changes for existing accounts are not yet supported in the product.

**Revisit when:** LASU states its own delegation policy, adopts single sign-on (staff would then be provisioned from the identity provider), or needs role changes without re-provisioning.

## ADR 015: Free production on one Vercel deployment with the API embedded

**Decision:**
- **Embedded API.** Production can run at no cost on Vercel Hobby, Neon Free and Brevo Free. The Fastify API is not moved or rewritten. `createApiApplication` (`apps/api/src/app.ts`) wires it once. The standalone server (`index.ts`) listens on a port. The embedded adapter (`embedded.ts`) dispatches Web `Request`s through `server.inject` from the Next.js route `app/api/v1/[...path]/route.ts` when `API_MODE=embedded`.
- **Bundling.** The adapter is bundled with esbuild into `apps/api/dist/embedded.mjs`, because the API source uses NodeNext `.js` specifiers that the Next.js bundler does not resolve. A hand-written `embedded.d.ts` gives the web app its types. A compile-time check keeps that file in step with the source.
- **Proxy mode stays the default.** `beforeFiles` rewrites send `/api/v1` to `API_INTERNAL_URL` ahead of the route. Local development and self-hosting are unchanged.
- **Serverless settings.**
  - Each function instance keeps one application with a small pool (3 connections) and a 10-second connect timeout, because Neon wakes from idle.
  - The client address comes from Vercel's `x-real-ip`, and `X-Forwarded-For` is not trusted.
  - `PUBLIC_APP_URL` falls back to `VERCEL_PROJECT_PRODUCTION_URL`.
- **Institution structure.** It is created by `pnpm institution:setup` from a reviewed JSON file. The command is idempotent, works in one transaction and never deletes. It covers only the institution, faculties, departments, campuses, buildings, sessions and semesters. Nothing else in the product creates these rows, and course offerings need a semester. People, courses and attendance are never set up this way.

**Reason:**
- A free long-running Node host with an always-on process is not reliably available. Vercel functions are.
- Embedding keeps one code path for every rule: validation, rate limits, the origin check and headers. It also avoids a cross-origin API, a second deployment and a second domain.
- Without a setup command, a fresh production database would need hand-written SQL before anyone could create a course.

**Limits:**
- Vercel Hobby is for personal, non-commercial use, and its logs are kept for 1 hour.
- Neon Free pauses after 5 idle minutes, so the first request waits briefly. It has monthly compute and storage caps and a 6-hour restore window.
- Brevo Free sends 300 emails a day.
- None of the three has an SLA.
- Each warm function instance holds its own pool. The pooled (PgBouncer) Neon URL absorbs that.

**Revisit when:** LASU adopts the system officially (paid plans or its own servers, using proxy mode), traffic outgrows the free quotas, or live updates need pushed events rather than polling (ADR 023).

## ADR 016: Our own form controls instead of the browser's

Native selects, date pickers, number spinners, datalists, `title` tooltips and validation bubbles look different on every phone and cannot be styled to match the app. They are replaced by small, dependency-free components in `apps/web/components/ui/`: `Select`, `DatePicker`, `Combobox`, `NumberField`, `SearchField`, the `data-tip` tooltip layer and `FormValidation`. Confirmations, prompts and notices go through `useFeedback()` (`components/feedback.tsx`); `window.alert`, `confirm` and `prompt` are not used anywhere.

- On phones (≤760px) pickers open as bottom sheets with 44px+ targets; on larger screens they open as anchored popovers.
- Each control follows the WAI-ARIA pattern for its role (combobox/listbox, grid calendar) and supports the keyboard: arrows, Home/End, typeahead and Escape.
- Forms keep using plain `required`, `min`/`max`, `minLength` and `pattern`. Custom controls carry their value in a hidden proxy input, so `FormData` and native validation still work. `FormValidation` replaces the browser bubble with a message under the field and focuses the first problem. Use `data-pattern-message` for a friendly `pattern` message.
- New forms should use these components rather than `<select>`, `<input type="date">`, `<input type="number">`, `<datalist>` or `title=`.

## ADR 017: Correcting records after they are created

Every record a person types can be corrected later, in the same place it was created, through an "Edit" dialog (`components/ui/edit-dialog.tsx`: a centred card on computers, a bottom sheet on phones). Edits send only the fields that changed and go through `POST` routes with their own rate limits.

| Record | Who may edit | What can change | Route |
| --- | --- | --- | --- |
| Lecture session | Whoever may manage it | Course code, title, lecturer name, venue and the in-venue check | `POST /api/v1/lecture/sessions/:id` |
| Academic session | Institution administrators | Code, dates, semester names and dates; semesters can be added, never removed | `POST /api/v1/admin/structure/academic-sessions/:id` |
| Building / venue | Institution administrators | Building code and name; venue code, name, type, building, floor, section and capacity | `POST /api/v1/admin/buildings/:id`, `POST /api/v1/admin/venues/:id` |
| Course offering | The assigned lecturer | Title and credit units (shared by every offering of the course code) and the offering's level | `POST /api/v1/lecturer/course-offerings/:id` |
| Staff member | Administrators who manage that person, and the person themself | Name and, for lecturers, staff number | `POST /api/v1/admin/staff/members/:userId` |
| Own profile | Any signed-in person | Name; students can also fix their matric number until the university confirms it | `POST /api/v1/auth/profile` |

- A venue's location and boundary stay in the on-site location panel; status changes keep their existing routes.
- Changing a matric number needs the current password, is refused once the matric number is verified or when another account has it, and resets the stored entry year so the level is worked out from the corrected number.
- Administrative edits (structure, venues, buildings, staff) are written to the audit log with a before → after description.
- Role, scope and course-code changes are deliberately not edits: they change who is responsible for what, so they keep going through invitations and new offerings.

## ADR 018: Class representatives see their department's attendance

A HOC can view every attendance session taken for their department, and a GHOC every session in their faculty, not only the sessions they took themselves. This lets a class representative follow attendance across all their courses.

| Who | Sees | Can change |
| --- | --- | --- |
| Lecturer | Sessions they took | Sessions they took |
| HOC (department + set) | Sessions they took; every session tagged with their department; faculty-wide sessions their GHOC took for the same set | Sessions they took |
| GHOC (faculty + set) | Sessions they took; every session in their faculty | Sessions they took |
| Administrator | Their scope (institution, faculty or department) | Everything in their scope |

- Sessions carry the faculty, department and set they were taken for: a rep's appointment, or a lecturer's department. Visibility is a filter on those columns (`rep_department` and `faculty` in `LectureSessionVisibility`), so the session list, registers and course register all agree.
- Session summaries and details return `canManage`. When it is false, the web app shows the session as **view only**: no QR controls, editing, adding or removing students, but the list stays live and can be exported. The API returns 404 for any change attempt, the same as for sessions the person cannot see.
- `capabilities.attendanceScopeLabel` names the department or faculty, so the sessions page can explain what is shown and offer an "Only mine" filter.

Guest entries (students who checked in without an account) can be corrected by whoever manages the session: `POST /api/v1/lecture/sessions/:id/attendees/:attendeeId/details` changes the typed name and/or matric number. If the corrected matric number belongs to a student account, the entry is linked to that account and takes its name. Entries already linked to an account are refused, because the student corrects those in their own profile. A matric number already on the list is refused with a pointer to remove one of the two entries.

## ADR 019: QR attendance on the admin dashboards, deleting mistaken sessions, phone "More"

**Dashboards.** The admin overview and attendance pages used to summarise only course-offering attendance (enrolled students), so the QR sessions that lecturers and class representatives actually run showed as "no sessions". `GET /api/v1/lecture/summary?days=7|30|90` now summarises every QR session the caller can see (the same visibility as the session list): sessions, open now, check-ins, distinct matric numbers, guest/manual/removed/shared-phone counts, check-ins per Lagos day, departments, most held courses and who took them. The overview shows the 7-day card; the attendance page shows the full report above the course-offering report.

**Deleting a session.** `POST /api/v1/lecture/sessions/:id/delete` removes a session opened by mistake, together with its attendance list, so it no longer counts as a session held in registers. Only someone who may manage the session can delete it; when anyone is on its list, the course code must be typed back. Deletion is permanent by design: a soft delete would leave hidden sessions affecting registers.

**Finding sessions.** The session list is paged (60 at a time, `before` cursor) and searchable on the server by course code (spaces ignored) or title, so department-wide lists for HOCs, GHOCs and administrators stay usable.

**Phone navigation.** The phone tab bar holds five slots. When a role has more pages, the first four stay and the rest move into a "More" bottom sheet, so no page is unreachable on a phone (previously some pages were hidden on phones).

## ADR 020: Automatic migrations, error alerts, per-semester registers, optional enrolled courses, crowd test

**Migrations on deploy.** Migrations had to be run by hand (`pnpm prod:migrate`), and the live database fell several migrations behind the code. The web app's build (`apps/web` `build`, which Vercel runs) now starts with `scripts/migrate-on-deploy.mjs`, which applies pending migrations when `VERCEL_ENV=production` and `DATABASE_URL` is set (or `MIGRATE_ON_BUILD=1` on other hosts). Migrations are additive and recorded, so repeating them is safe; a failed migration fails the build and the previous deployment keeps serving. Preview builds never migrate. `SKIP_DATABASE_MIGRATIONS=true` opts out. `pnpm prod:check` now also fails when `/api/v1/ready` reports `schema: behind`.

**Error alerts.** With `ALERT_EMAIL` set, the operator is emailed when a request ends in an unexpected 500, when a page crashes in a browser (the error screens post to `POST /api/v1/client-errors`, which always answers 204 and is rate limited), and when readiness finds the schema behind. Alerts go through the configured email provider, with secrets scrubbed; each distinct problem is sent at most once per 30 minutes and at most 20 alerts per day, so a crash loop cannot exhaust the free email quota. Every occurrence is still logged. Without `ALERT_EMAIL` alerts are only logged. A hosted error tracker was not added: it would need another account and secret, and email already works.

**Registers per semester.** QR sessions are not tied to a course offering, so next year's CSC 301 would have counted on the same register as this year's, lowering every rate. A register now counts one semester, using the semester dates administrators set on the Academic structure page: by default the semester of the course's latest session, with a picker for earlier semesters, sessions outside every semester, or every session. Without semester dates every session counts, as before. A student's own course rate counts only sessions in the semesters they attended that course. `apps/api/src/e2e/semester-end.integration.test.ts` runs a whole semester and the next one over HTTP to check this.

**Enrolled courses are optional.** LASUATOS is used through QR sessions; the older enrolled-course tools (course offerings, enrollment codes, course sessions, reports and disputes) stay in the product but are hidden until used. `GET /api/v1/lecture/capabilities` returns `usesEnrolledCourses`: for a lecturer, whether they are assigned to an offering; for a student, whether they are enrolled or the institution has any offering; for an administrator, whether the institution has any offering. Navigation, the admin overview cards and the course-offering report follow it. A hidden page still opens from a direct link, and lecturers keep "Course tools" to start using offerings.

**Crowd test and the per-ticket limit.** `pnpm load:lecture` (`scripts/load/lecture-burst.mjs`) runs several halls of students through scan and check-in against a real PostgreSQL server and the production build, with rate limits on (results in `docs/LOAD_TESTING.md`). Its first worst-case run was refused 1,049 times because check-ins were also limited per QR ticket, and a ticket is shared by everyone who scans in the same second. That limit was removed: the per-address limit stays, and one phone entering several students is already flagged as a shared device for the lecturer to review.

## ADR 021: Class lists own a student's department and entry route; assistant reps

**Department and entry route.** Students used to set their own department and Direct Entry level on My courses. That let a student quietly drift off their class's list, and the class list (kept by the HOC from the department's records) is already the source of truth for names and matric numbers. Both are now read from the class list, and the self-service routes are gone. Corrections go through the people who keep the list: the HOC edits the entry route, and moves a student to the right department (`…/move`). A move keeps the same account, attendance, courses and face, is limited to the mover's faculties (across faculties is an institution administrator's call, because it changes who keeps the student), refuses students holding a rep post (their post is tied to the old department), and is recorded on both lists' history. Self-declared entry levels at sign-up remain only for the old free sign-up form (`STUDENT_SIGN_UP=open`), and the class list overrides them.

**Assistants (AHOC, AGHOC).** HOCs and GHOCs asked for help with the daily work. Each may choose up to two assistants; more would blur who is accountable for a class. An assistant is a `class_representatives` row with `assistant_of_id` pointing at the HOC's or GHOC's appointment, so they inherit its department or faculty and set and every existing rule for reps (adds only while attendance is open and from inside the venue) applies unchanged. Taking attendance is the reason they exist, so it cannot be switched off; everything else is a permission the HOC or GHOC switches on: `registers`, `class_list`, `setup_codes` (only with `class_list`, where codes are given) and, for a GHOC's assistant, `hocs`. The defaults (`registers`, `class_list`) cover the everyday help without the keys that open accounts or change posts. Choosing assistants is never delegated, so a principal's power cannot be passed on twice. Candidates must be on the principal's class list for the set (an assistant helps their own class) and hold no other post. The principal, the set's GHOC (when allowed to manage HOCs) and administrators over the post can manage them; an assistant may step down. Ending the principal's appointment ends the assistants', so a new HOC starts with a team they chose. Sessions record `creatorRole` `ahoc`/`aghoc`.

## ADR 022: Direct Entry students on JAMB numbers, until the matric number arrives

**Problem.** Direct Entry students start lectures weeks before LASU gives them a matric number and a student email, so they could not be on a class list, open an account or be marked present by number. Attendance written by hand was lost when the matric number came.

**JAMB number as a stand-in.** A JAMB registration number (`^\d{12}[A-Z]{2}$`, the four-digit exam year first; the older `^\d{8}[A-Z]{2}$` is also accepted) cannot be confused with a 9-digit matric number, so the class list keeps it in the same `matric_number` column and every place a student number is typed accepts either (`checkStudentNumber`). Nothing else has to know which kind it is: registers, help requests, search and sign-in work unchanged. A row in the JAMB format is Direct Entry (200 level unless the sheet says 300). The JAMB Profile Code (10 digits) is a different number and is refused.

**Personal email as proof, for them only.** Without a LASU email, a code to an address the student can open is the only proof available. A student on a JAMB number (`jamb_joined_at` set when they open or confirm on it) may use any real address (`isPersonalEmail` refuses LASU staff and reserved domains); everyone else still needs `@st.lasu.edu.ng`. The personal email sits in `lasu_email` while it stands in. A HOC setup code works as before.

**Switching keeps everything.** When the matric number arrives the student adds it themselves (Account → *Add my matric number*: the 9 digits and their LASU email, then a code to that LASU email), or the HOC edits the entry, or an upload has both numbers. One transaction updates the entry, the account's email and student number, moves `lecture_attendance` (their records and any typed under the JAMB number; a session that already has the matric number is left alone) and help requests, and keeps the JAMB number in `jamb_number` (unique per institution) so it still signs them in and later uploads with a JAMB column still find them. The old personal address is told (`matric_added`). A HOC may make this one change even after the account is open (other matric changes on an account stay administrator-only), because it is the expected course of events and the LASU-email code or the HOC's knowledge of the class is the check. If the matric number already belongs to an entry of the same person on the list (the HOC added it separately), the two are merged; a different name refuses it.

**Uploads.** The upload reads a separate *JAMB number* column (headings like "JAMB Reg No", "UTME/DE Reg. Number"), JAMB numbers in the matric column, or both on one row (which switches a listed student). Word tables (`.docx`, read in the browser: the zip is opened with `DecompressionStream`, no new dependency) and pasted text of any shape (tabs, commas, semicolons, bars, or line by line with the number, name and email anywhere on the line; the reading that finds the most students wins) join Excel and CSV. Old `.doc`/`.xls` and PDFs get instructions instead of a bad guess.

## ADR 023: Live screens by conditional polling, not server-sent events

**Problem.** A lecturer's register and the disputes queue should update by themselves during a class. The plan said server-sent events (SSE).

**Why not SSE (yet).**
- Production runs the API embedded in one Vercel function (ADR 015). It dispatches through `server.inject`, which buffers the whole response, so it cannot stream.
- The function is cut off at 30 seconds.
- Each warm instance is separate, so a check-in recorded on one instance cannot reach a stream held open on another without a broker (Redis, a paid realtime service, or a dedicated Postgres `LISTEN` connection per stream on Neon Free). None of these is free or simple.
- An open stream per lecturer would also hold a function and a database connection for the whole class.

**Decision.** Live screens poll, made cheap and quick:
- **Conditional GETs.** Every JSON `GET` answer carries a weak `ETag` (a SHA-256 of the body; `apps/api/src/security/conditional-get.ts`). A request that sends it back in `If-None-Match` gets `304 Not Modified` with no body.
  - The browser never caches these answers (`Cache-Control: no-store` stays). Instead, the web app remembers the last answer per URL in memory (`lib/remembered-answers.ts`, the 80 most recent) and sends the tag itself.
  - On a `304` the screen gets the very same object back, so nothing redraws, and the poll costs a few hundred bytes.
- **Adaptive cadence** (`useResource` `poll`/`pollQuiet`/`quietAfter`):
  - The register polls every 3 s while attendance is open, and every 10 s once nobody new has arrived for 90 s. Any change switches it back to 3 s.
  - The disputes queue polls every 15 s, and every 45 s once quiet for 2 minutes. The menu's dispute badge polls every 30 s.
  - Polling stops while the tab is hidden or the device is offline, and refreshes at once when either comes back.
- **What the person sees:**
  - New check-ins and new disputes light up briefly. They are read out once to screen readers ("Ada Bello checked in").
  - The present count pops when it goes up.
  - When updates stop (no signal, server waking), a notice says so, says how old the list is, and offers *Try now*. A screen never looks live while it is not.
  - A dispute that another lecturer decides, or the student withdraws, while it is open on screen says so, and its decision buttons go away.

**Reason.** Updates appear within about 3 seconds on the register, which is as live as a lecturer needs. It works the same on the free deployment, in proxy mode and through campus proxies that break long-lived connections. It also adds no new infrastructure. The tag is derived from what the account itself would receive, so it reveals nothing the body would not.

**Revisit when:** LASU runs the API as a long-lived process (proxy mode on its own servers) or pays for a realtime broker. An SSE stream that tells the page *what changed* can then trigger the same `revalidate` calls, with polling kept as the fallback.

## ADR 024: Class lists read from the files departments already have, in the browser, without guessing

**Problem.** HOCs get class lists as whatever the department or a portal produced: Excel 97–2003 `.xls`, Word 97–2003 `.doc`, PDF printouts, LibreOffice and WPS files, "Export to Excel" downloads that are really web pages or CSV, sheets with title rows, two-row headings, extra sheets and typing slips. Until now only `.xlsx`, `.docx` and CSV were read, and everything else was refused with instructions.

**Decision.**
- **Read by content, not by name** (`readClassListFile`, `apps/web/lib/class-list-read.ts`): zip files are told apart by what is inside (`xl/`, `word/`, `content.xml`); old Office files by their compound-file streams (`Workbook`/`Book`, `WordDocument`); PDFs by `%PDF`; the rest is decoded as text (BOM, UTF-16, strict UTF-8, then Windows-1252) and read as a web page, RTF or delimited text.
- **Own readers for the old Office formats** (`apps/web/lib/class-import/`), written from Microsoft's published specifications ([MS-CFB], [MS-XLS] BIFF8/BIFF5, [MS-DOC]) with hard limits on steps, rows (20,000) and columns (80). They only read cell values and text; macros, formulas and embedded objects are ignored. No SheetJS: its npm releases are years old and the maintained builds live off the registry.
- **PDFs with pdf.js** (6.5.438, legacy build for older Android browsers), loaded only when a PDF is chosen; its worker is copied to `/pdf/pdf.worker-<version>.min.mjs` at build time (`scripts/copy-pdf-assets.mjs`). Words are lined up into columns by their x positions (column starts shared by at least a quarter of the lines); the line-by-line reading is tried too and whichever finds more students is kept. PDF results carry a note to check them against the PDF.
- **Scans and photos are refused, not OCR'd.** One misread digit gives a student another student's matric number, and on a register that is worse than asking the department for the original file. The message says exactly that and what to ask for.
- **Workbooks with several lists**: every sheet is read; the one with the most students is shown, and the others are offered beside it with their counts.
- **Headings found the way people write them**: up to 40 title rows above, a heading split over two rows ("Names" over "Surname | Other names"), and headings checked against what is under them (a "Reg No" column of serial numbers is not the number column when another column is full of matric numbers; an "Email" column without addresses is dropped; an unheaded column of UTME/DE is the entry column).
- **Only certain repairs, each reported as a note with an example**: the letters O/I/l typed for 0/1 in a number (only when the result is valid), email slips (commas for dots, `gmial.com`, `st.lasu.edu`, `mailto:`, placeholders like "nil"), "(DE)" after a name (Direct Entry, 200 level), titles before names, and rows repeated word for word. Anything less certain (S for 5, a number with a different name) is left as written for the server's row report.

**Reason.** Parsing stays in the browser, so files never leave the HOC's device unread and the API keeps receiving plain rows that it re-checks exactly as before (dry run, then save all or nothing). Nothing is changed silently, and nothing is guessed where a wrong guess would put attendance on the wrong student.

## ADR 025: Changing a staff member's role or area in place, with a preview

**Problem.** A lecturer appointed HOD, an administrator moved to another department, or someone invited with the wrong role had to be invited again. That is impossible with the same email (the account already exists), so in practice it needed a database edit.

**Decision.** `POST /api/v1/admin/staff/members/{userId}/position` changes the role and area of the same account. The same body with `apply: false` returns what would happen without changing anything; the Staff page always shows that review before the change.
- **Both ends in scope.** The administrator must be able to manage the person where they are *and* where they are going (`canManagePosition` on both), so nobody grants more than they hold or reaches outside their area. Unknown and out-of-scope places get the same `403`. Nobody changes their own role; an institution administrator can only be moved by another one, so at least one always remains.
- **Applies on the next request.** The session reads role assignments live, so there is nothing to sign out: the person's menu changes on their next tap, with the same password and history.
- **Courses that no longer fit are handed back.** Course assignments in semesters that have not ended, in departments the old place covered and the new one does not, are deleted. The courses' other lecturers carry on; the review lists each course with how many other lecturers it has ("Nobody else" when none) and the open disputes waiting on them. Past semesters are untouched, so registers and reports keep the person's name.
- **Not while teaching.** The change is refused while they have a lecture or attendance session open in its time window, so a register is never left half-owned.
- **No lost updates.** The user row is locked, and if their role is no longer the one the administrator saw the change is refused (`409`) instead of applied on stale information.
- **Lecturer profile kept.** Moving to lecturer reuses an earlier profile (staff number and all) and updates its department; moving away keeps it, because past course assignments refer to it.
- **Recorded and told.** One `staff_role_changed` audit event ("Role: A → B; Area: X → Y; Courses handed back: …; Why: …"), shown as before → after in the Audit log and counted as worth a look. The person gets an email with the change, who made it and why.

**Reason.** Re-inviting cannot work for an existing account, and a silent role swap would leave courses taught by someone who can no longer see them. Previewing the exact consequences first, then applying them in one transaction, keeps the courses, disputes and audit trail consistent.

## ADR 026: Disputes can go to the department once, as a separate appeal

**Problem.** A lecturer's decision on an attendance dispute was final. A student who thought the lecturer got it wrong (including when the lecturer was the one who removed their check-in) had nowhere to go inside the app, and attendance decides exam eligibility.

**Decision.** After a rejection the student can appeal to the department that runs the course, once, within `ATTENDANCE_APPEAL_WINDOW_DAYS` (7) of the decision.
- **A separate record, not a new dispute status.** `attendance_dispute_appeals` (migration 0029) holds the student's statement (20–1,000 characters), its own `open | upheld | rejected | withdrawn` status, the decider, the note and the department. The dispute stays `rejected`, so the lecturer's decision remains exactly what it was and the dispute's immutability (ADR 012) is untouched. One appeal per dispute, enforced by a unique key.
- **Guarded in the database too.** A trigger allows an insert only for a rejected dispute, freezes the statement and department, lets the status move only from `open`, and forbids deletion. An upheld appeal applies the same audited `mark_present` correction as an upheld dispute, carrying both `dispute_id` and the new `appeal_id`, in the same transaction.
- **Who decides.** Administrators whose scope covers the course's department: the department administrator (the HOD's office), the faculty administrator and institution administrators. Anyone else gets `404`, as if it did not exist. Whoever turned the dispute down as a lecturer cannot decide its appeal (`409`, and the page says so), so nobody reviews their own decision. The department's decision is final.
- **Eligibility, in order:** the dispute was rejected; no appeal yet (a withdrawn appeal uses up the chance, so withdraw-and-resend cannot reset anything); not already present; still actively enrolled; within 7 days of the decision. `appealDeadline` is non-null in the student's dispute list only when all of these hold, so the app offers the button exactly when the server would accept it.
- **Told without flooding.** The first open appeal in a department emails its administrators (falling back to the faculty's, then the institution's, at most 20); later ones wait in the queue and the menu badge. The decision emails the student and the lecturer who turned the dispute down. Email never blocks the action.
- **Visible everywhere it matters.** Students see the offer, the countdown and the appeal's progress in My attendance; lecturers see Appealed, Upheld on appeal or Appeal rejected on their disputes; administrators get an Appeals page with a badge and an item in Overview. Sent, upheld and rejected appeals appear in the Audit log (upheld ones are worth a look).

**Reason.** A second look by someone outside the course is the normal university route (lecturer, then HOD), and a single, short, write-once step keeps it from becoming an endless loop or a way to wear lecturers down. A separate table keeps both decisions on record side by side instead of overwriting the first.

## ADR 027: Students can confirm their email with Google instead of an emailed code

**Problem.** Every proof of who owns a student account was a 6-digit code emailed to the student's LASU address: opening the account, confirming the email after a HOC's setup code, forgot password, switching from a JAMB number to the matric number, and new face photos. Students who could not get a code were stuck. Some never activated their LASU email or forgot its password (an *access* problem); others had the mailbox but the code was slow, in Spam, or the sending service was down (a *delivery* problem). The setup code was the only fallback, and it depends on a busy HOC and still leaves the email to confirm later.

Considered and rejected:
- **Reading the LASU inbox in the app** (Gmail API). `gmail.readonly` and the other mail scopes are *restricted*: Google verification plus a paid yearly third-party security assessment, unless LASU's Google Workspace administrator trusts the app. It also does nothing for a student who cannot sign in to their LASU account, which is most of the access cases.
- **Domain-wide delegation, or collecting Google passwords.** Far too much power and against Google's policies.

**Decision.** "Continue with Google" next to every emailed code. `st.lasu.edu.ng` is Google Workspace, so a student signed in to their LASU account on Google's own page proves they own the address, with no code.
- **OpenID Connect, implicit `id_token` flow, scope `openid email` only.** These scopes are non-sensitive: no Google review, no assessment, and Google shares the address, never the mailbox. No client secret exists, so the only setting is `GOOGLE_CLIENT_ID`; without it the routes answer `503` and the button is hidden.
- **A full-page redirect, not a popup** (`/auth/google`): popups are blocked by this site's `Cross-Origin-Opener-Policy` and break in installed apps. The page wipes the fragment from the address and history at once.
- **Bound to the browser and the step.** The browser keeps a random 32-byte nonce and a `state` in `localStorage` (never a password); Google only sees base64url(SHA-256(`purpose:nonce`)). The server checks the RS256 signature against Google's published keys, the issuer, the audience (our client ID), expiry, that the token is at most 15 minutes old, the nonce for that exact purpose (`open`, `reset`, `email`, `matric`, `face`) and `email_verified`. A token caught in transit is useless without the nonce, and one made for opening an account cannot reset a password.
- **The same rules as a code, plus Google's.** A LASU address counts only with Google's hosted-domain claim `hd = st.lasu.edu.ng` (a lookalike personal account cannot pass). A student on a JAMB number may use a personal Gmail (or a Workspace account whose `hd` is its own domain). The address must then pass exactly the checks a code address does: the class list's address when it has one, unused by another account; for forgot password and new face photos, the account's own email. New face photos still need the password too.
- **The codes and the setup code stay.** Google is an extra way in, recorded in the audit trail as "with Google" instead of "with a code"; nothing is removed.
- **Shown only where it can work.** Hidden on preview deployments (Google returns only to the production address), with a hint inside WhatsApp's or Instagram's browsers (Google refuses those).

For the access problem, the Help page now explains activating the LASU email from the portal's *WIRELESS & EMAIL* page, Gmail's own password recovery by SMS, and LASU's mail support address.

**Reason.** It fixes the delivery problem outright for the most common case (a student signed in to their LASU Gmail on their phone), uses only what Google offers any website without review, adds no secret to keep, and keeps every existing safeguard. The access problem can only be solved by LASU's own account recovery, so the app points students to it clearly instead of pretending to.

## ADR 028: Sign in with Google, for confirmed accounts only

**Problem.** After ADR 027 a student could confirm their email with Google but still had to remember a password to sign in again, and a forgotten password meant a reset every time.

**Decision.** "Sign in with Google" on the sign-in page, for every kind of account. The same Google proof as ADR 027 with its own purpose, `signin`, so a proof made for any other step cannot sign anyone in. `POST /api/v1/auth/google` with `{ google }` opens a session for the account that uses the address Google vouches for, under these rules:
- **Only addresses Google runs:** a LASU student email from LASU's Workspace (`hd`), a Gmail address, or a Workspace domain's own address (e.g. staff `@lasu.edu.ng`, if LASU staff mail is on Google). An Outlook or Yahoo address registered as a Google account proves nothing and is refused.
- **Only active accounts with a confirmed email.** An unconfirmed student account (opened with a HOC's setup code, email typed but not proved) is never handed over this way, because whoever typed the address may not own it. Its owner signs in with the password and confirms the email (with a code or Google) first. Invited staff accept their invitation first; suspended and closed accounts are refused.
- **Specific answers.** The person has just proved they own the address, so "No LASUATOS account uses …" or "isn't confirmed yet" gives nothing away to anyone else.
- **Same session as a password sign-in** (same lifetime, same cookie, same "where you're signed in" list). Passwords keep working; nothing is linked or stored from Google.

**Reason.** Most students are signed in to their LASU Google account on their phone, so this turns signing in into one tap and makes forgotten passwords rare, without weakening anything: Google's sign-in (often with 2-step verification) is at least as strong as the password it replaces, and only the account's own, already-proved email counts.

## ADR 029: Email fails over between providers, and operators see trends and system health

**Problem.** Brevo's free plan allows 300 emails a day (transactional and marketing together, reset at midnight UTC). A busy start of semester, with every new student asking for a code, can use that up by midday, and from then on sign-up codes and password resets silently stop until midnight. Alerts covered single crashes but not slow-building trouble: wrong passwords piling up, students hitting rate limits at the start of a big lecture, or Google sign-in refusing everyone after a setup change. Nobody could see any of this without reading Vercel logs.

**Decision.**
- **A provider chain.** `EMAIL_PROVIDER` is tried first, then every other provider with credentials (`EMAIL_FALLBACK_PROVIDERS=auto`, the default), or an explicit list (`resend,gmail`) or `none`. Resend is left out of `auto` when the sender is a free mail address, because Resend only sends from a verified domain. Each failure is classified from the provider's answer: **quota** (HTTP 402 or Brevo's `not_enough_credits`, a 429 that names a daily limit or quota, Gmail `550 5.4.5`), **setup** (bad key, blocked IP, unverified sender or domain, Gmail `535`/`534`/`553`), **network** (timeouts, 5xx, a per-second 429, Gmail `421`), **recipient** (a bad address, which no other provider would accept either, so no failover) or unknown.
- **Shared counts and pauses.** Every send and refusal is counted per provider per UTC day in `email_provider_days`, shared by all serverless instances. A provider that ran out is skipped until midnight UTC (Gmail, which counts a rolling 24 hours: three hours later); a setup problem skips it for 30 minutes and a network error for 2. A provider at its daily limit (`EMAIL_DAILY_LIMITS`, defaults Brevo 300, Resend 100, Gmail 500) is skipped before it refuses. A skipped provider is still tried last, never dropped, so a wrong guess costs one slow email rather than a lost one. When the counting store fails, email still sends.
- **Alerts for email.** A switch to a backup (once per provider and reason per 6 hours), every provider failing (every 30 minutes), and a provider at 90% and 100% of its allowance (once a day each). Operator alerts themselves are sent through the same chain without raising further email alerts.
- **Trend alerts.** Counted in the shared rate-limit store per window: 60 requests refused as too fast in 10 minutes, 15 server errors in 10 minutes, 80 failed password or check-in sign-ins in 15 minutes, 5 Google setup failures (wrong audience, keys unreachable) or 30 refused Google proofs in 15 minutes. Each raises one alert per hour at most.
- **System health page** (`/admin/health`, `GET /api/v1/admin/health`, institution administrators only, never cached): one overall answer (ok, needs a look, students affected), the database (latency, migration, this instance's pool), each provider in order with today's count against its allowance, the last 7 days and the last refusal, the trends against their lines, the last 20 alerts (kept 30 days in `operator_alert_events`, with whether each was emailed), the nightly clean-up, Google and the rate-limit store. The daily retention run prunes alerts after 30 days and provider counts after 90.

**Reason.** Gmail's App Password was already configured in production, so with the default `auto` the site gets Brevo → Gmail (800 emails a day) on the next deploy with no new settings. Classifying failures keeps one student's mistyped address from switching providers for everyone, and sharing the counts in PostgreSQL stops every cold-started instance from re-learning that Brevo is out. Trends catch the problems that never throw a 500. The page answers "is it me or the site?" without opening Vercel.

## ADR 030: LASU mail, a read-only inbox that never touches our servers

**Problem.** Students live in LASUATOS during lectures, but lecturers, departments and the university reach them by email at their LASU address, which many rarely open. ADR 027 rejected reading the inbox *to deliver sign-up codes*, because a student who cannot sign in to their LASU account gains nothing. Reading mail for students who *can* sign in is a different need, and the obstacles ADR 027 named can be handled.

**Decision.** A LASU mail page (`/mail`) that shows the student's LASU inbox, read-only, inside the app.
- **Browser only.** The browser gets a one-hour Google access token for `gmail.readonly` (OAuth implicit flow, `response_type=token`, `include_granted_scopes=false`) and calls `gmail.googleapis.com` itself. The token and every message stay on the device: the token in that tab's `sessionStorage`, messages in memory. LASUATOS has no route that receives either, stores nothing about the mailbox and keeps no refresh token. This is what keeps the app out of Google's paid yearly security assessment (CASA), which applies to apps that store or move restricted data through their own servers.
- **Read only, by scope.** `gmail.readonly` cannot send, delete, label or mark as read. Replying opens the email in Gmail.
- **Same client and return page as Continue with Google** (ADR 027): no new redirect address to register, still a full-page redirect (popups are blocked by our opener policy), and `/auth/google` hands each answer to the flow whose `state` it carries. After the first time, an expired token is renewed silently with `prompt=none`; a failed silent attempt is not retried for two minutes, so nothing loops.
- **Only LASU mailboxes.** Google's chooser is narrowed with `hd`, and the page checks the mailbox Gmail reports against `LASU_MAIL_DOMAINS` (default `st.lasu.edu.ng`); anything else is disconnected and its permission revoked at once. A student registered with a personal email can still connect their LASU mailbox, because Google's sign-in proves they own it.
- **Safe to show.** Email HTML is cleaned (no scripts, frames, forms, event handlers, `javascript:` links or remote CSS) and shown in a sandboxed `srcdoc` frame with no scripts. Web pictures stay hidden until the student taps *Show pictures* for that email, so senders cannot tell when it was read. A green LASU badge appears only when Google recorded DMARC passing for a LASU domain; a LASU address that failed it gets a phishing warning.
- **Switched on deliberately.** `LASU_MAIL=off|pilot|on` (default `off`), with `LASU_MAIL_PILOT` listing the accounts that see it in `pilot`. `GET /api/v1/mail/config` tells the signed-in account whether it is on; the menu item appears only then. Signing out forgets the token and the connection on that device; *Disconnect* also revokes the permission at Google.
- **Content Security Policy.** `connect-src` adds `https://gmail.googleapis.com` and `https://oauth2.googleapis.com` (revocation); `img-src` allows `https:` for pictures the student chose to show. The policy is per document and the app changes pages without reloading, so these apply site-wide.

**What it needs from Google or LASU.** `gmail.readonly` is a restricted scope. Until LASU's Google Workspace super administrator marks the LASUATOS OAuth client as *Trusted* (Admin console, Security, API controls, App access control), or Google completes restricted-scope verification for a browser-only app, only test users added on the consent screen (at most 100) can connect; LASU's own settings may also block it (`admin_policy_enforced`), which the page explains in plain words.

**Reason.** It meets students where they already are, costs nothing to run, and holds the least possible data: none. Keeping the mailbox between Google and the student's browser is both the privacy answer and the compliance answer. ADR 027's rejection still stands for its purpose (codes go by email or Google sign-in, not the inbox).

## ADR 031: The lecture-start rush: face checks off the request thread, a bounded line, and phones that retry

**Problem.** The lecture-start load test (`pnpm load:rush`, docs/LOAD_TESTING.md) put 300 students through QR scan, two face photos and submit in one minute on one function instance with production wiring. 59 were lost: the face models ran on the request thread, so scans, the lecturer's list and database calls waited behind photos (QR scans took 7.5 s, waiting database requests timed out into 500 errors); every photo joined one queue, so everyone finished at the end; requests waited until the 30-second platform limit cut them off; and the page did not retry. A face check costs about 0.4 CPU-seconds, so one instance finishes roughly 2.5 to 3 a second whatever the code does.

**Decision.**
- **Worker thread.** `createFaceEngine()` analyses on its own worker thread (the same file, in deployments the bundled `face.mjs`, started with a flag); the request thread only passes photos to it. `FACE_THREAD=inline` keeps the old behaviour for debugging.
- **One check-in at a time, first come first served,** per instance (`FaceVerifier`), with the review portrait cut only for a close match.
- **A bounded line.** If a check-in's photos could not start within `FACE_QUEUE_BUDGET_MS` (15 s by default), the instance answers 503 with `Retry-After` at once and analyses nothing; one admitted but slowed down past one and a half times the budget (at most 24 s) is turned away the same way. The expected wait uses how fast the line really moved. For check-in the answer comes from an `onRequest` hook, before the photos are read and before the per-address and sign-in limits count the request. `Retry-After` is spread at random over the time recently turned-away phones' photos will take (3 to 45 s).
- **Phones retry the same photos** (check-in is idempotent): busy waits as asked or longer each time (3 s growing by half, to 30 s) with up to a quarter random extra, for up to 3 minutes; dropped connections, timeouts and 502/504 are tried 3 times. The page tells the student to keep it open and that new photos are not needed.

**Rejected.** A bigger connection pool (the connections were waiting for the thread, not the database); queueing in the database across instances (more load on the database at the worst moment, and Fluid compute already spreads work over instances); shorter photos or skipping the turned photo (weakens the liveness check; may be revisited with measurements); fixed short retry intervals (the test measured 18,751 retries for 900 students, using up the hall's per-address limit).

**Reason.** After the change the same rush saved 300 of 300 on one instance, with scans at 16 ms, and two instances finished it in under 6.5 seconds per student; 900 students on two instances saved 899 (one ran past the 3-minute window), with no 5xx. The cost that remains is CPU: on Vercel Hobby the 4 monthly active-CPU hours cover about 20 mornings of six 300-student classes with the face check (docs/DEPLOYMENT.md).

## ADR 032: Accessibility and privacy review: what the notice promises is what the code does

**Problem.** A review of the student pages with a screen reader, 200% text, 320-pixel screens and 150–200% zoom (WCAG 2.2 AA, reflow 1.4.10), and of the privacy notice against what the database, logs and browser actually hold. Found:
- the page could not shrink below 320 pixels, so zoomed pages scrolled sideways;
- the site header, page headers, empty states and the 404 picture overflowed at 200% zoom;
- most form fields wrapped their hint (and any error) inside the `<label>`, so screen readers read "Full name As on your class list" as the field's name;
- check-in results and "busy, retrying" waits were not announced;
- 404s inside a workspace (`/admin/…`, `/account`) threw React error #418, because the one prebuilt 404 page carried the public frame;
- `/account` had no page.
The notice was also out of date:
- it missed help requests, disputes and appeals, contact messages, sign-ins, the JAMB number, rep assistants, the liveness result and System health;
- it promised "no analytics" without saying that no outside scripts run at all;
- it gave no deletion times for codes and sign-ins, which were in fact never deleted;
- request logs held IP addresses and query strings, and alert emails could carry email addresses.

**Decision.**
- **Sign-ins and codes are deleted.** The nightly retention run (`/api/v1/cron/retention`) also runs `SignInCleanup`. It deletes sign-ins that ended more than a day ago, keeping each person's latest one (the "last active" date staff see). It also deletes spent or expired email codes, setup codes and reset or confirmation links after a day. The response adds `signInsDeleted` and `codesDeleted`.
- **No IPs or emails in logs or alerts.** The request log line keeps the method, the path without its query string, and the host. Alert text is scrubbed of email addresses, and crash reports keep only a coarse browser such as "Chrome 131 on Android 14", never the user agent.
- **The notice lists every kind of record, who sees it and when it goes,** with the date it changed. The terms match it.
- **Reflow.** Nothing is wider than the screen. Headings wrap between words, and only break inside one that cannot fit a line. Below 360 pixels buttons wrap and pictures shrink. Below 300 pixels the site header keeps the mark and moves the wordmark and the CTA label to screen-reader text.
- **Field names.** `nameWrappedFields` (components/ui/form-validation.tsx) runs once in the shell and again whenever fields appear. A control wrapped by its label is named by the label's own `<span>`, and the label's other text (hints, counts, errors) becomes its description. New forms get this without extra code. Hand-built fields keep using `htmlFor` plus `aria-describedby`, as `PasswordField` does.
- **Announcements.** The check-in result moves focus to its heading. Waits are spoken from status regions that are always on the page: check-in, and face registration, which now also re-sends the same photos by itself when the server is busy.
- **404s render per request,** so the frame matches the address. `/account` redirects (307) to `/account/security`.

**Rejected.**
- Rewriting the 44 wrapped labels by hand: easy to miss one, and new forms would repeat the mistake.
- Allowing pinch-zoom again: the app keeps `user-scalable=no` on purpose (layout.tsx). It is tested at large text sizes and browser zoom instead.
- A cookie banner: no cookies other than the sign-in one, and no outside scripts.

**Reason.** At 390 and 320 pixels, 200% text, 150% and 200% zoom: no axe violations and no sideways scrolling on 17 student and public pages, and no console errors on any 404. Deletion and scrubbing are covered by tests. The Vercel dashboard's Web Analytics switch collects nothing, because the app has no analytics script; it should be switched off so it cannot be turned into one without a code change.

## ADR 033: Deep security review: a guessable password proves nothing, and every check-in checks the face

**Problem.** A full review of the platform covered:
- all 182 API routes, each called signed out, as a student, a class rep, a lecturer and administrators of other areas;
- a fuzzer that sent 27,630 malformed and hostile requests;
- the dependency audit;
- a reading of the authentication, face, check-in, export and email code.

Nothing returned another area's data, no request caused a 5xx except one (below), and the production dependencies have no known advisories. It found, by severity:
- **High (F13): the starting password could hand over a face.** `LASU<matric><SURNAME>` is worked out from the class list. Anyone who knew a classmate's number and surname could sign in as them before they had registered a face, register **their own** face, and from then on pass every face check as that student. They could also change the password and lock the student out.
- **High (F12): course sessions skipped the face check and the phone rule.** Lecture check-ins (`/a`) confirm the face and allow at most two students per phone. Course-offering check-ins (`/check-in`, and a typed code on My attendance) did neither, so a forwarded code or QR marked anyone from anywhere.
- **High (F2): the room check was off unless switched on.** A lecture with a mapped venue still accepted a forwarded QR from home, unless the person remembered to turn on "Check they're in the room".
- **Medium (F11): personal email addresses shown to strangers.** Typing a JAMB number on the sign-up page returned the full personal address the code went to (for example a Gmail address). The same happened in "already open", "wrong Google account" and "class list has a different email" messages.
- **Medium (F10): CSV injection.** The API's exports already defused formulas, but the five downloads built in the browser did not cover cells that start with a tab or carriage return. The class-list download did not defuse formulas at all.
- **Medium (F14): a 500 error.** A retention-set address with a nearly valid id reached PostgreSQL's uuid cast and failed with a 500.
- **Low (F1):** anyone can post a page-crash report, and each new message used up one of the 20 alert emails a day, so made-up reports could hide real server alerts.

**Decision.**
- **Sessions started with the starting password are marked** (`user_sessions.starting_password`). The mark counts only while the account is still on that password (`password_is_default`), and is worked out on each lookup. A marked session:
  - cannot register a face (`403`);
  - cannot change the password with the current one (`403`). The student chooses a new one with the emailed code or Google instead, in Account setup. This starts a fresh, unmarked session and signs out every other one.
  - cannot mark attendance while face checks are off, because then nothing else proves who is marking.

  Opening the account, resetting the password, a setup code and Google sign-in all prove the email, so those sessions are never marked. A student who opens their account and registers a face on the same phone sees no difference. Setup reports `choosePassword`, and the setup screen, home card and Account page send the student to "Choose your own password". Someone on the starting password with an unconfirmed email confirms the email first.
- **Course check-in takes two calls**, the same as lecture check-in:
  1. The code or QR is checked against every rule (open, enrolled, QR-only, phone, venue). Nothing is written. The answer is `face_required` with a ticket, valid for 10 minutes, signed for this student and session, that remembers whether they scanned or typed.
  2. The ticket and three photos are checked again against every rule, then the face. The check-in and its `face_score` are written in one transaction.

  The phone rule is two students per phone per session. It is counted again under the session row lock, so two students cannot both slip in at once. Failed face checks count towards the existing six-per-30-minutes limit. When `FACE_CHECK=off`, the first call marks attendance directly, as before. A typed code on My attendance now opens `/check-in`, which runs the location, face and ticket steps. The face camera cannot open inside the bottom sheet.
- **The room is checked by default when the venue is mapped.** This applies to the New session form and to `POST /lecture/sessions` when `requireVenue` is left out. Turning it off is still one switch away. A venue without a registered location stays unchecked rather than refused.
- **Strangers see a personal address only partly** (`addressForStranger`): `ku•••@gmail.com`. LASU student addresses stay whole. They follow the name the lookup already shows, and students need them to know which mailbox to open. The web app does not pass a hidden address to Google as a sign-in hint.
- **One CSV rule** (`apps/web/lib/csv.ts`) for every browser download: quote every cell, and put an apostrophe before a leading `= + - @`, tab or carriage return. This matches the API's `csvField`.
- **Malformed ids are a 400** at the route, before the database sees them. `AUDIT_ENTRY_ID_PATTERN` now accepts only real uuids.
- **Page errors get their own budget**: at most 5 of the 20 alert emails a day. It is checked first, so made-up reports cannot use up what server alerts need.

**Rejected.**
- **Forcing every student to change the starting password at first sign-in.** It would block everyone who opened their account and is on the way to class, and a student without email access that day could not mark attendance. Only the sessions that prove nothing are limited, and only for the two actions that matter.
- **Marking sessions that existed before this change.** There is no way to tell an account-opening session from a starting-password sign-in. Marking them all would send students who have already proved their email back through a code. The exposure is limited to someone who signed in as a classmate before the deploy and has not yet registered a face.
- **Choosing the head-turn direction only after the photos are taken (F4).** The turn comes from the ticket, so a determined attacker knows it a moment early. Passive liveness, the venue check, the phone rule and the session taker's eyes remain, and replacing this means a new capture flow. It is listed as a known limit.
- **A nonce-based page CSP (F9).** Still the follow-up already listed in SECURITY.md. It needs dynamic rendering of every page.

**Accepted low and informational findings.**
- **F3:** the phone rule counts only phones that send their device token. Clearing site data gets a new one, and the lecturer still sees "Shared device" for repeats.
- **F5:** a typed course code is 6 characters, about 30 bits. Misses are rate-limited per session.
- **F6:** the matric lookup tells students whether an account is open and whether the list has an email, so they know which step comes next.
- **F8:** a few routes check the body shape before the session. Neither order reveals data.

**Reason.** Each fix is covered by tests:
- marked sessions: a unit test and the onboarding e2e (`403` on face and password, a clean session after opening);
- the ticket: refused for another student, altered or expired;
- the phone rule: before and under the lock, in PostgreSQL;
- `face_score` stored;
- the room-check default;
- address masking;
- CSV cells;
- the 400 for malformed ids;
- the page-error budget.

The full suite, tsc, ESLint and the production build pass. Migration 0031 applies on PostgreSQL 17.

## ADR 034: A public status page that runs apart from LASUATOS

**Problem.** When LASUATOS is slow or down, students only see a page that won't load. They can't tell whether it is their phone or the network, or whether anyone knows. Administrators have System health (ADR 029), but it needs LASUATOS and a sign-in, which is exactly what fails. Students need a page they can open while LASUATOS can't, telling them:
- what is affected;
- what to do meanwhile;
- when it is fixed.

It must keep working when the repository becomes private. It must also cost nothing.

**Decision.**

**Hosting.** A Cloudflare Worker (`status/`) with a Cron Trigger and a D1 database, on the free plan.
- GitHub Pages was asked for first, as the address. It can serve only fixed files, so it can't check LASUATOS every minute, keep history or answer the app's banner. Its Actions-based checkers run every 5 minutes at best, are often late, and stop with the repository's free minutes once it is private.
- Vercel Hobby crons run only once a day, and Vercel would share LASUATOS's failure anyway.
- The Worker runs on another provider and network from Vercel and Neon. Its `workers.dev` address costs nothing, and a custom domain can be added later.

**Checks, every minute from outside.**
- The home page must answer 200 and really be LASUATOS.
- `GET /api/v1/health` must answer.
- A deep check reads LASUATOS's new public `GET /api/v1/status`. It runs every 5 minutes by day and every 30 at night (so the free database can sleep), and every minute while anything is wrong or an automatic incident is open.
- `/api/v1/status` gives only coarse states (`core`, `errors`, `email`, `google`, `face`: operational, degraded, down or off), never providers or counts. A face-engine signal (`face_unavailable`, 3 failures in 10 minutes) was added for it.
- Every failure is retried once before it counts.

**Display.**
- Six parts in student words: Website, Sign-in and accounts, Google sign-in, Attendance check-in, Face check, Emails. A part turned off in LASUATOS is hidden.
- A worse state shows at once. Better needs two good runs.
- The headline says "major" only when the website, sign-in or attendance is down, or two or more parts are. One side part down is a partial problem.

**Incidents are GitHub issues, so maintainers post from their phone.**
- After two bad runs the checker opens one issue (`status`, `auto`, impact, components), widens it, and closes it after three good runs.
- Without GitHub it keeps the incident on the page only.
- Maintainers' own issues labelled `status` become incidents. Adding `maintenance` with `Starts:`/`Ends:` lines in WAT makes it planned maintenance, shown as completed after its end even if nobody closes it.
- Comments become the timeline (`Identified: …`, `Resolved: …`). Text in `<!-- -->` stays private. Issues and comments from anyone but owners, members and collaborators are ignored.
- The token is fine-grained, with Issues read and write on one repository only, so a private repository works the same.

**The page.**
- Rendered on the server, in the LASUATOS brand.
- Works without JavaScript; light and dark.
- Phones see 30 days and their uptime, computers 90.
- Strict CSP with a script nonce. No third-party fonts, scripts or trackers.
- Incident text is escaped, and only https links are kept.
- Also served: an Atom feed, JSON and a badge.

**In LASUATOS.**
- A notice pill (beside the offline pill) shows the current incident or maintenance planned within a day, dismissible until the next update.
- It reads `GET /api/v1/status/notices`. The server fetches the notices from `STATUS_PAGE_URL`, so the browser only talks to LASUATOS and the CSP stays `'self'`. They are cached a minute, kept for ten minutes if the status page is unreachable, and only kept when they link to the status page.
- `/status` redirects to the status page, and Help and the footer link to it.

**Not chosen.**
- **A hosted status service** (Instatus, Better Stack, Statuspage). The free tiers limit checks and branding, and add a company that sees the traffic.
- **The browser fetching the status page directly.** It would widen the CSP and send every student's address to Cloudflare.
- **Storing every check.** Minutes per part per day, plus five-minute response-time buckets, keep writes to about 11,500 rows a day, against D1's free 100,000. A page view reads one prepared row.

**Reason.**
- The rules are pure functions, unit-tested: states, recovery, incident open, widen and close, impact, deep-check timing, issue parsing, maintenance windows, Markdown escaping, day bars and uptime.
- The checker is tested end to end over SQLite, against a fake LASUATOS and a fake GitHub (with ETags). The cases: an outage opening, widening and closing one issue; maintainers' updates; GitHub unreachable; no GitHub; an issue a maintainer closed early; maintenance not counting against uptime; a removed label.
- The API side has tests for `/api/v1/status` and the notices source, and the notices the Worker serves are checked against `StatusNoticesSchema`.
- The Worker was bundled with `wrangler` and run in the Workers runtime with local D1. A simulated database outage opened an incident, served the banner notice, and closed when LASUATOS recovered.

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
- Approved login and identity provisioning mechanism. Staff invitations (ADR 014) are implemented; whether LASU accepts the default delegation rule, and whether staff should come from an institutional identity provider instead, is still open.
- Data retention (including dispute and appeal statements), and the dispute and appeal window lengths (ADR 026 implements escalation to the department; whether LASU wants a further step to the faculty is open).
- Venue registration authority beyond the implemented institution-administrator default (motion-based approval, separate reviewer role) and per-venue geofence radius policy.
- Production hosting for an official pilot (the free setup in ADR 015 is for personal, non-commercial use), regional data processing and security operations ownership.
- Administrator-assisted account recovery for users who have lost access to their registered mailbox, and the identity checks it requires.
- Whether LASU's Google Workspace administrator will mark LASUATOS as a trusted app, which LASU mail (ADR 030) needs to open beyond 100 test users without Google's restricted-scope verification.
- Final rate-limit values, to be tuned from measured staging and pilot traffic.
