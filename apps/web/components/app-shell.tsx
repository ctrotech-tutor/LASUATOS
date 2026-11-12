'use client';

import {
  BarChart3,
  BookOpenCheck,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  GraduationCap,
  Landmark,
  LayoutDashboard,
  MapPinned,
  MessageSquareWarning,
  QrCode,
  ScanLine,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import type { LectureCapabilities } from '@lasuatos/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { DISPUTES_CHANGED_EVENT, loadLecturerOpenDisputeCount } from '../lib/attendance-api';
import { useCurrentAccount } from '../lib/current-account';
import { loadLectureCapabilities } from '../lib/lecture-api';
import { AccountMenu } from './account-menu';
import { AppRuntime } from './app-runtime';
import { FeedbackProvider } from './feedback';
import { BrandMark } from './brand-mark';

function BrandLockup({ href = '/' }: Readonly<{ href?: string }>) {
  return (
    <Link className="site-brand" href={href} aria-label="LASUATOS home">
      <BrandMark className="site-brand-mark" />
      <span className="site-brand-copy">
        <strong>LASUATOS</strong>
        <small>Lagos State University</small>
      </span>
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
      <main className="public-content">{children}</main>
      <footer className="public-footer">
        <span>© {new Date().getFullYear()} LASUATOS</span>
        <span>Lagos State University · Faculty of Engineering</span>
        <span>For Truth and Service</span>
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
      <main className="lx-shell-content">{children}</main>
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
      <main className="utility-content">{children}</main>
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
  useEffect(() => {
    if (!enabled) return undefined;
    let controller = new AbortController();
    const load = () => {
      controller.abort();
      controller = new AbortController();
      const { signal } = controller;
      void loadLecturerOpenDisputeCount(signal).then((value) => {
        if (!signal.aborted) setCount(value ?? 0);
      });
    };
    load();
    const interval = window.setInterval(load, 60_000);
    window.addEventListener(DISPUTES_CHANGED_EVENT, load);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener(DISPUTES_CHANGED_EVENT, load);
    };
  }, [enabled, pathname]);
  return enabled ? count : 0;
}

type NavItem = { href: string; label: string; short: string; icon: typeof ScanLine; desktopOnly?: boolean };

const ADMIN_NAV: NavItem[] = [
  { href: '/admin', label: 'Administration', short: 'Overview', icon: LayoutDashboard },
  { href: '/sessions', label: 'Take attendance', short: 'Attendance', icon: QrCode },
  { href: '/class-reps', label: 'Class reps (HOC/GHOC)', short: 'Class reps', icon: UsersRound },
  { href: '/admin/attendance', label: 'Attendance overview', short: 'Overview', icon: BarChart3, desktopOnly: true },
  { href: '/admin/venues', label: 'Venue directory', short: 'Venues', icon: MapPinned },
  { href: '/admin/staff', label: 'Staff', short: 'Staff', icon: UserPlus },
  { href: '/admin/structure', label: 'Academic structure', short: 'Structure', icon: Landmark, desktopOnly: true },
];

const LECTURER_NAV: NavItem[] = [
  { href: '/sessions', label: 'Take attendance', short: 'Attendance', icon: QrCode },
  { href: '/lecturer/courses', label: 'Course tools', short: 'Courses', icon: BookOpenCheck },
  { href: '/lecturer/attendance', label: 'Course sessions', short: 'Sessions', icon: CalendarClock, desktopOnly: true },
  { href: '/lecturer/reports', label: 'Attendance reports', short: 'Reports', icon: BarChart3 },
  { href: '/lecturer/disputes', label: 'Attendance disputes', short: 'Disputes', icon: MessageSquareWarning },
];

function studentNav(rep: LectureCapabilities | null): NavItem[] {
  const items: NavItem[] = [
    { href: '/a', label: 'Mark attendance', short: 'Scan', icon: ScanLine },
    { href: '/attendance', label: 'My attendance', short: 'History', icon: ClipboardCheck },
    { href: '/courses', label: 'My courses', short: 'Courses', icon: GraduationCap },
  ];
  if (rep?.canTakeAttendance) items.push({ href: '/sessions', label: 'Take attendance', short: 'Take', icon: QrCode });
  if (rep?.canManageClassReps) items.push({ href: '/class-reps', label: 'HOCs', short: 'HOCs', icon: UsersRound });
  return items;
}

/** Class representatives are students with extra tools; ask once whether this student is one. */
function useStudentRole(accountType: string | undefined): LectureCapabilities | null {
  const [capabilities, setCapabilities] = useState<LectureCapabilities | null>(null);
  useEffect(() => {
    if (accountType !== 'student') return undefined;
    let active = true;
    void loadLectureCapabilities().then((value) => { if (active) setCapabilities(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [accountType]);
  return accountType === 'student' ? capabilities : null;
}

function WorkspaceShell({ children, pathname }: Readonly<{ children: ReactNode; pathname: string }>) {
  const account = useCurrentAccount();
  const shared = pathname.startsWith('/sessions') || pathname.startsWith('/class-reps') || pathname.startsWith('/account');
  const accountType = account?.accountType;
  const isAdministrator = pathname.startsWith('/admin') || (shared && accountType === 'administrator');
  const isLecturer = pathname.startsWith('/lecturer') || (shared && accountType === 'lecturer');
  const studentRole = useStudentRole(accountType);
  const openDisputes = useLecturerOpenDisputes(isLecturer, pathname);
  const navigation = isAdministrator ? ADMIN_NAV : isLecturer ? LECTURER_NAV : studentNav(studentRole);

  return (
    <div className="workspace-frame">
      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <BrandLockup />
        <div className="workspace-rule" />
        <p className="workspace-nav-label">{isAdministrator ? 'ADMINISTRATION' : isLecturer ? 'LECTURER' : studentRole?.role ? studentRole.role.toUpperCase() : 'STUDENT'}</p>
        <nav className="workspace-nav">
          {navigation.map(({ href, label, short, icon: Icon, desktopOnly }) => {
            // The administration home is a prefix of its sub-pages; match it exactly.
            const active = href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link className={`workspace-nav-link${active ? ' is-active' : ''}${desktopOnly ? ' is-desktop-only' : ''}`} href={href} key={href} aria-current={active ? 'page' : undefined}>
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                <span className="workspace-nav-text">{label}</span>
                <span className="workspace-nav-short" aria-hidden="true">{short}</span>
                {href === '/lecturer/disputes' && openDisputes > 0 ? (
                  <span className="workspace-nav-badge" aria-label={`${openDisputes} open`}>{openDisputes > 99 ? '99+' : openDisputes}</span>
                ) : null}
                <span className="workspace-nav-indicator" aria-hidden="true" />
              </Link>
            );
          })}
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
        <main className="workspace-content">{children}</main>
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
      <AppRuntime />
      <ShellForRoute>{children}</ShellForRoute>
    </FeedbackProvider>
  );
}

function ShellForRoute({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  if (pathname === '/launch') return <>{children}</>;
  if (pathname === '/offline') return <CheckInShell>{children}</CheckInShell>;
  if (pathname === '/' || ['/sign-in', '/sign-up', '/verify-email', '/accept-invitation'].includes(pathname)) {
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
