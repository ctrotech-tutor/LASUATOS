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
| `EmptyState`, `SkeletonLines` | Nothing yet, loading, failure | Always name the next step; `error` uses the danger tone and `role="alert"`. |

The existing primitives in `components/ui` (select, combobox, date picker, number field, switch, search field, tooltips) stay. They will be restyled on the tokens as screens move over.

## App frame

`WorkspaceShell` (`components/app-shell.tsx`) renders `.ap-shell`, styled by `components/ds/shell.css`. The menus come from one model, `components/shell/nav-model.ts`: pages, sidebar groups, which pages stay in the phone tab bar, breadcrumbs, titles and back targets. The sidebar, tab bar, *More* and page search all read from it, so they never disagree.

**Desktops (1024 px and up):**

- A navy sidebar made like the public site's footer (`.site-footer`): the marketing navy (`#123552` to `#0b2439`), the same paper grain (`--noise-light`, 180 px tile, 16 % opacity) and the same warm gold glow, here rising behind the brand. No grain under `data-lite` or `prefers-contrast: more`. Do not strengthen the grain: above about 20 % it reads as static, not paper.
- Pages sit in groups under small gold uppercase headings: Attendance, People, Institution and Records for administrators; Attendance and Courses for lecturers; HOC, GHOC or Class rep tools for students who are class reps.
- The current page is a tab cut from the page itself. It is the page colour and runs to the sidebar edge, with concave corners, so the menu and the page read as one sheet. This is the frame's signature; do not add other active-state decoration.
- Hovering (or tabbing to) a link moves one soft highlight that glides from link to link, the public header's sliding marker (`.site-nav-marker`) turned vertical (`useGlideMarker`, `.ap-nav-marker`, CSS variables `--marker-x/y/w/h`). It hides over the current page. Touch screens keep the plain pressed state.
- At the foot: the live session card (when the person has one open), then the account (gold initials, name, and a role line such as "HOC · Electronic and Computer Engineering · 2024/2025 set"). The account menu opens upwards.
- The top bar is the public header's floating glass bar (`.site-header-bar`): the same white glass, hairline, 18 px radius and shadows, inset 10 px from the top and lined up with the page content (`--ap-bar-inset`). Once the page scrolls under it the glass thickens and the shadow deepens (`data-scrolled`), and the public header's thin gold reading-progress line runs along its bottom edge (`.ap-progress`, a CSS scroll timeline, no script; hidden where unsupported). It holds a navy tile with the current page's icon (where the public bar has the brand mark), the breadcrumb (group › page, or a link back to the list on a session page) and *Go to a page* (⌘K / Ctrl K): a combobox over the same pages. Solid glass under `data-lite`, `prefers-reduced-transparency` and `prefers-contrast: more`.

**Tablets (761–1023 px):** the same sidebar narrowed to a 76 px icon rail. Group headings become dividers but are still read out. Labels stay available to screen readers, and tooltips name the icons (`data-tip-when-hidden`). The account and live session become icons.

**Phones (760 px and below):**

- The same glass bar works as the iOS navigation bar: the brand (or a back button with the parent's name on pages below a menu page, such as a session), a centred small title, and the account avatar, with the gold progress line.
- Like the public header on phones, it slides away while scrolling down and comes back on the way up (`data-tucked`). The same rules apply: only after 24 px in one direction, never in the first 120 px, and never while the account sheet is open or focus is inside it. The small title fades in once the page's large title has gone (`data-large-title`). All three attributes come from a passive scroll listener and a `MutationObserver`, with no React re-renders. A frosted strip keeps the status-bar area clean in the installed app.
- The tab bar floats as a glass capsule in the same glass (iOS 26), with 24 px symbols. The current tab sits on a lens that slides to the next tab on navigation (`useTabLens`, `.ap-tabs-lens`), and its symbol is tinted and lightly filled; a pressed tab shrinks. Pages beyond five go into *More*, an iOS grouped list with coloured icon tiles per group. `--ap-dock-clear` is the space the page, toasts and the offline pill leave for it.
- The account menu is a bottom sheet.
- A session that is still open floats above the tab bar like a mini player, a navy capsule with the sidebar's paper grain ("ECE 305 · Live now · 23 present · 12 min left"). It is hidden on that session's own page.

**Live session indicator:** `GET /api/v1/lecture/sessions?live=mine` returns only sessions the caller opened that are still taking attendance. `lib/use-live-session.ts` asks every 30 seconds while the app is on screen, again on navigation, and at once when this browser opens, changes or deletes a session (`LIVE_SESSIONS_CHANGED_EVENT`).

The glass of the top bar sits on `::before`, so the bar's own `backdrop-filter` never becomes the containing block for the account sheet. The bar only carries a transform while it is tucked away, and it never tucks with a menu open.

Every page h1 inside the workspace, whichever legacy header class wraps it, gets the large-title style. Eyebrows are uppercase.

## Writing

- Sentence case everywhere, except eyebrows, which are uppercase by choice.
- Say what happens: "Close attendance", not "Submit". Use "Marked present at 08:31", not "Success".
- Explain once, in a footnote under the list, not above it.
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
