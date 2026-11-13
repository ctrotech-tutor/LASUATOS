'use client';

import {
  BarChart3,
  BookOpenCheck,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  GraduationCap,
  Landmark,
  LayoutDashboard,
  MapPinned,
  MessageSquareWarning,
  MoreHorizontal,
  QrCode,
  ScanLine,
  UserPlus,
  UsersRound,
  X,
} from 'lucide-react';
import type { LectureCapabilities } from '@lasuatos/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { DISPUTES_CHANGED_EVENT, loadLecturerOpenDisputeCount } from '../lib/attendance-api';
import { useCurrentAccount } from '../lib/current-account';
import { loadLectureCapabilities } from '../lib/lecture-api';
import { AccountMenu } from './account-menu';
import { AppRuntime } from './app-runtime';
import { useVisiblePolling } from '../lib/use-live';
import { FeedbackProvider } from './feedback';
import { FormValidation } from './ui/form-validation';
import { TooltipLayer } from './ui/tooltips';
import { BrandMark } from './brand-mark';

function BrandLockup({ href = '/' }: Readonly<{ href?: string }>) {
  return (
    <Link className="site-brand" href={href}>
      <BrandMark className="site-brand-mark" />
      <span className="site-brand-copy">
        <strong>LASUATOS</strong>
        <small>Lagos State University</small>
      </span>
      <span className="sr-only">, home</span>
    </Link>
  );
}

function PublicShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="public-shell">
      <header className="public-header">
        <BrandLockup />
        <nav className="public-nav" aria-label="Explore LASUATOS">
          <Link href="/#how-it-works">How it works</Link>
          <Link href="/#roles">QR codes</Link>
          <Link href="/sessions">Take attendance</Link>
        </nav>
        <div className="public-actions">
          <Link className="public-sign-in" href="/sign-in">Sign in</Link>
          <Link className="button button-primary public-join" href="/a"><span className="public-join-long">Mark attendance</span><span className="public-join-short">Scan</span></Link>
        </div>
      </header>
      <main className="public-content" id="main-content" tabIndex={-1}>{children}</main>
      <footer className="public-footer">
        <span>© {new Date().getFullYear()} LASUATOS</span>
        <span>Lagos State University · Faculty of Engineering</span>
        <nav className="public-footer-links" aria-label="About LASUATOS">
          <Link href="/help">Help</Link>
          <Link href="/privacy">Privacy</Link>
        </nav>
      </footer>
    </div>
  );
}

/** A light frame for marking attendance: the brand, the account, and the task. */
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

function UtilityShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <div className="utility-shell">
      <header className="utility-header">
        <BrandLockup />
        <span className="utility-context">Developer utilities</span>
        <Link className="utility-back-link" href="/">Back to LASUATOS <ChevronRight size={15} aria-hidden="true" /></Link>
      </header>
      <main className="utility-content" id="main-content" tabIndex={-1}>{children}</main>
      <footer className="utility-footer">LASUATOS · Academic operations</footer>
    </div>
  );
}

function pageLabel(pathname: string): string {
  if (pathname === '/courses') return 'My courses';
  if (pathname === '/attendance') return 'My attendance';
  if (pathname === '/check-in') return 'Check in';
  if (pathname === '/sessions') return 'Take attendance';
  if (pathname.startsWith('/sessions/')) return 'Attendance session';
  if (pathname.startsWith('/class-reps')) return 'Class reps';
  if (pathname.startsWith('/registers')) return 'Course registers';
  if (pathname.startsWith('/account')) return 'Account security';
  if (pathname.startsWith('/lecturer/attendance')) return 'Attendance sessions';
  if (pathname.startsWith('/lecturer/courses')) return 'Course tools';
  if (pathname.startsWith('/lecturer/reports')) return 'Attendance reports';
  if (pathname.startsWith('/lecturer/disputes')) return 'Attendance disputes';
  if (pathname === '/admin') return 'Administration';
  if (pathname.startsWith('/admin/attendance')) return 'Attendance overview';
  if (pathname.startsWith('/admin/venues')) return 'Venue directory';
  if (pathname.startsWith('/admin/staff')) return 'Staff';
  if (pathname.startsWith('/admin/structure')) return 'Academic structure';
  return 'Workspace';
}

/**
 * Open-dispute count for lecturers, refreshed on navigation, every minute,
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
    return 60_000;
  }, [enabled, pathname, changes], 60_000);
  return enabled ? count : 0;
}

type NavItem = { href: string; label: string; short: string; icon: typeof ScanLine; /** Shown only when the enrolled-course tools are in use. */ enrolledCourses?: boolean };

/** The phone tab bar holds five slots; with more pages the fifth becomes "More". */
const PHONE_SLOTS = 5;

// Order matters: on phones the first four stay in the tab bar.
const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Administration', short: 'Overview', icon: LayoutDashboard },
  { href: '/sessions', label: 'Take attendance', short: 'Attendance', icon: QrCode },
  { href: '/admin/attendance', label: 'Attendance overview', short: 'Reports', icon: BarChart3 },
  { href: '/admin/staff', label: 'Staff', short: 'Staff', icon: UserPlus },
  { href: '/class-reps', label: 'Class reps (HOC/GHOC)', short: 'Class reps', icon: UsersRound },
  { href: '/registers', label: 'Course registers', short: 'Registers', icon: ClipboardList },
  { href: '/admin/venues', label: 'Venue directory', short: 'Venues', icon: MapPinned },
  { href: '/admin/structure', label: 'Academic structure', short: 'Structure', icon: Landmark },
];

const LECTURER_NAV: NavItem[] = [
  { href: '/sessions', label: 'Take attendance', short: 'Attendance', icon: QrCode },
  { href: '/registers', label: 'Course registers', short: 'Registers', icon: ClipboardList },
  { href: '/lecturer/reports', label: 'Attendance reports', short: 'Reports', icon: BarChart3, enrolledCourses: true },
  { href: '/lecturer/disputes', label: 'Attendance disputes', short: 'Disputes', icon: MessageSquareWarning, enrolledCourses: true },
  { href: '/lecturer/courses', label: 'Course tools', short: 'Courses', icon: BookOpenCheck },
  { href: '/lecturer/attendance', label: 'Course sessions', short: 'Sessions', icon: CalendarClock, enrolledCourses: true },
];

/**
 * The enrolled-course pages (reports, disputes and sessions for course offerings)
 * only matter once a lecturer has created an offering with an enrollment code.
 * Until then the menu stays focused on QR attendance; "Course tools" remains so
 * the feature can still be found. Disputes always show while any are open.
 */
function lecturerNav(capabilities: LectureCapabilities | null, openDisputes: number, pathname: string): NavItem[] {
  return LECTURER_NAV.filter((item) => !item.enrolledCourses
    || capabilities?.usesEnrolledCourses
    || (item.href === '/lecturer/disputes' && openDisputes > 0)
    || isActive(item.href, pathname));
}

function isActive(href: string, pathname: string): boolean {
  // The administration home is a prefix of its sub-pages; match it exactly.
  return href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
}

/** The rest of the pages on phones, in a bottom sheet. */
function MoreSheet({ items, pathname, badge }: Readonly<{ items: NavItem[]; pathname: string; badge: (href: string) => ReactNode }>) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const activeInside = items.some((item) => isActive(item.href, pathname));

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <>
      <button
        className={`workspace-nav-link workspace-nav-more${activeInside ? ' is-active' : ''}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <MoreHorizontal size={18} strokeWidth={1.8} aria-hidden="true" />
        <span className="workspace-nav-short">More</span>
      </button>
      <dialog
        ref={ref}
        className="nav-more-sheet"
        aria-label="More pages"
        onClose={() => setOpen(false)}
        onClick={(event) => { if (event.target === ref.current) setOpen(false); }}
      >
        <div className="nav-more-handle" aria-hidden="true" />
        <div className="nav-more-head">
          <strong>More pages</strong>
          <button className="nav-more-close" type="button" onClick={() => setOpen(false)} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <ul className="nav-more-list">
            {items.map(({ href, label, icon: Icon }) => {
              const active = isActive(href, pathname);
              return (
                <li key={href}>
                  <Link className={`nav-more-link${active ? ' is-active' : ''}`} href={href} aria-current={active ? 'page' : undefined} onClick={() => setOpen(false)}>
                    <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
                    <span>{label}</span>
                    {badge(href)}
                  </Link>
                </li>
              );
            })}
        </ul>
      </dialog>
    </>
  );
}

function studentNav(rep: LectureCapabilities | null, pathname: string): NavItem[] {
  const items: NavItem[] = [
    { href: '/a', label: 'Mark attendance', short: 'Scan', icon: ScanLine },
    { href: '/attendance', label: 'My attendance', short: 'History', icon: ClipboardCheck },
  ];
  // Joining a course with an enrollment code is only useful once lecturers use course offerings.
  if (rep?.usesEnrolledCourses || isActive('/courses', pathname)) {
    items.push({ href: '/courses', label: 'My courses', short: 'Courses', icon: GraduationCap });
  }
  if (rep?.canTakeAttendance) {
    items.push({ href: '/sessions', label: 'Take attendance', short: 'Take', icon: QrCode });
    items.push({ href: '/registers', label: 'Course registers', short: 'Registers', icon: ClipboardList });
  }
  if (rep?.canManageClassReps) items.push({ href: '/class-reps', label: 'HOCs', short: 'HOCs', icon: UsersRound });
  return items;
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
    void loadLectureCapabilities().then((value) => { if (active) setCapabilities({ accountType, value }); }).catch(() => undefined);
    return () => { active = false; };
  }, [accountType]);
  return capabilities && capabilities.accountType === accountType ? capabilities.value : null;
}

function WorkspaceShell({ children, pathname }: Readonly<{ children: ReactNode; pathname: string }>) {
  const account = useCurrentAccount();
  const shared = pathname.startsWith('/sessions') || pathname.startsWith('/registers') || pathname.startsWith('/class-reps') || pathname.startsWith('/account');
  const accountType = account?.accountType;
  const isAdministrator = pathname.startsWith('/admin') || (shared && accountType === 'administrator');
  const isLecturer = pathname.startsWith('/lecturer') || (shared && accountType === 'lecturer');
  const capabilities = useCapabilities(accountType);
  const studentRole = accountType === 'student' ? capabilities : null;
  const openDisputes = useLecturerOpenDisputes(isLecturer, pathname);
  const navigation = isAdministrator ? ADMIN_NAV : isLecturer ? lecturerNav(capabilities, openDisputes, pathname) : studentNav(studentRole, pathname);
  // On phones, pages past the fourth move into "More" when they would not all fit.
  const phoneOverflow = navigation.length > PHONE_SLOTS ? navigation.slice(PHONE_SLOTS - 1) : [];
  const disputeBadge = (href: string) => (href === '/lecturer/disputes' && openDisputes > 0 ? (
    <span className="workspace-nav-badge">{openDisputes > 99 ? '99+' : openDisputes}<span className="sr-only"> open</span></span>
  ) : null);

  return (
    <div className="workspace-frame">
      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <BrandLockup />
        <div className="workspace-rule" />
        <p className="workspace-nav-label">{isAdministrator ? 'ADMINISTRATION' : isLecturer ? 'LECTURER' : studentRole?.role ? studentRole.role.toUpperCase() : 'STUDENT'}</p>
        <nav className="workspace-nav">
          {navigation.map(({ href, label, short, icon: Icon }) => {
            const active = isActive(href, pathname);
            const inMore = phoneOverflow.some((item) => item.href === href);
            return (
              <Link className={`workspace-nav-link${active ? ' is-active' : ''}${inMore ? ' is-desktop-only' : ''}`} href={href} key={href} aria-current={active ? 'page' : undefined}
                // The name comes from whichever label is showing (full on desktop, short on phones),
                // so speech users can say what they see.
>
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                <span className="workspace-nav-text">{label}</span>
                <span className="workspace-nav-short">{short}</span>
                {disputeBadge(href)}
                <span className="workspace-nav-indicator" aria-hidden="true" />
              </Link>
            );
          })}
          {phoneOverflow.length ? <MoreSheet items={phoneOverflow} pathname={pathname} badge={disputeBadge} /> : null}
        </nav>
        <div className="workspace-sidebar-bottom">
          <span className="workspace-campus-mark" aria-hidden="true"><i /></span>
          <div>
            <strong>Lagos State University</strong>
            <span>Academic workspace</span>
          </div>
        </div>
      </aside>

      <div className="workspace-main">
        <header className="workspace-topbar">
          <Link className="workspace-topbar-brand" href="/" aria-label="LASUATOS home">
            <BrandMark className="site-brand-mark" />
          </Link>
          <div className="workspace-breadcrumb">
            <span className="workspace-breadcrumb-root">LASUATOS</span>
            <ChevronRight className="workspace-breadcrumb-root" size={14} aria-hidden="true" />
            <strong>{pageLabel(pathname)}</strong>
          </div>
          <div className="workspace-topbar-actions">
            <span className="workspace-locale">Africa/Lagos</span>
            <AccountMenu />
          </div>
        </header>
        <main className="workspace-content" id="main-content" tabIndex={-1}>{children}</main>
        <footer className="workspace-footer">
          <span>LASUATOS</span>
          <span>Lagos State University · Academic workspace</span>
          <span>For Truth and Service</span>
        </footer>
      </div>
    </div>
  );
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <FeedbackProvider>
      <a className="skip-link" href="#main-content">Skip to content</a>
      <AppRuntime />
      <FormValidation />
      <ShellForRoute>{children}</ShellForRoute>
      <TooltipLayer />
    </FeedbackProvider>
  );
}

/** Pages for people who are not signed in (or not yet): the marketing-style frame. */
const PUBLIC_PAGES = new Set(['/sign-in', '/sign-up', '/verify-email', '/accept-invitation', '/forgot-password', '/reset-password', '/privacy', '/help']);

function ShellForRoute({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  if (pathname === '/launch') return <>{children}</>;
  if (pathname === '/offline') return <CheckInShell>{children}</CheckInShell>;
  if (pathname === '/' || PUBLIC_PAGES.has(pathname)) {
    return <PublicShell>{children}</PublicShell>;
  }
  if (pathname === '/a' || pathname.startsWith('/a/')) {
    return <CheckInShell>{children}</CheckInShell>;
  }
  if (pathname === '/setup' || pathname.startsWith('/setup/')) {
    return <UtilityShell>{children}</UtilityShell>;
  }
  return <WorkspaceShell pathname={pathname}>{children}</WorkspaceShell>;
}
