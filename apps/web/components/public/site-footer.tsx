'use client';

import { ArrowUp, ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { useCurrentAccount } from '../../lib/current-account';
import { primaryAction, workspaceLabel, workspacePath } from '../../lib/workspace';
import { BrandLockup } from '../brand-lockup';
import { InstallAppButton } from '../install-app';
import { PrimaryActionIcon } from './primary-action-icon';

const COLUMNS = [
  {
    title: 'Students',
    links: [
      { href: '/a', label: 'Mark attendance' },
      { href: '/sign-up', label: 'Open your account' },
      { href: '/forgot-password', label: 'Forgot password' },
    ],
  },
  {
    title: 'Staff & class reps',
    links: [
      { href: '/sessions', label: 'Take attendance' },
      { href: '/sign-in', label: 'Sign in' },
      { href: '/admin', label: 'Administration' },
    ],
  },
  {
    title: 'Support',
    links: [
      { href: '/help', label: 'Help centre' },
      { href: '/contact', label: 'Contact us' },
      { href: '/privacy', label: 'Privacy & your data' },
      { href: '/terms', label: 'Terms of use' },
    ],
  },
] as const;

/**
 * The public footer: a navy sheet that rises over the page edge, with the paper grain from the
 * heroes, the links, and the name set large at the bottom with the gold dot from the mark.
 */
export function SiteFooter() {
  const toTop = () => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    document.getElementById('main-content')?.focus({ preventScroll: true });
  };

  // Signed in: no "Open your account" or "Sign in"; their own pages instead.
  const account = useCurrentAccount();
  const action = primaryAction(account?.accountType);
  const linksFor = (links: readonly { href: string; label: string }[]) => {
    if (!account) return links;
    return links.flatMap((link) => {
      if (link.href === '/sign-in') return [{ href: '/account/security', label: 'Your account' }];
      if (link.href !== '/sign-up') return [link];
      return account.accountType === 'student' ? [{ href: workspacePath('student'), label: workspaceLabel('student') }] : [];
    });
  };

  return (
    <footer className="site-footer">
      <div className="site-footer-main">
        <div className="site-footer-lead">
          <BrandLockup tone="light" />
          <p>Lecture attendance for Lagos State University: quick for lecturers, fair to students, and very hard to fake.</p>
          <div className="site-footer-lead-actions">
            <Link className="site-footer-scan" href={action.href}><PrimaryActionIcon icon={action.icon} size={17} /> {action.label}</Link>
            <InstallAppButton className="site-footer-install" label="Install the app" />
          </div>
        </div>
        <nav className="site-footer-cols" aria-label="Footer">
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2>{column.title}</h2>
              <ul>
                {linksFor(column.links).map(({ href, label }) => (
                  <li key={href}>
                    <Link href={href}>{label}<ArrowUpRight size={15} aria-hidden="true" /></Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <p className="site-footer-word" aria-hidden="true">LASUATOS<span className="site-footer-dot" /></p>

      <div className="site-footer-bottom">
        <p className="site-footer-legal">
          <span>© {new Date().getFullYear()} LASUATOS</span>
          <span>Made at the Faculty of Engineering, Lagos State University</span>
        </p>
        <button className="site-footer-top" type="button" onClick={toTop}>
          Back to top <ArrowUp size={15} aria-hidden="true" />
        </button>
      </div>
    </footer>
  );
}
