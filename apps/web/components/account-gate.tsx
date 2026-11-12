'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { forgetSession, lookupSession } from '../lib/current-account';

type AccountType = 'student' | 'lecturer' | 'administrator';

function workspacePath(accountType: AccountType): string {
  if (accountType === 'lecturer') return '/sessions';
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
  const [attempt, setAttempt] = useState(0);

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
  }, [accountType, attempt]);

  if (authorized) return children;
  if (unavailable) {
    return (
      <section className="workspace-message" role="status">
        <span className="workspace-message-icon" aria-hidden="true">!</span>
        <div>
          <h2>We couldn’t reach LASUATOS</h2>
          <p>Your account is still signed in. Check your connection and try again.</p>
          <div className="workspace-message-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                forgetSession();
                setUnavailable(false);
                setAttempt((value) => value + 1);
              }}
            >
              Try again
            </button>
            <Link className="button button-secondary" href="/sign-in">Sign in with another account</Link>
          </div>
        </div>
      </section>
    );
  }
  return <WorkspaceSkeleton />;
}
