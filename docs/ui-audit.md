# Signed-in app: UI/UX audit

November 2026. This audit covers every signed-in screen for four accounts: a student, a HOC, a lecturer and an institution administrator. Each screen was checked at 390 px (iPhone 14) and 1280 px wide.

The screens ran against real seeded data, not mocks:

- 42 students on the ECE 2024 class list, 38 of whom have accounts;
- 20 past lectures across three courses over eight weeks;
- one live session with 17 students checked in.

Checks were made with axe-core (WCAG 2.0/2.1/2.2 A and AA), DOM measurements (overflow, target sizes, type sizes) and a throttled phone profile (4× CPU, 1.6 Mbps, 300 ms latency).

This is the baseline for the design system in [design-system.md](./design-system.md). Screens are fixed in the agreed order: student, then lecturer, then admin, then the rest.

Priority key:

- **P0** misleads people or blocks a task;
- **P1** costs trust, speed or consistency on every visit;
- **P2** polish.

## What already works

Keep these:

- **No horizontal overflow** on any screen at either width.
- **Almost no automated accessibility failures.** axe found one issue: 3 low-contrast nodes on the admin course list.
- **Check-in is short and honest.** Scanning goes straight to a card that shows the course, the student's own name and matric number, and one *Mark me present* button. Nobody can be marked by typing a name.
- **The register is useful.** The lecturer's register shows sessions as columns, with a P or a dot per student and a coloured percentage. It already has *Below 75%*, *Required 75%*, Excel and print.
- **Phones already get bottom tabs**, a *More* sheet, 16 px inputs (no zoom on focus) and safe-area padding.

## P0: fix first

1. **A live lecture counted as missed.** *Fixed in this change.*
   - **Before:** while a session was still open, *My attendance* counted it as held. A student who opened the app before scanning saw their rate drop. In the test data ECE 305 went from 62.5% (5 of 8) to 55.6% (5 of 9), and the *below 75%* warning was triggered mid-lecture.
   - **Now:** a session counts once it has ended or been closed. Students who have already scanned see it counted immediately. There is a regression test in `semester-end.integration.test.ts`.
   - **Still to do:** the lecturer's register still shows the live column as dots; see lecturer item L3.
2. **The account button showed a truncated surname.** *Fixed in this change.*
   - **Before:** the account pill used the full display name, so class-list names (SURNAME first) showed as "OKAFOR …" and "OLADIPO …". This happened in the header of `/a`, on the screen students use most, and in the desktop top bar.
   - **Now:** it shows "Chidinma" for students or "Dr. Adeyemi" for titled staff. The menu still shows the full name.
3. **A gold dot sat on every sidebar link.** *Fixed in this change.*
   - **Before:** a decorative 6 px dot appeared on all links. It looked like an unread marker everywhere, which hid the one badge that means something (open disputes, new messages).
   - **Now:** the dots are removed; real badges remain.
4. **Two different shells for the same task.**
   - `/a` (scan) has its own light frame: brand, account pill, no tab bar.
   - `/check-in` (the scanned link) sits inside the workspace, with the tab bar and a different header.
   - A student moving between them sees the frame change under them. Both should use the iOS frame. *Student phase.*

## P1: consistency and trust

5. **No design system.** `globals.css` is 10,041 lines, with the following counts:

   | Measure | Count |
   |---|---|
   | Distinct hex colours | 629 |
   | Distinct font sizes | 90 |
   | Distinct shadows | 74 |
   | `border-radius` declarations | 435 (12 common values: 6–18 px, 99 px and 999 px) |
   | `!important` | 35 |
   | `@media` blocks | 104 |
   | Families of button classes | ~30 (`button-primary`, `account-primary-button`, `lx-big-button`, `st-btn`, `sx-primary-button`, `report-danger-button` and more) |
   | Patterns for page headers | 4 (`page-heading`, `admin-overview-heading`, `lx-session-head`, `student-greeting`) |

   The workspace shell is restyled in four separate places at 760 px. Each later block undoes the one before. The latest example was an icon-pill tab style overriding a solid-pill style.
6. **Page titles disagree.**
   - Staff, Venues, Structure and Course list put their h1 inside a card header at 17 px. Registers, Sessions and Administration use about 31 px; the session screen uses 28 px.
   - On phones the top bar also repeated the title directly above the same large heading ("Take attendance" twice).
   - *Shell fixed in this change:* one large-title style on every screen. On phones the bar's small title fades in only once the large title scrolls under it, as on iOS.
7. **Desktop chrome type was 8–11 px.**
   - Before: sidebar links 11 px, breadcrumb 10 px, the account name and "Africa/Lagos" 9 px, the footer 8 px. These were readable only because of `--type-boost`.
   - *Fixed in this change:* links 13.5–14 px; breadcrumb and account name 13 px; the time-zone label and the three-line footer are removed (they were noise).
8. **The tab bar did not feel native.**
   - Before: a solid 97% white slab with a drop shadow, plus a coloured pill behind the active icon (a Material pattern, not iOS).
   - *Fixed in this change:* a frosted bar with a hairline, 24 px icons, and the active tab tinted navy with a heavier stroke. Pressing dims the tab. The bar falls back to solid with `data-lite` and with *prefers-contrast*.
9. **The phone top bar did not feel native either.**
   - Before: it always had a border and the title was left-aligned.
   - *Fixed in this change:* the bar blends into the page at the top. Once content passes under it, it becomes frosted with a hairline. The title is centred. All of this is done with attributes, not re-renders.
10. **Copy outweighs content.**
    - The Administration overview stacks seven cards. Each is a kicker, title, two-line description and a pill button; on phones the pill button wraps ("Open course / list").
    - It ends with an "Academic overview / Access verified" card that says nothing actionable.
    - The Staff page spends a whole screen on explanations before the list.
    - *Admin phase:* use a grouped list of destinations with one line each and the counts on the right.
11. **Long lists have no structure on phones.**
    - *Take attendance* lists every past session as a full card: 17 cards, about 2,800 px tall, with no grouping by week or course and no "show more".
    - On the HOC's class list, each of 42 rows has a badge plus three icon buttons; the page is about 4,700 px tall on a phone.
    - *Lecturer and HOC phases:* inset grouped lists, section headers by week, search that stays in view while scrolling, and swipe-style row actions moved into a row menu.
12. **The live session layout puts controls before the class.**
    - On phones, five full-width buttons (+15 min, printable QR, close, edit, delete) sit between the QR code and the student list. *Delete* is a red text link one tap away from *Close attendance*.
    - *Lecturer phase:* the QR first, then a live count, then one primary action with the rest behind a "More" sheet. Delete moves into that sheet with a confirmation.
13. **Empty and loading states vary.**
    - Only 6 components use the skeleton or empty-state primitives.
    - "No pending invitations." is a bare sentence.
    - The class list shows a progress bar at 0 with no explanation.
    - *All phases:* use `EmptyState` and `SkeletonLines` from the design system.
14. **Performance on a slow phone.**
    - Every route loads one global stylesheet of 285 KB (54 KB gzipped). This includes `/a`, which needs about 5% of it.
    - With throttling, `/attendance` transfers 477 KB and is idle after about 8 s (first contentful paint at 1.9 s). `/a` transfers 17 KB on a warm cache and paints at 1.1 s.
    - The stylesheet shrinks as screens move to `ds-*` classes and their legacy rules are deleted.

## P2: polish

15. **Target sizes.** These controls are under 24 px: 8 on Academic structure; 2 each on Staff, Venues, Audit log and Course tools; 1 each on Administration, My attendance and the live session. WCAG 2.2 AA 2.5.8 sets 24 px as the minimum; the design system uses 44 px.
16. **Small grey text sat right at the AA limit.**
    - About 20 near-identical greys (`#647278`, `#657179`, `#66737c` and others) measured 4.37–4.6:1 against the page background, so any change of background pushed them under AA.
    - *Fixed in this change:* all 72 small-text greys now use `--ds-label-3` (5.1:1 on the page, 5.7:1 on white).
    - After this change, axe reports **0 violations on all 32 screens** at 390 px.
17. **Status colours.**
    - Amber and green badges use about 12 different tints across screens.
    - Low-contrast text on the admin course list failed AA (axe: 3 nodes); item 16 fixes it.
    - The design system defines one tone per state, each checked at AA or better on white, the page background and every soft fill.
18. **The "Updates on its own" live indicator** pulses on screens where nothing is live (student, no open session).
19. **Numbers** are not tabular in tables and counters, so they jitter as they change. Use `font-variant-numeric: tabular-nums` (`ds-num`).
20. **Dates** read "Sun, 15 Nov 2026 · 08:30–10:00" on the same day. Use "Today, 08:30–10:00".

## By role: what each phase will change

### Student

- **S1.** One iOS frame for scanning, check-in and history (P0 #4).
- **S2.** *My attendance* gets a large title and a per-course list:
  - each course shows its rate, a 75% marker and the number of lectures needed to recover;
  - the setup banner becomes a compact row;
  - the "Live now" card appears only when something is live.
- **S3.** The check-in result screen:
  - adds haptic-style motion (a check that draws in);
  - says "You're in. ECE 305, 08:31." clearly;
  - offers one way back.
- **S4.** History is grouped by week, with a native-looking segmented filter (All, then one segment per course).

### Lecturer

- **L1.** Live session: the QR code first; it fills the screen with a wake lock; the count updates live; secondary actions sit in a sheet (#12).
- **L2.** Sessions: a grouped list by week, with the open session pinned at the top (#11).
- **L3.** Register:
  - mark the live column as "Live" and leave it out of percentages until it ends;
  - keep the student column sticky when scrolling sideways on phones.
- **L4.** Disputes, reports and face checks use the same list rows and sheets.

### Administrator

- **A1.** The overview becomes a dashboard: today's sessions, check-ins, departments below 75%, and a grouped list of destinations (#10).
- **A2.** Tables (staff, class lists, courses, venues, audit) get one shared toolbar (search, filter, export), row menus and clear empty states.

## How this was measured

The audit tooling is kept outside the repository:

- puppeteer;
- axe-core 4;
- a PGlite database served over the Postgres protocol, seeded through the real API (class-list import, sign-up, sessions, QR check-ins).

Every screen was captured at 390 px and 1280 px. axe ran at 390 px. Target sizes, type sizes and overflow were measured in the page.
