'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { lookupSession } from '../lib/current-account';

type AccountType = 'student' | 'lecturer' | 'administrator';

function workspacePath(accountType: AccountType): string {
  if (accountType === 'lecturer') return '/lecturer/courses';
  if (accountType === 'administrator') return '/admin';
  return '/courses';
}

/** Placeholder blocks shaped like a workspace page while the session is confirmed. */
export function WorkspaceSkeleton({ label = 'Preparing your workspace…' }: Readonly<{ label?: string }>) {
  return (
    <div className="workspace-skeleton" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="skeleton-block skeleton-hero" />
      <div className="skeleton-row">
        <div className="skeleton-block skeleton-card" />
        <div className="skeleton-block skeleton-card" />
      </div>
      <div className="skeleton-block skeleton-line" />
      <div className="skeleton-block skeleton-line is-short" />
    </div>
  );
}

export function AccountGate({
  accountType,
  children,
}: Readonly<{ accountType: AccountType; children: ReactNode }>) {
  const [authorized, setAuthorized] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let active = true;
    void lookupSession().then((result) => {
      if (!active) return;
      if (result.kind === 'signed_out') {
        window.location.replace('/sign-in');
        return;
      }
      if (result.kind === 'unavailable') {
        setUnavailable(true);
        return;
      }
      if (result.account.accountType !== accountType) {
        window.location.replace(workspacePath(result.account.accountType));
        return;
      }
      setAuthorized(true);
    });
    return () => {
      active = false;
    };
  }, [accountType]);

  if (authorized) return children;
  if (unavailable) {
    return (
      <section className="workspace-message" role="status">
        <span className="workspace-message-icon" aria-hidden="true">!</span>
        <div>
          <h2>We couldn’t confirm this account</h2>
          <p>Please sign in again to continue to your workspace.</p>
          <Link className="button button-primary" href="/sign-in">Return to sign in</Link>
        </div>
      </section>
    );
  }
  return <WorkspaceSkeleton />;
}
