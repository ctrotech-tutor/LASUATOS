'use client';

import {
  BookOpenCheck,
  ChevronRight,
  GraduationCap,
  LayoutDashboard,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
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
  if (pathname.startsWith('/lecturer/courses')) return 'Course tools';
  if (pathname === '/admin') return 'Administration';
  return 'Workspace';
}

function WorkspaceShell({ children, pathname }: Readonly<{ children: ReactNode; pathname: string }>) {
  const isLecturer = pathname.startsWith('/lecturer');
  const isAdministrator = pathname.startsWith('/admin');
  const navigation = isAdministrator
    ? [{ href: '/admin', label: 'Administration', icon: LayoutDashboard }]
    : isLecturer
      ? [{ href: '/lecturer/courses', label: 'Course tools', icon: BookOpenCheck }]
      : [{ href: '/courses', label: 'My courses', icon: GraduationCap }];

  return (
    <div className="workspace-frame">
      <aside className="workspace-sidebar" aria-label="Workspace navigation">
        <BrandLockup />
        <div className="workspace-rule" />
        <p className="workspace-nav-label">{isAdministrator ? 'ADMINISTRATION' : isLecturer ? 'LECTURER' : 'STUDENT'}</p>
        <nav className="workspace-nav">
          {navigation.map(({ href, label, icon: Icon }) => (
            <Link className="workspace-nav-link is-active" href={href} key={href} aria-current="page">
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{label}</span>
              <span className="workspace-nav-indicator" aria-hidden="true" />
            </Link>
          ))}
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
