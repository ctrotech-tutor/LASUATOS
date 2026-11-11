'use client';

import { AuthenticatedSessionSchema } from '@lasuatos/contracts';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function AccountMenu() {
  const [studentName, setStudentName] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/auth/session', {
      cache: 'no-store',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const parsed = AuthenticatedSessionSchema.safeParse(await response.json());
        return parsed.success ? parsed.data.student.displayName : null;
      })
      .then((name) => {
        if (!controller.signal.aborted) setStudentName(name);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!controller.signal.aborted) setChecked(true);
      });
    return () => controller.abort();
  }, []);

  async function signOut() {
    setSigningOut(true);
    await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    window.location.assign('/');
  }

  if (!checked) {
    return <span className="account-menu-status" aria-label="Checking account status">Account</span>;
  }

  if (studentName) {
    return (
      <div className="account-menu">
        <span className="account-menu-name" title={studentName}>{studentName}</span>
        <button className="account-menu-button" type="button" onClick={signOut} disabled={signingOut}>
          {signingOut ? 'Signing out' : 'Sign out'}
        </button>
      </div>
    );
  }

  return (
    <div className="account-menu">
      <Link className="account-menu-signin" href="/sign-in">Sign in</Link>
      <Link className="account-menu-signup" href="/sign-up">Create account</Link>
    </div>
  );
}
