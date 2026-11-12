'use client';

import Link from 'next/link';
import { ChevronDown } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { forgetSession, lookupSession } from '../lib/current-account';
import { InstallAppButton } from './install-app';

export function AccountMenu() {
  const [accountName, setAccountName] = useState<string | null>(null);
  const [accountType, setAccountType] = useState<'student' | 'lecturer' | 'administrator' | null>(null);
  const [checked, setChecked] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointer = (event: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    let active = true;
    void lookupSession().then((result) => {
      if (!active) return;
      const account = result.kind === 'signed_in' ? result.account : null;
      setAccountName(account?.displayName ?? null);
      setAccountType(account?.accountType ?? null);
      setChecked(true);
    });
    return () => {
      active = false;
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    await fetch('/api/v1/auth/logout', { method: 'POST' }).catch(() => undefined);
    forgetSession();
    window.location.assign('/');
  }

  if (!checked) {
    return <span className="account-menu-status" aria-label="Checking account status">Account</span>;
  }

  if (accountName && accountType) {
    const workspaceHref = accountType === 'lecturer'
      ? '/sessions'
      : accountType === 'administrator'
        ? '/admin'
        : '/attendance';
    const workspaceLabel = accountType === 'lecturer'
      ? 'Take attendance'
      : accountType === 'administrator'
        ? 'Administration'
        : 'My attendance';
    const roleLabel = accountType === 'lecturer' ? 'Lecturer' : accountType === 'administrator' ? 'Administrator' : 'Student';
    const initials = accountName
      .split(/\s+/)
      .map((part) => part.replace(/[^A-Za-z]/g, ''))
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join('') || '?';
    return (
      <div className="account-menu account-menu-signed-in" ref={menuRef}>
        <button
          className="account-menu-trigger"
          type="button"
          aria-expanded={open}
          aria-haspopup="true"
          aria-controls="account-menu-panel"
          onClick={() => setOpen((value) => !value)}
        >
          <span className="account-menu-avatar" aria-hidden="true">{initials}</span>
          <span className="account-menu-name" data-tip={accountName}>{accountName}</span>
          <ChevronDown size={14} aria-hidden="true" className="account-menu-chevron" />
          <span className="sr-only">Account menu</span>
        </button>
        {open ? (
          <div className="account-menu-panel" id="account-menu-panel">
            <div className="account-menu-identity">
              <strong>{accountName}</strong>
              <span>{roleLabel}</span>
            </div>
            <Link className="account-menu-item" href={workspaceHref} onClick={() => setOpen(false)}>{workspaceLabel}</Link>
            <Link className="account-menu-item" href="/account/security" onClick={() => setOpen(false)}>Password and sign-in</Link>
            <InstallAppButton className="account-menu-item account-menu-install" label="Install the app" />
            <button className="account-menu-item account-menu-signout" type="button" onClick={signOut} disabled={signingOut}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        ) : null}
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
