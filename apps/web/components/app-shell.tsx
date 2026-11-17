'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { LectureCapabilities } from '@lasuatos/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { DISPUTES_CHANGED_EVENT, loadLecturerOpenDisputeCount } from '../lib/attendance-api';
import { CONTACT_INBOX_CHANGED_EVENT, loadContactNewCount } from '../lib/contact-api';
import { useCurrentAccount, type CurrentAccount } from '../lib/current-account';
import { CAPABILITIES_CHANGED, FACE_REVIEWS_CHANGED_EVENT, loadFaceReviewCount, loadLectureCapabilities } from '../lib/lecture-api';
import { useLiveSession } from '../lib/use-live-session';
import { usePageLabelOverride } from '../lib/page-label';
import { AccountMenu } from './account-menu';
import { AppRuntime } from './app-runtime';
import { useVisiblePolling } from '../lib/use-live';
import { FeedbackProvider } from './feedback';
import { FormValidation } from './ui/form-validation';
import { TooltipLayer } from './ui/tooltips';
import { BrandLockup } from './brand-lockup';
import { BrandMark } from './brand-mark';
import { SiteFooter } from './public/site-footer';
import { SiteHeader } from './public/site-header';
import { SiteCursor } from './public/site-cursor';
import { CommandMenu } from './shell/command-menu';
import { LiveSessionLink } from './shell/live-session-link';
import { MoreTab } from './shell/more-sheet';
import { backFor, crumbsFor, groupsOf, isActive, navigationFor, splitForPhone, titleFor, type ShellRole } from './shell/nav-model';

function PublicShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="public-shell">
      <SiteHeader />
      <main className="public-content" id="main-content" tabIndex={-1}>{children}</main>
      <SiteFooter />
    </div>
  );
}

const SIGNED_IN_HINT = 'lasuatos:signed-in';
const subscribeToNothing = () => () => undefined;
const readSignedInHint = () => {
  try {
    return window.localStorage.getItem(SIGNED_IN_HINT) === '1';
  } catch {
    return false;
  }
};
const noHintOnServer = () => false;

/**
 * Whether this browser was signed in last time, remembered so the Scan screen can draw the right
 * frame (menus or none) before the session lookup answers, instead of flashing the other one.
 * It is only a hint for the frame: the session decides everything else.
 */
function useSignedInHint(account: CurrentAccount | null | undefined): boolean {
  const hint = useSyncExternalStore(subscribeToNothing, readSignedInHint, noHintOnServer);
  useEffect(() => {
    if (account === undefined) return;
    try {
      if (account) window.localStorage.setItem(SIGNED_IN_HINT, '1');
      else window.localStorage.removeItem(SIGNED_IN_HINT);
    } catch {
      // Private mode: no hint, the frame simply waits for the lookup.
    }
  }, [account]);
  return hint;
}

/** A light frame for the offline page: the brand, the account, and the task. */
function CheckInShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="lx-shell">
      <header className="lx-shell-header">
        <BrandLockup />
        <AccountMenu />
      </header>
      <main className="lx-shell-content" id="main-content" tabIndex={-1}>{children}</main>
    </div>
  );
}

/**
 * Open-dispute count for lecturers, refreshed on navigation, every 30 seconds,
 * and immediately after a decision. Failures simply hide the badge.
 */
function useLecturerOpenDisputes(enabled: boolean, pathname: string): number {
  const [count, setCount] = useState(0);
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const bump = () => setChanges((value) => value + 1);
    window.addEventListener(DISPUTES_CHANGED_EVENT, bump);
    return () => window.removeEventListener(DISPUTES_CHANGED_EVENT, bump);
  }, [enabled]);
  // Paused while the app is in the background; refreshes when it comes back.
  useVisiblePolling(async (signal) => {
    if (!enabled) return null;
    const value = await loadLecturerOpenDisputeCount(signal);
    if (!signal.aborted) setCount(value ?? 0);
    return 30_000;
  }, [enabled, pathname, changes], 60_000);
  return enabled ? count : 0;
}

/**
 * New contact-page messages for institution administrators, refreshed on navigation, every two
 * minutes while the app is open, and at once after one is marked. Failures simply hide the badge.
 */
function useNewContactMessages(enabled: boolean, pathname: string): number {
  const [count, setCount] = useState(0);
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const bump = () => setChanges((value) => value + 1);
    window.addEventListener(CONTACT_INBOX_CHANGED_EVENT, bump);
    return () => window.removeEventListener(CONTACT_INBOX_CHANGED_EVENT, bump);
  }, [enabled]);
  useVisiblePolling(async (signal) => {
    if (!enabled) return null;
    const value = await loadContactNewCount(signal).catch(() => 0);
    if (!signal.aborted) setCount(value);
    return 120_000;
  }, [enabled, pathname, changes], 120_000);
  return enabled ? count : 0;
}

/**
 * Face checks waiting for a lecturer or administrator, refreshed on navigation, every minute
 * while the app is open, and at once after a decision. Failures simply hide the badge.
 */
function useFaceReviewCount(enabled: boolean, pathname: string): number {
  const [count, setCount] = useState(0);
  const [changes, setChanges] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    const bump = () => setChanges((value) => value + 1);
    window.addEventListener(FACE_REVIEWS_CHANGED_EVENT, bump);
    return () => window.removeEventListener(FACE_REVIEWS_CHANGED_EVENT, bump);
  }, [enabled]);
  useVisiblePolling(async (signal) => {
    if (!enabled) return null;
    const value = await loadFaceReviewCount(signal).catch(() => 0);
    if (!signal.aborted) setCount(value);
    return 60_000;
  }, [enabled, pathname, changes], 60_000);
  return enabled ? count : 0;
}

/**
 * What this account can do: whether a student is a class rep, and whether the
 * enrolled-course tools are in use (lecturers). Asked once per account.
 */
function useCapabilities(accountType: string | undefined): LectureCapabilities | null {
  const [capabilities, setCapabilities] = useState<{ accountType: string; value: LectureCapabilities } | null>(null);
  useEffect(() => {
    if (accountType !== 'student' && accountType !== 'lecturer') return undefined;
    let active = true;
    const load = () => {
      void loadLectureCapabilities().then((value) => { if (active) setCapabilities({ accountType, value }); }).catch(() => undefined);
    };
    load();
    // A lecturer's first course brings in the course pages, without a reload.
    window.addEventListener(CAPABILITIES_CHANGED, load);
    return () => {
      active = false;
      window.removeEventListener(CAPABILITIES_CHANGED, load);
    };
  }, [accountType]);
  return capabilities && capabilities.accountType === accountType ? capabilities.value : null;
}

/**
 * The floating glass bar, as on the public site:
 * - `data-scrolled` once the page moves under it: the glass thickens, the shadow deepens, and the
 *   scroll edge behind it (a soft blur that fades out downwards) appears;
 * - `data-large-title` while the page's own h1 is still on screen, so the small title in the
 *   phone bar stays hidden until the large one scrolls away (iOS).
 * The bar stays put while reading, on phones too. Attributes are set directly, so scrolling
 * never re-renders the page.
 */
function useScrollAwareTopbar(pathname: string) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const bar = ref.current;
    const main = document.getElementById('main-content');
    if (!bar || !main) return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      bar.toggleAttribute('data-scrolled', window.scrollY > 4);
      const barBottom = bar.getBoundingClientRect().bottom;
      const box = main.querySelector('h1')?.getBoundingClientRect();
      // A visually hidden h1 (a 1 px box) does not count as a large title.
      const visible = box ? box.height > 4 && box.bottom > barBottom + 4 : false;
      bar.toggleAttribute('data-large-title', visible);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    schedule();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    // Pages load their content after the first paint; the title can appear (or change) later.
    const observer = new MutationObserver(schedule);
    observer.observe(main, { childList: true, subtree: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      observer.disconnect();
    };
  }, [pathname]);
  return ref;
}

/**
 * The public header's sliding marker, moved to where the workspace keeps its links: in the
 * sidebar a soft highlight glides from link to link under the pointer (and to a link reached
 * with the keyboard), instead of each link lighting up on its own. It hides over the current
 * page, which already stands out as a tab of the page. Positioned with CSS variables, so moving
 * it never re-renders the menu; touch screens keep the plain pressed state.
 */
function useGlideMarker() {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = ref.current;
    if (!nav) return undefined;
    const place = (link: HTMLElement | null) => {
      if (!link || link.classList.contains('is-active')) { nav.dataset.marker = 'off'; return; }
      nav.style.setProperty('--marker-x', `${link.offsetLeft}px`);
      nav.style.setProperty('--marker-y', `${link.offsetTop}px`);
      nav.style.setProperty('--marker-w', `${link.offsetWidth}px`);
      nav.style.setProperty('--marker-h', `${link.offsetHeight}px`);
      // From hidden, appear in place rather than sliding in from the last spot.
      if (nav.dataset.marker !== 'on') {
        nav.dataset.marker = 'jump';
        void nav.offsetWidth;
      }
      nav.dataset.marker = 'on';
    };
    const linkOf = (target: EventTarget | null) => (target instanceof Element ? target.closest<HTMLElement>('.ap-nav-link') : null);
    const onOver = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      const link = linkOf(event.target);
      if (link) place(link);
    };
    const onLeave = () => { nav.dataset.marker = 'off'; };
    const onFocus = (event: FocusEvent) => {
      const link = linkOf(event.target);
      if (link?.matches(':focus-visible')) place(link);
    };
    nav.addEventListener('pointerover', onOver);
    nav.addEventListener('pointerleave', onLeave);
    nav.addEventListener('focusin', onFocus);
    nav.addEventListener('focusout', onLeave);
    return () => {
      nav.removeEventListener('pointerover', onOver);
      nav.removeEventListener('pointerleave', onLeave);
      nav.removeEventListener('focusin', onFocus);
      nav.removeEventListener('focusout', onLeave);
    };
  }, []);
  return ref;
}

/**
 * The phone tab bar's selection: a soft pill behind the current tab's symbol only (the label just
 * takes the tint), sliding to the next symbol on navigation like the marker in the public header.
 * Measured from the symbol itself, so it stays centred whatever the label length. Hidden when the
 * current page has no tab.
 */
function useTabLens(pathname: string, signature: string) {
  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const tabs = ref.current;
    if (!tabs) return undefined;
    const rest = () => {
      const current = tabs.querySelector<HTMLElement>('.ap-tab[aria-current]');
      const icon = current?.querySelector<HTMLElement>('.ap-tab-icon');
      if (!current || !icon || current.offsetWidth === 0) { tabs.dataset.lens = 'off'; return; }
      // Centre of the symbol, in the tab bar's coordinates (the tab is the symbol's offset parent).
      tabs.style.setProperty('--lens-cx', `${current.offsetLeft + current.offsetWidth / 2}px`);
      tabs.style.setProperty('--lens-cy', `${current.offsetTop + icon.offsetTop + icon.offsetHeight / 2}px`);
      tabs.dataset.lens = 'on';
    };
    rest();
    const observer = new ResizeObserver(rest);
    observer.observe(tabs);
    return () => observer.disconnect();
  }, [pathname, signature]);
  return ref;
}

/** Under the name in the account menu: what this person is here, e.g. "HOC · Computer Engineering". */
function roleDetail(account: CurrentAccount | null | undefined, capabilities: LectureCapabilities | null): string | null {
  if (!account) return null;
  if (account.accountType === 'administrator') {
    if (account.role === 'institution_administrator') return 'Institution administrator';
    return `${account.role === 'faculty_administrator' ? 'Faculty' : 'Department'} admin · ${account.scope.label}`;
  }
  if (capabilities?.roleLabel) return capabilities.roleLabel;
  return account.accountType === 'student' ? `Student · ${account.matricNumber}` : 'Lecturer';
}

/**
 * The signed-in app frame.
 *
 * Desktops: a floating navy sidebar in the brand's colours, rounded like the glass bar beside it
 * and inset from the screen edge, pages grouped under small gold headings;
 * the current page is a tab cut from the page itself, so the menu and the page read as one
 * sheet, with the public site's paper grain and gold glow, and a highlight that glides between
 * links like the public header's marker. The live session (when one is open) and the account sit
 * at the foot. The top bar is the public header's floating glass bar: the breadcrumb and "Go to a
 * page" (⌘K), and a deeper shadow once the page scrolls under it, over a soft blurred edge.
 * Tablets: the same sidebar narrowed to icons. Phones: the glass bar as an iOS navigation bar
 * (back button on pages below a menu page, small title once the large one scrolls away), and a
 * floating glass tab bar whose selection pill slides from symbol to symbol, over a blurred edge
 * at the foot of the screen, with the live session floating above it like a mini player.
 */
function WorkspaceShell({ children, pathname }: Readonly<{ children: ReactNode; pathname: string }>) {
  const account = useCurrentAccount();
  const scanRoute = isScanRoute(pathname);
  const signedInHint = useSignedInHint(account);
  // The Scan screen is also the page a phone's camera app opens from a class QR code, for people
  // who are not signed in: they get the bare frame (brand and Sign in, no menus). A signed-in
  // student keeps the tab bar, with Scan selected, as in a native app.
  const bare = scanRoute && (account === null || (account === undefined && !signedInHint));
  // Pages more than one kind of account opens; each sees its own menu there (staff who scan a class
  // code to try it land on /check-in).
  const shared = scanRoute || pathname.startsWith('/check-in') || pathname.startsWith('/sessions') || pathname.startsWith('/registers') || pathname.startsWith('/face-checks') || pathname.startsWith('/class-reps') || pathname.startsWith('/assistants') || pathname.startsWith('/class-list') || pathname.startsWith('/account');
  const accountType = account?.accountType;
  const isAdministrator = pathname.startsWith('/admin') || (shared && accountType === 'administrator');
  const isLecturer = pathname.startsWith('/lecturer') || (shared && accountType === 'lecturer');
  const role: ShellRole = isAdministrator ? 'administrator' : isLecturer ? 'lecturer' : 'student';
  const capabilities = useCapabilities(accountType);
  const openDisputes = useLecturerOpenDisputes(isLecturer, pathname);
  const institutionAdmin = account?.accountType === 'administrator' && account.role === 'institution_administrator';
  const newMessages = useNewContactMessages(isAdministrator && institutionAdmin, pathname);
  const faceReviews = useFaceReviewCount((isAdministrator && accountType === 'administrator') || (isLecturer && accountType === 'lecturer'), pathname);
  // On pages several kinds of account share, wait for the account rather than flash the wrong menu.
  const deciding = shared && account === undefined;
  const navigation = deciding || bare ? [] : navigationFor({
    role,
    pathname,
    capabilities: role === 'administrator' ? null : capabilities,
    openDisputes,
    institutionAdmin,
  });
  const { tabs, more } = splitForPhone(navigation);
  const takesAttendance = Boolean(account) && (accountType !== 'student' || Boolean(capabilities?.canTakeAttendance));
  const live = useLiveSession(takesAttendance, pathname);
  // Not on Take attendance or the session's own page: the live card or the QR code is already there.
  const liveSession = live.session && pathname !== '/sessions' && pathname !== `/sessions/${live.session.id}` ? live.session : null;
  const back = backFor(pathname, navigation);
  // A missing or crashed page names itself (lib/page-label.ts); otherwise the address does.
  const pageLabel = usePageLabelOverride();
  const crumbs = pageLabel ? [{ label: pageLabel }] : crumbsFor(pathname, navigation);
  const home = navigation[0]?.href ?? '/';
  const CurrentIcon = pageLabel ? null : navigation.find((item) => isActive(item.href, pathname))?.icon ?? null;
  const topbar = useScrollAwareTopbar(pathname);
  const sideNav = useGlideMarker();
  const tabBar = useTabLens(pathname, `${tabs.map((tab) => tab.href).join(' ')}|${more.length}`);

  const badge = (href: string) => {
    const count = href === '/lecturer/disputes' ? openDisputes : href === '/admin/messages' ? newMessages : href === '/face-checks' ? faceReviews : 0;
    if (count <= 0) return null;
    const words = href === '/admin/messages' ? ' new' : href === '/face-checks' ? ' to review' : ' open';
    return <span className="ap-badge">{count > 99 ? '99+' : count}<span className="sr-only">{words}</span></span>;
  };

  return (
    <div className="ap-shell ds-shell" data-role={role} data-live={liveSession ? '' : undefined} data-nested={back ? '' : undefined} data-bare={bare ? '' : undefined}>
      <aside className="ap-side" aria-label="Sidebar">
        <div className="ap-side-head">
          <BrandLockup href={home} tone="light" />
          <Link className="ap-side-mark" href={home} aria-label="LASUATOS home" data-tip="LASUATOS">
            <BrandMark className="site-brand-mark" />
          </Link>
        </div>
        <nav className="ap-nav" aria-label="Main menu" ref={sideNav}>
          <span className="ap-nav-marker" aria-hidden="true" />
          {groupsOf(navigation).map((group, groupIndex) => {
            const headingId = `ap-nav-${groupIndex}`;
            return (
              <div className="ap-nav-group" key={group.label ?? `group-${groupIndex}`}>
                {group.label ? <p className="ap-nav-heading" id={headingId}>{group.label}</p> : null}
                <ul className="ap-nav-list" aria-labelledby={group.label ? headingId : undefined}>
                  {group.items.map(({ href, label, icon: Icon }) => {
                    const active = isActive(href, pathname);
                    return (
                      <li key={href}>
                        <Link
                          className={`ap-nav-link${active ? ' is-active' : ''}`}
                          href={href}
                          aria-current={active ? 'page' : undefined}
                          data-tip={label}
                          data-tip-when-hidden=".ap-nav-label"
                        >
                          <Icon size={18} strokeWidth={active ? 2.1 : 1.8} aria-hidden="true" />
                          <span className="ap-nav-label">{label}</span>
                          {badge(href)}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
        <div className="ap-side-foot">
          {liveSession ? <LiveSessionLink session={liveSession} count={live.count} now={live.now} variant="side" /> : null}
          <AccountMenu placement="side" detail={roleDetail(account, capabilities)} />
        </div>
      </aside>

      <div className="ap-main">
        <header className="ap-bar" ref={topbar}>
          <div className="ap-bar-lead">
            {back ? (
              <Link className="ap-back" href={back.href}>
                <ChevronLeft size={26} strokeWidth={2.2} aria-hidden="true" />
                <span>{back.label}</span>
              </Link>
            ) : bare ? (
              <BrandLockup />
            ) : (
              <Link className="ap-bar-brand" href={home} aria-label="LASUATOS home">
                <BrandMark className="site-brand-mark" />
              </Link>
            )}
            {CurrentIcon ? <span className="ap-bar-page" aria-hidden="true"><CurrentIcon size={17} strokeWidth={2} /></span> : null}
            <nav className="ap-crumbs" aria-label="Breadcrumb" hidden={bare}>
              <ol>
                {crumbs.map((crumb, position) => {
                  const last = position === crumbs.length - 1;
                  return (
                    <li key={`${crumb.label}-${position}`}>
                      {crumb.href && !last ? <Link href={crumb.href}>{crumb.label}</Link> : <span aria-current={last ? 'page' : undefined}>{crumb.label}</span>}
                      {last ? null : <ChevronRight size={14} strokeWidth={2} aria-hidden="true" />}
                    </li>
                  );
                })}
              </ol>
            </nav>
          </div>
          <p className="ap-bar-title">{pageLabel ?? titleFor(pathname, navigation)}</p>
          <div className="ap-bar-trail">
            {bare ? null : <CommandMenu items={navigation} pathname={pathname} />}
            <div className="ap-bar-account"><AccountMenu placement="bar" detail={roleDetail(account, capabilities)} /></div>
          </div>
        </header>
        <main className="ap-content workspace-content" id="main-content" tabIndex={-1}>{children}</main>
      </div>

      {/* With a live lecture the dock carries content beyond the menu, so it becomes a named region. */}
      <div className="ap-dock" {...(liveSession ? { role: 'region', 'aria-label': 'Live lecture and menu' } : {})}>
        {liveSession ? <LiveSessionLink session={liveSession} count={live.count} now={live.now} variant="accessory" /> : null}
        <nav className="ap-tabs" aria-label="Main menu" ref={tabBar}>
          <span className="ap-tabs-lens" aria-hidden="true" />
          {tabs.map(({ href, short, icon: Icon }) => {
            const active = isActive(href, pathname);
            return (
              <Link className={`ap-tab${active ? ' is-active' : ''}`} href={href} key={href} aria-current={active ? 'page' : undefined}>
                <span className="ap-tab-icon">
                  <Icon size={24} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                  {badge(href)}
                </span>
                <span className="ap-tab-label">{short}</span>
              </Link>
            );
          })}
          {more.length ? <MoreTab items={more} pathname={pathname} badge={badge} /> : null}
        </nav>
      </div>
    </div>
  );
}

/** The viewfinder cursor belongs to the public site and the account pages, not the workspaces. */
function usesSiteCursor(pathname: string): boolean {
  return pathname === '/' || PUBLIC_PAGES.has(pathname) || AUTH_PAGES.has(pathname);
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  return (
    <FeedbackProvider>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <AppRuntime />
      <FormValidation />
      <ShellForRoute>{children}</ShellForRoute>
      <TooltipLayer />
      <SiteCursor enabled={usesSiteCursor(pathname)} />
    </FeedbackProvider>
  );
}

/** Pages for people who are not signed in (or not yet): the marketing-style frame. */
const PUBLIC_PAGES = new Set(['/privacy', '/terms', '/help', '/contact']);

/** Account pages bring their own focused frame (components/auth/auth-layout.tsx): no site header or footer. */
const AUTH_PAGES = new Set(['/sign-in', '/sign-up', '/verify-email', '/accept-invitation', '/forgot-password', '/forgot-password/signed-in', '/reset-password']);

/** Signed-in workspaces. Any other address (a mistyped or old link) gets the public frame and its 404 page. */
const WORKSPACE_PREFIXES = ['/account', '/admin', '/assistants', '/attendance', '/check-in', '/class-list', '/class-reps', '/courses', '/face-checks', '/lecturer', '/registers', '/sessions'];

/** The Scan screen: /a, and a poster's link /a/K7M29QXD. */
function isScanRoute(pathname: string): boolean {
  return pathname === '/a' || pathname.startsWith('/a/');
}

function isWorkspaceRoute(pathname: string): boolean {
  return WORKSPACE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

function ShellForRoute({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  if (pathname === '/launch' || AUTH_PAGES.has(pathname)) return <>{children}</>;
  if (pathname === '/offline') return <CheckInShell>{children}</CheckInShell>;
  if (pathname === '/' || PUBLIC_PAGES.has(pathname)) {
    return <PublicShell>{children}</PublicShell>;
  }
  if (isScanRoute(pathname) || isWorkspaceRoute(pathname)) return <WorkspaceShell pathname={pathname}>{children}</WorkspaceShell>;
  return <PublicShell>{children}</PublicShell>;
}
