# LASUATOS design system

This guide covers the signed-in app. It describes one set of tokens, a small set of components, and one rule: **on a phone, LASUATOS should feel like a native iPhone app; on a laptop, like a calm, dense tool.** The findings behind it are in [ui-audit.md](./ui-audit.md).

| What | Where |
|---|---|
| Tokens | `apps/web/app/tokens.css` (`--ds-*`) |
| Components | `apps/web/components/ds/` (import from `components/ds`) |
| Component styles | `components/ds/ds.css` |
| App frame | `components/ds/shell.css` |

## Principles

1. **Content first.** The title, then the thing the person came for, then the actions. Explanations go in a footnote, not a paragraph above the content.
2. **One way to do each thing.** One button, one list row, one page header, one empty state. If a screen needs something new, add it here first.
3. **Native on phones.** On phones the app uses the iOS patterns:
   - large titles that hand off to a small title in the bar;
   - frosted bars;
   - inset grouped lists with hairlines;
   - segmented controls;
   - bottom sheets with a grabber;
   - 44 px targets;
   - press feedback instead of hover.
4. **Honest states.** Every list has an empty state that says what to do next. Every load has a skeleton. Every failure says what happened and offers a retry.
5. **Cheap to render.** Use CSS, not JavaScript, for anything visual. Animate transforms and opacity only. `data-lite` (low-memory phones, Save-Data) swaps blur for solid fills.
6. **Accessible by construction.** All text meets WCAG 2.2 AA contrast. Every control shows a visible focus ring, has a target of at least 24 px (44 px by default), and respects reduced motion.

## Tokens

### Colour

Use semantic names, never hex values in components.

| Token | Use | Contrast |
|---|---|---|
| `--ds-label` `#10202e` | Titles, body | 16.6:1 on white |
| `--ds-label-2` `#4b5965` | Secondary text, subtitles | 7.2:1 on white, 6.5:1 on page |
| `--ds-label-3` `#5c6872` | Captions, metadata, inactive tabs | 5.7:1 on white, 5.1:1 on page |
| `--ds-label-4` `#8d989f` | Chevrons, placeholders, disabled (never body text) | decorative |
| `--ds-tint` (navy `#153b5b`) | Primary actions, links, active tab | 11.6:1; white on tint 11.6:1 |
| `--ds-accent-ink` `#87661f` | Uppercase eyebrows, course-code badges | 5.3:1 on white |
| `--ds-success` / `--ds-warning` / `--ds-danger` | Status text and icons | ≥ 5.3:1 on white and on their soft fills |
| `--ds-*-soft` | Badge and banner backgrounds | n/a |
| `--ds-bg` `#f2f3ee` | Page background (matches the public site) | n/a |
| `--ds-surface` / `--ds-surface-sunken` | Cards, list rows / hover and inset fills | n/a |
| `--ds-fill`, `--ds-fill-strong` | Segmented tracks, grabbers, pressed rows | n/a |
| `--ds-separator`, `--ds-separator-strong` | Hairlines, card borders / input borders | n/a |

High-contrast mode (`prefers-contrast: more`) darkens the secondary labels and separators, and turns off frosting.

### Type

Phone sizes follow iOS Dynamic Type (Large). Wider screens step down by about 1 px for density. Body text is never below 16 px on phones (no zoom on focus).

| Token | Phone | ≥ 761 px | Use |
|---|---|---|---|
| `--ds-text-large-title` | 32 | 34 | The page h1 (display face, 750) |
| `--ds-text-title-1` | 26 | 26 | Big numbers in stats |
| `--ds-text-title-2` | 21 | 20 | Rare: hero sections inside a page |
| `--ds-text-title-3` | 19 | 18 | Section titles, sheet titles |
| `--ds-text-headline` | 16 | 15 | Emphasised rows, empty-state titles |
| `--ds-text-body` | 16 | 15 | Body, list titles |
| `--ds-text-callout` | 15 | 14 | Subtitles, buttons |
| `--ds-text-subhead` | 14 | 13.5 | Row subtitles, small buttons |
| `--ds-text-footnote` | 13 | 13 | Metadata, section footers |
| `--ds-text-caption` | 12 | 12 | Badges, eyebrows (uppercase, 0.12em) |
| `--ds-text-caption-2` | 11 | 11 | Sidebar group label only |

Faces:

- display: Plus Jakarta Sans, for titles and numbers;
- text: Inter;
- mono: the system monospace, for session codes.

Numbers in tables and counters use `ds-num` (tabular figures).

### Space, radius, elevation, motion

- **Space:** a 4 px grid, `--ds-space-1` to `--ds-space-10` (4, 8, 12, 16, 20, 24, 32, 40, 48, 64). Page gutters (`--ds-gutter`) are 16 px on phones and 32 px on wider screens.
- **Radius:** six steps replace the 30-odd values in use before.

  | Token | Size | Use |
  |---|---|---|
  | `xs` | 6 | Skeleton lines |
  | `sm` | 8 | Small buttons, row icons |
  | `md` | 12 | Buttons, inputs |
  | `lg` | 16 | Cards, lists |
  | `xl` | 22 | Sheets |
  | `pill` | n/a | Badges |

- **Elevation:**
  - `--ds-shadow-1`: resting cards;
  - `--ds-shadow-2`: raised or hover;
  - `--ds-shadow-3`: sheets and popovers.

  Borders do most of the work; shadows stay faint.
- **Motion:**
  - `--ds-ease`: state changes, 120–200 ms;
  - `--ds-ease-spring`: sheets and large movement, 320–480 ms, the iOS curve.

  All durations drop to 0 under reduced motion.
- **Layout:**
  - `--ds-hit`: 44 px;
  - `--ds-nav-height`: 52 px;
  - `--ds-tab-height`: 50 px;
  - `--ds-content-max`: 1120 px.

## Components

All components live in `components/ds`. Each one is small, typed, and renders plain semantic HTML.

| Component | Use it for | Notes |
|---|---|---|
| `PageHeader` | The top of every screen | Props: back link, eyebrow, the only h1, a one-line subtitle, actions. On phones, actions go full width under the title. |
| `Section` | A titled group | Props: right-hand note (`aside`) and footnote (`footer`), like an iOS table section. |
| `List`, `ListRow` | Any list of things | Inset grouped list. Row props: title, subtitle, leading icon, `detail` (a count or time), `trailing` (badge, switch), and a chevron when it is a link. Hairlines are inset to the text. |
| `Button` | Every action | A link when given `href`, otherwise a button with `type="button"`. Variants: `filled` (one per screen), `tinted`, `gray`, `plain`, `destructive`. Sizes: `sm` 36, `md` 44, `lg` 52. `busy` shows a spinner without changing width. Pressing scales the button to 0.97. |
| `Badge` | Status and codes | Tones: `neutral`, `tint`, `accent` (course codes), `success`, `warning`, `danger`. `dot` marks live states. |
| `Stat`, `Stats` | Key numbers | `tone="warning"` for "below 75%". Two columns on phones. |
| `SegmentedControl` | Switching a view in place | Radio-group semantics, arrow keys. Not for navigation; use links for that. |
| `Sheet` | Secondary actions and short forms | Bottom sheet with a grabber on phones, centred dialog elsewhere. Built on `<dialog>`, so focus trapping and Escape come free. |
| `Menu` | A screen's secondary actions | A round `⋯` icon button (`.ds-icon-btn`, 36 px with a 44 px hit area) that opens a popover under it on desktops and an iOS action sheet at 760 px and below. Items: label, icon, `onSelect`, `destructive`, `disabled` (falsy items are skipped). It is a modal `<dialog>`: arrow keys move between items, Escape or a tap outside closes it, and an item runs after the menu has closed so it can open a dialog of its own. |
| `RateMeter`, `rateTone` | A rate against a required line | A short bar with a tick at the line and the whole-number rate in green (met), amber (within 25 points) or red; `–` when there is none yet. The figure is the accessible text. |
| `EmptyState`, `SkeletonLines` | Nothing yet, loading, failure | Always name the next step; `error` uses the danger tone and `role="alert"`. |

The existing primitives in `components/ui` (select, combobox, date picker, number field, switch, search field, tooltips) stay. They will be restyled on the tokens as screens move over. Their popovers are `position: fixed` and placed by `useAnchoredPanel`, which corrects for a transformed ancestor (a dialog mid-animation) with an empty probe, so a list never opens away from its field. Dialog entry animations use `backwards` fill, never `both`, so no transform stays on the `<dialog>` after it opens.

## App frame

`WorkspaceShell` (`components/app-shell.tsx`) renders `.ap-shell`, styled by `components/ds/shell.css`. The menus come from one model, `components/shell/nav-model.ts`: pages, sidebar groups, which pages stay in the phone tab bar, breadcrumbs, titles and back targets. The sidebar, tab bar, *More* and page search all read from it, so they never disagree.

**Desktops (1024 px and up):**

- A floating navy sidebar: inset 10 px from the screen edges and rounded (22 px; 20 px on the tablet rail), like the glass bar beside it, so the frame reads as two objects resting on the page. Its right edge meets the page at `--ap-side-w`, which keeps the current-page tab running out of it into the page.
- It is made like the public site's footer (`.site-footer`): the marketing navy (`#123552` to `#0b2439`), the same paper grain (`--noise-light`, 180 px tile, 16 % opacity) and the same warm gold glow, here rising behind the brand. No grain under `data-lite` or `prefers-contrast: more`. Do not strengthen the grain: above about 20 % it reads as static, not paper.
- Pages sit in groups under small gold uppercase headings: Attendance, People, Institution and Records for administrators; Attendance and Courses for lecturers; HOC, GHOC or Class rep tools for students who are class reps.
- The current page is a tab cut from the page itself. It is the page colour and runs to the sidebar edge, with concave corners, so the menu and the page read as one sheet. This is the frame's signature; do not add other active-state decoration.
- Hovering (or tabbing to) a link moves one soft highlight that glides from link to link, the public header's sliding marker (`.site-nav-marker`) turned vertical (`useGlideMarker`, `.ap-nav-marker`, CSS variables `--marker-x/y/w/h`). It hides over the current page. Touch screens keep the plain pressed state.
- At the foot: the live session card (when the person has one open), then the account (gold initials, name, and a role line such as "HOC · Electronic and Computer Engineering · 2024/2025 set"). The account menu opens upwards.
- The top bar is the public header's floating glass bar (`.site-header-bar`): the same white glass, hairline, 18 px radius and shadows, inset 10 px from the top and lined up with the page content (`--ap-bar-inset`). Once the page scrolls under it the glass thickens and the shadow deepens (`data-scrolled`), and a scroll edge appears behind it (`.ap-bar::after`, iOS 26): a band of soft blur and page colour that fades out downwards, so text passing through the gap around the floating bar is softened instead of cut off raw. It only shows while scrolled, so it never covers the large title at rest, and it is plain colour without blur under `data-lite`. There is no reading-progress line in the workspace (the public site keeps its own). It holds a navy tile with the current page's icon (where the public bar has the brand mark), the breadcrumb (group › page, or a link back to the list on a session page) and *Go to a page* (⌘K / Ctrl K): a combobox over the same pages. Solid glass under `data-lite`, `prefers-reduced-transparency` and `prefers-contrast: more`.

**Tablets (761–1023 px):** the same sidebar narrowed to a 76 px icon rail. Group headings become dividers but are still read out. Labels stay available to screen readers, and tooltips name the icons (`data-tip-when-hidden`). The account and live session become icons.

**Phones (760 px and below):**

- The same glass bar works as the iOS navigation bar: the brand (or a back button with the parent's name on pages below a menu page, such as a session), a centred small title, and the account avatar. It stays put while reading, as iOS navigation bars do, and its scroll edge also covers the status-bar area in the installed app.
- The small title fades in once the page's large title has gone (`data-large-title`). Both attributes come from a passive scroll listener and a `MutationObserver`, with no React re-renders.
- The tab bar floats as a glass capsule in the same glass (iOS 26), with 24 px symbols. The selection is a 58 × 32 pill behind the current tab's symbol only; the label just takes the tint. The pill slides from symbol to symbol on navigation (`useTabLens` measures the symbol's centre, `.ap-tabs-lens`), and the symbol is tinted and lightly filled; a pressed tab shrinks.
- Because the tab bar floats, the strip under and around it gets the bottom scroll edge (`.ap-dock::before`): soft blur and page colour, strongest at the foot of the screen and fading out above the dock. Pages beyond five go into *More*, an iOS grouped list with coloured icon tiles per group. `--ap-dock-clear` is the space the page, toasts and the offline pill leave for it.
- The account menu is a bottom sheet.
- A session that is still open floats above the tab bar like a mini player, a navy capsule with the sidebar's paper grain ("ECE 305 · Live now · 23 present · 12 min left"). It is hidden on that session's own page.

**Live session indicator:** `GET /api/v1/lecture/sessions?live=mine` returns only sessions the caller opened that are still taking attendance. `lib/use-live-session.ts` asks every 30 seconds while the app is on screen, again on navigation, and at once when this browser opens, changes or deletes a session (`LIVE_SESSIONS_CHANGED_EVENT`).

The glass of the top bar sits on `::before` and its scroll edge on `::after`, so the bar itself never has a `backdrop-filter` or transform that would become the containing block for the account sheet.

**State pages** (`app/not-found.tsx`, `app/error.tsx`, `app/offline/page.tsx`, `app/global-error.tsx`, `app/loading.tsx`):

- One picture for every state, `components/state-art.tsx`: the class screen with its QR code on the sidebar's navy paper (grain and gold glow), with a corner tag for what happened: a gold *404*, a red alert, a white *offline* symbol, or a gold *reload* symbol. Server-safe and asset-free, so the offline page draws it with no connection.
- They fit whichever frame they appear in. On the public site they keep the marketing background and the hero's paper grain. Inside a workspace or the check-in frame they sit on that frame's page, centred in the content area, with no second background.
- Actions depend on who is looking (`components/not-found-body.tsx`). Signed in: their own home ("Go to my sessions") and *Go back*, never *Sign in* or a student check-in. Signed out: *Mark attendance*, the home page, help.
- The error screen says what most likely happened. A page opened before a release that asks for code that no longer exists gets *Update ready* with **Reload** (and is not reported as a crash). Offline gets *You're offline* and retries by itself when the connection returns. Anything else gets *This screen hit a problem* with *Try again*, plus a copyable reference for support.
- The page names itself in the frame (`lib/page-label.ts`): the breadcrumb and the phone title read "Page not found" or "Something went wrong" instead of guessing from the address.
- `global-error.tsx` (the root layout failed) carries its own small stylesheet and the brand mark inline, because nothing else is guaranteed to have loaded.
- Loading: in a workspace, the shape of a page (eyebrow, large title, text, cards) fades in only after 320 ms, so quick navigations show nothing at all. The public site keeps its thin gold bar.

Every page h1 inside the workspace, whichever legacy header class wraps it, gets the large-title style. Eyebrows are uppercase.

## Dashboards

The administrator overview (`components/admin-overview/`) sets the pattern for summary screens.

- **Order by urgency.**
  - Desktop has a wide column (what is happening: live sessions, the week, recent sessions) and a 352 px rail (what needs you, setup, people, the Guide).
  - Below 860 px of container width, the two collapse into one column ordered live, attention, setup, the week, recent, people, Guide. A media query at 760 px repeats this for browsers without container queries.
  - Before the first class, setup moves into the wide column, because getting set up is the main job then.
- **One hero per screen.** The navy paper is one class, `.ds-paper` (components/ds/ds.css): the sidebar's gradient, grain and gold glow, a gold focus ring, solid navy in high contrast and no grain in lite mode. Screens add only their layout (`ov-hero`, `ar-hero`). On the overview it holds the main number, its trend against the previous period, a 30-day bar strip with the current week in gold, and three supporting figures. Lite mode and high contrast drop its noise layer.
- **Hide what is empty.** "Live now" and "Needs attention" render nothing when there is nothing to show, instead of an empty card. "Needs attention" lists only items with a count, each linking to the page that resolves it.
- **Setup checklist.** It shows only while steps remain and disappears for good once they are all done; its steps come from the overview's `setup` counts. A round chevron button beside the title folds it to one line (a progress ring, "1 to go", the next step, linking to it) and opens it again. The choice is kept per account (`localStorage` key `lasuatos:setup-collapsed:<id>`; the old `setup-hidden` key is read as folded).
- **Phones.** The header action is hidden, because it is a tab away. In session rows, the course code moves above the title, like a sender above a subject.
- **Every block has three states:**
  - a skeleton the same shape as its content;
  - an error with *Try again*;
  - the real thing.
  Known section titles render at once; only data is skeletal.

### Loading data: `useResource`

`lib/resource.ts` is a small stale-while-revalidate cache for dashboard reads:

```ts
const recent = useResource(admin ? 'admin:recent-sessions' : null, loadRecent, { poll: 45_000 });
// { data, error, loading, reload }
```

- Answers are kept for the life of the tab, keyed by a string. Coming back to a screen shows the last answer at once and refreshes it in the background if older than `maxAge` (30 s by default).
- It refreshes when the tab becomes visible, and `poll` refreshes only while visible.
- A failed refresh keeps the previous `data` and sets `error`; show the error only when there is no data.
- Pass `null` as the key to skip a read (for example, a count the role may not see).
- Prefix keys by area (`admin:`, `lecturer:`).
- `pollWhile(data)` stops polling once the answer says there is nothing left to watch (a closed session). Pass a function defined at module level, not inline, so the hook's options stay stable for the React Compiler.
- `peekResource(key)` reads the cache without subscribing, `primeResource(key, data)` fills it (after a create, so the next screen opens with data), and `staleResources(prefix)` marks every key under a prefix for refresh (after a change that affects lists).

### Attendance overview

`/admin/attendance` (`components/attendance-report/`) reads `GET /api/v1/lecture/report?period=week|month|term&department=<id>`, one request per view, cached by `useResource` for a minute.

- **Controls.** *7 days / 30 days / Semester* under the title (Semester reads *90 days* when no semester is set up). Tapping a department narrows everything to it and shows it as a navy chip; its cross widens again. Both live in the URL (`?period=term&department=…`): the period replaces history, a department pushes, so Back undoes it. The other periods load when the pointer or a finger reaches the control. While a new view loads, the previous one stays, dimmed.
- **Order.** Wide: the rate card, *Courses* and *Departments* on the left; *Below 75%*, *Checks* and *Taken by* in the rail. One column: rate, below 75%, courses, departments, checks, taken by.
- **The rate card** (`.ds-paper`): the rate, points up or down on the period before (none for a semester), a bar per day (per week for a semester, worked out from that week's classes) in gold where it reached the dashed 75% line, and sessions, check-ins and students. The chart has one spoken summary; each bar shows its day on hover.
- **Rows.** Courses (lowest first) and departments carry a small meter with a tick at 75% and the rate in green, amber or red. A course opens its register; a student below 75% opens that register filtered to them (`/registers/ECE305?q=<matric>`, built by `registerHref`). *See all* opens a sheet with search (and sorting, for courses).
- **Words.** No captions or lede. How the rate is worked out, the 75% rule, the periods and what each check means are in the Guide (`GUIDE_TOPICS['/admin/attendance']`). Downloads (courses, below 75%, CSV with a byte-order mark for Excel) and Print are in the header's `Menu`.
- The older enrolled-course reports follow under *Enrolled courses* only where course offerings are in use; otherwise nothing is shown.

### Course registers

`/registers` and `/registers/[course]` (`components/registers/`). A register is the paper exam register made live: every student against every session of a course.

- **Addresses.** One per course, `/registers/ECE305` (the code without spaces, upper case); other spellings redirect to it, and old `/registers?course=ECE 305&q=…` links redirect too. The semester is `?term=<id|other|all>` (replaces history); `?q=<matric>` opens it filtered to a student. On phones the bar's back button returns to the list and the bar title is the code (`backFor`, `extraLabel`).
- **The list.** *This semester* first, sorted by code: each row has the code in a fixed column, the title, sessions, students and how many are below the required attendance, and a `RateMeter` (just the figure on phones). *Earlier* follows, most recent first, with the last date. A search appears from 8 courses. The standing comes with the list (`GET /api/v1/lecture/registers?threshold=`): the current semester, or the last 90 days, counting *below* only from 3 sessions, like the overview.
- **A register.** Title block (code eyebrow, course, date span), the semester picker when there is more than one, four `Stats` (sessions, students, average, below), then a search, *Everyone / Below N%* and an options button (sort by name, matric or lowest; required attendance 50–80%, kept on this device and used by the list, the download and the print).
- **Wide screens** show the grid: number and name fixed on the left, attended and % on the right, sessions scrolling between with a soft edge only while something is behind; it opens on the latest sessions. A date opens that session. **Phones** (container below 700 px) show a list of people instead. Either way a student opens a sheet: their rate, a dot per session, how many sessions in a row bring them back to the line, a note after two misses in a row, and every session newest first.
- **Download and print** live in the header's `Menu`. The CSV has P/A per session, totals and eligibility, a byte-order mark for Excel and a guard against formulas. Print hides the shell (`shell.css`) and the controls and gives a full-width 10 px grid with the course and semester as the table caption, P or · per session, and rates under the line underlined.
- **Words.** No lede. Who is on a register, the required attendance, semesters and the exports are in the Guide (`GUIDE_TOPICS['/registers']`); `GuideButton` lives in `components/shell/`.

### Face checks

`/face-checks` (`components/face-checks/`). A check-in whose face passed without matching clearly (`FACE_MATCH.pass` ≤ score < `FACE_MATCH.clear`, shared with the API in contracts) counts as present but keeps a 200×250 photo for a lecturer or administrator to compare with the registered face. Class reps get an empty state that says lecturers review them.

- **Addresses.** `?show=reviewed` switches the `SegmentedControl` (*To review N / Reviewed*, replaces history). `?session=<id>&matric=<m>` selects that check, and on phones opens it; the session page's *Review the face* links here.
- **The list.** Waiting checks are grouped by session (course, day, start; administrators also see who took it), newest first. A row has the check-in photo as a 4:5 thumbnail, name, matric and check-in time, and *Weak* when the score sits in the lower third between the lines. *Reviewed* is one list with a `Badge`: *Same person* or *Removed*. *Show more* pages with the cursor.
- **Comparing.** At 1080 px and up the list (300–380 px) sits beside a sticky pane, and the first check is chosen. Below that a row opens the same comparison in a `Sheet`. The two photos are side by side at 4:5, never cropped square, labelled *At check-in* and *Registered*; a missing one says why. Under them is a scale from *Passed* to *Clear* with the score. Then *Same person* and *Not the same*, which turns into the reasons (three fixed and *Something else* with text) and *Remove from the list*.
- **Moving on.** Decisions are optimistic: the next check opens at once with focus on its first action, and its photos are already loaded. A failure puts the check back with a toast. The count updates the sidebar and tab badge (`GET /api/v1/lecture/face-reviews/count`, polled each minute and on `FACE_REVIEWS_CHANGED_EVENT`). Keys: A same person, X not the same, then 1–3 a reason, Enter removes, Escape goes back; J/↓ and K/↑ move. They are ignored while another dialog is open, and the hints are hidden on touch screens.
- **Words.** No lede. Why a check is here, how to compare, what each choice does, the keys and how long photos are kept are in the Guide (`GUIDE_TOPICS['/face-checks']`).

### Staff

`/admin/staff` (`components/staff/`). Everyone the signed-in administrator can manage, plus themselves, and the invitations still waiting. Each member carries `lastActiveAt` (newest sign-in session, approximate), `recentSessions` (sessions they started in the last `STAFF_ACTIVITY_DAYS` = 30) and `lastSessionAt`, all computed in `listMembers`.

- **Addresses.** `?show=invited` switches the `SegmentedControl` (*Staff N / Invited N*, replaces history). `?filter=lecturers|admins|quiet|suspended` sets the filter `Select`; only filters that would change the list are offered. `?invite=1` opens the invite sheet once and is removed when it closes (the overview's setup step links here). Opened from a link, the sheet does not focus a field; from the *Invite* button it focuses *Full name*.
- **The list.** `Stats`: lecturers (and admins), taking attendance, *No sessions* (lecturers who joined over a week ago with none in 30 days, warning tone), invited (with expired). Search appears from 8 people and matches name, email or staff number, ignoring accents and spaces. Groups: *Administrators*, then lecturers by department (faculty and count in the aside, the faculty hidden on phones; one department is just *Lecturers*). On phones a row is avatar, name and one line (sessions in success or warning tone, or role and area for admins, or *Last active…* when suspended) with a *Quiet* or *Suspended* badge. At 760 px of container width and up it becomes columns: name and email, staff number or role over area, sessions, last active, badge; the column labels sit under the first group's title.
- **A person.** A `Sheet` with role and area, three figures (last active, sessions in 30 days, last session), a warning note when quiet, then email (copy), staff number and joined. *Edit details* changes the name and, for lecturers, the staff number (empty clears it); role and area cannot change. *Suspend* / *Reactivate* asks for a reason as radios (three fixed and *Something else* with text, at least 10 characters), none chosen at first; suspending signs them out everywhere and the note says so. Not shown for yourself.
- **Invitations.** Rows show role, area, when sent and the expiry (*Expired 4 days ago* in warning tone, no extra badge). The sheet has who sent it, the link's state and the staff number, then *Send a new link* (restarts the 7 days) and *Revoke* with a confirm. If the email failed (`emailSent: false`) the sheet says so and points at *Send a new link*.
- **Inviting.** Name, email (checked against the directory: an existing person or pending invitation offers to open it), role as radios with one-line hints (only the roles you may grant, lecturer first), then department or faculty as the role needs, and an optional staff number for lecturers. Sending shows a done screen with *Invite another* (fresh form, focused) and *Done*.
- **Words.** No lede. Who appears, what *last active* and the session counts mean, inviting, correcting details and suspending are in the Guide (`GUIDE_TOPICS['/admin/staff']`).

## Take attendance

`/sessions` and `/sessions/[id]` (`components/take-attendance/`) set the pattern for a screen someone works in live, in front of a class.

- **The list.** The person's open session comes first as the navy hero (time left, course, venue, the present count, *Show QR code*). Face checks waiting for a decision are one row under it. Then a search and the sessions grouped by day, each row with its present count. Class reps get *Everyone / Mine*. *New session* opens a sheet; `/sessions?new=1` opens it directly, which is where the overview and the setup step link.
- **New session sheet.** Course, lecturer (`LecturerField`: pick from the institution's lecturers, own department first, or type a name; names typed before come back as suggestions), how long (15 m to 3 h as a segmented control, with the closing time beside it), where the QR code goes (*On a screen* rotates every 30 s; *Poster* is fixed), and the venue. Nothing else is explained in place; the Guide covers it.
- **The session.** Desktop has two columns, each opening with the same section head (title left, a note or buttons right) so the cards start level: a sticky QR card (present count, countdown, the rotating code, *Full screen* (F), *+15 min*, *Close*) and on the right the help requests and the students. Below 820 px of container width, a segmented control switches between *QR code*, *Students N* and *Help N*, so the code is never pushed off screen by the list.
- **Secondary actions** (poster, edit, delete) go in the header's `Menu`. The title block carries the course code eyebrow, the course, one line of when, where and who, and status badges (*Live · 12 min left*, *Room checked*, *View only* for people who can see but not manage).
- **Students.** Search plus *All / Flagged / Removed*. Each row opens a sheet with the facts, the checks (venue, face) and *Remove from the list*. Flags show as small badges (*Typed details*, *Added by hand*, *Same phone*, *Face to review*).
- **Adding a student by hand** is a search, not a form: matric number (3+ digits, a prefix) or name finds students on the class lists (the session's department first). Each row says what a tap will do: *Add*, *Put back* (removed earlier), or a green *In · 17:10* with nothing to press, so no one goes on the list twice. Rows added here turn to *In* where they were tapped. Only a full matric number that is on no list offers typed details.
- **Closed sessions** swap the QR card for a *Summary* (present, flagged, by hand) and *Reopen for 15 minutes*. Reopening is allowed for 12 hours after the end (`LECTURE_REOPEN_WINDOW_HOURS`, enforced by the API); later scans would land in an earlier class, so latecomers are added by hand. Times that cross midnight name both days.
- **Projector.** Full screen (F) shows only the course, the QR code, the typed code and a status line (present, closing time, next code) on plain white, which projects best, and leaves with Escape or the close button. It enters full screen once per opening; callbacks it uses are read through a ref, because the view re-renders every second. It never snaps: the white fades up and the code grows into place (260 ms, then a 420 ms spring); leaving first exits full screen, so the page does not jump behind it, then fades out in 200 ms. Reduced motion makes both instant.
- **QR actions on phones.** *Full screen* takes the whole first row and *+15 min* and *Close* share the second, so the main action is never squeezed (posters: two by two).
- **Data.** The session reads through `useResource` every 4 s while open and stops when it closes (`pollWhile`). Creating a session primes its cache, so the session screen opens with no skeleton.

## Writing

- Sentence case everywhere, except eyebrows, which are uppercase by choice.
- Say what happens: "Close attendance", not "Submit". Use "Marked present at 08:31", not "Success".
- Keep pages quiet. Titles and numbers carry the screen; avoid sentences that explain what a section is. What each page is for lives in one place, the **Guide** (`components/shell/guide.ts`, opened as `GuideSheet`). When a page has a new purpose, add its line there, not on the page.
- When a note is truly needed on a page (a rule that changes a number), say it once, in a footnote under the list, not above it.
- Row subtitles fit in about 40 characters, so they stay on one or two lines on a phone.
- Names follow `lib/current-account.ts`:
  - greet students by first name;
  - address titled staff as "Dr. Adeyemi";
  - show the full name only where identity matters (registers, menus).
- Dates: "Today" or "Yesterday" for recent days, then "Tue, 10 Nov". Times use the 24-hour clock in Africa/Lagos time.

## Moving a screen over

1. Replace the screen's header with `PageHeader`, and its lists and cards with `List`, `ListRow` and `Section`.
2. Replace buttons with `Button`, and statuses with `Badge`.
3. Add `EmptyState` and `SkeletonLines` for the empty, loading and error paths.
4. Delete the screen's legacy CSS in `globals.css` in the same change. The stylesheet should only shrink.
5. Check at 390, 768 and 1280 px:
   - axe shows no violations;
   - no target is under 24 px;
   - no horizontal overflow;
   - the screen works with `data-lite` and with reduced motion.

Order: student screens, then lecturer, then administrator, then the rest. Pilot findings can change the order.
