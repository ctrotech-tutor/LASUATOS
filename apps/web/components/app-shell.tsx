'use client';

import { ChevronRight, ClipboardList, FileSpreadsheet, LayoutDashboard } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { AccountMenu } from './account-menu';

const navigation = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/setup', label: 'Setup checklist', icon: ClipboardList },
  { href: '/setup/roster', label: 'Roster preflight', icon: FileSpreadsheet },
] as const;

function pageLabel(pathname: string): string {
  if (pathname === '/setup') return 'Setup checklist';
  if (pathname.startsWith('/setup/roster')) return 'Course roster preflight';
  if (pathname === '/courses') return 'My courses';
  if (pathname.startsWith('/lecturer/courses')) return 'Course tools';
  if (pathname === '/sign-up') return 'Create student account';
  if (pathname === '/sign-in') return 'Sign in';
  if (pathname === '/verify-email') return 'Email confirmation';
  return 'Overview';
}

export function AppShell({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();

  return (
    <div className="app-frame">
      <aside className="sidebar" aria-label="Main navigation">
        <Link className="brand-lockup" href="/" aria-label="LASUATOS overview">
          <span className="brand-mark" aria-hidden="true">
            <span>L</span>
            <i />
          </span>
          <span className="brand-copy">
            <strong>LASUATOS</strong>
            <small>Attendance platform</small>
          </span>
        </Link>

        <div className="sidebar-rule" />

        <div className="nav-group">
          <p className="nav-label">WORKSPACE</p>
          <nav className="primary-nav">
            {navigation.map(({ href, label, icon: Icon }) => {
              const active = pathname === href;
              return (
                <Link
                  key={href}
                  className={`nav-link${active ? ' is-active' : ''}`}
                  href={href}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                  <span>{label}</span>
                  {active ? <span className="nav-current-mark" aria-hidden="true" /> : null}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="sidebar-bottom">
          <div className="workspace-identity">
            <span className="identity-indicator" aria-hidden="true" />
            <div>
              <strong>Development workspace</strong>
              <span>Institution not connected</span>
            </div>
          </div>
          <p className="sidebar-motto">For Truth and Service</p>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <div className="breadcrumb" aria-label="Breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={14} strokeWidth={1.8} aria-hidden="true" />
            <strong>{pageLabel(pathname)}</strong>
          </div>
          <div className="topbar-meta">
            <span className="timezone-label">Africa/Lagos</span>
            <span className="environment-badge"><i aria-hidden="true" />Development</span>
            <AccountMenu />
          </div>
        </header>

        <main className="page-content">{children}</main>

        <footer className="app-footer">
          <span>LASUATOS</span>
          <span>Development environment. No live attendance records.</span>
        </footer>
      </div>
    </div>
  );
}
