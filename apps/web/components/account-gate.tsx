'use client';

import { AuthenticatedSessionSchema } from '@lasuatos/contracts';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

type AccountType = 'student' | 'lecturer' | 'administrator';

function workspacePath(accountType: AccountType): string {
  if (accountType === 'lecturer') return '/lecturer/courses';
  if (accountType === 'administrator') return '/admin';
  return '/courses';
}

export function AccountGate({
  accountType,
  children,
}: Readonly<{ accountType: AccountType; children: ReactNode }>) {
  const [authorized, setAuthorized] = useState(false);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/auth/session', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (response.status === 401) {
          window.location.replace('/sign-in');
          return;
        }
        if (!response.ok) {
          setUnavailable(true);
          return;
        }
        const parsed = AuthenticatedSessionSchema.safeParse(await response.json());
        if (!parsed.success) {
          setUnavailable(true);
          return;
        }
        if (parsed.data.account.accountType !== accountType) {
          window.location.replace(workspacePath(parsed.data.account.accountType));
          return;
        }
        setAuthorized(true);
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setUnavailable(true);
      });
    return () => controller.abort();
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
  return <div className="workspace-loading" role="status">Preparing your workspace…</div>;
}
