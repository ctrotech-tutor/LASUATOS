'use client';

import {
  BarChart3,
  BookOpenCheck,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  GraduationCap,
  LayoutDashboard,
  MapPinned,
  MessageSquareWarning,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { DISPUTES_CHANGED_EVENT, loadLecturerOpenDisputeCount } from '../lib/attendance-api';
import { AccountMenu } from './account-menu';
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
          <Link href="/#roles">For your role</Link>
          <Link href="/#lasu">About LASU</Link>
        </nav>
        <div className="public-actions">
          <Link className="public-sign-in" href="/sign-in">Sign in</Link>
          <Link className="button button-primary public-join" href="/sign-up">Student sign-up</Link>
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
  if (pathname.startsWith('/lecturer/attendance')) return 'Attendance sessions';
  if (pathname.startsWith('/lecturer/courses')) return 'Course tools';
  if (pathname.startsWith('/lecturer/reports')) return 'Attendance reports';
  if (pathname.startsWith('/lecturer/disputes')) return 'Attendance disputes';
  if (pathname === '/admin') return 'Administration';
  if (pathname.startsWith('/admin/attendance')) return 'Attendance overview';
  if (pathname.startsWith('/admin/venues')) return 'Venue directory';
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

function WorkspaceShell({ children, pathname }: Readonly<{ children: ReactNode; pathname: string }>) {
  const isLecturer = pathname.startsWith('/lecturer');
  const isAdministrator = pathname.startsWith('/admin');
  const openDisputes = useLecturerOpenDisputes(isLecturer, pathname);
  const navigation = isAdministrator
    ? [
        { href: '/admin', label: 'Administration', icon: LayoutDashboard },
        { href: '/admin/attendance', label: 'Attendance overview', icon: BarChart3 },
        { href: '/admin/venues', label: 'Venue directory', icon: MapPinned },
      ]
    : isLecturer
      ? [
          { href: '/lecturer/courses', label: 'Course tools', icon: BookOpenCheck },
          { href: '/lecturer/attendance', label: 'Attendance sessions', icon: CalendarClock },
          { href: '/lecturer/reports', label: 'Attendance reports', icon: BarChart3 },
          { href: '/lecturer/disputes', label: 'Attendance disputes', icon: MessageSquareWarning },
        ]
      : [
          { href: '/courses', label: 'My courses', icon: GraduationCap },
          { href: '/attendance', label: 'My attendance', icon: ClipboardCheck },
        ];

  return (
    <div className="workspace-frame">
      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <BrandLockup />
        <div className="workspace-rule" />
        <p className="workspace-nav-label">{isAdministrator ? 'ADMINISTRATION' : isLecturer ? 'LECTURER' : 'STUDENT'}</p>
        <nav className="workspace-nav">
          {navigation.map(({ href, label, icon: Icon }) => {
            // The administration home is a prefix of its sub-pages; match it exactly.
            const active = href === '/admin' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link className={`workspace-nav-link${active ? ' is-active' : ''}`} href={href} key={href} aria-current={active ? 'page' : undefined}>
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{label}</span>
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
          <div className="workspace-breadcrumb">
            <span>LASUATOS</span>
            <ChevronRight size={14} aria-hidden="true" />
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
  const pathname = usePathname();
  if (pathname === '/' || ['/sign-in', '/sign-up', '/verify-email'].includes(pathname)) {
    return <PublicShell>{children}</PublicShell>;
  }
  if (pathname === '/setup' || pathname.startsWith('/setup/')) {
    return <UtilityShell>{children}</UtilityShell>;
  }
  return <WorkspaceShell pathname={pathname}>{children}</WorkspaceShell>;
}
