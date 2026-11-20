'use client';

import Link from 'next/link';
import { ChevronDown, ChevronsUpDown, CirclePlay, KeyRound, LayoutGrid, LogOut } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { addressName, endSession, lookupSession, onAccountChanged } from '../lib/current-account';
import { initialsOf, roleLabel, workspaceLabel, workspacePath } from '../lib/workspace';
import { InstallAppButton } from './install-app';
import { useDragToDismiss } from './ui/use-drag-to-dismiss';

/**
 * The signed-in person: their initials, and a menu with their home, password settings, the app
 * install and sign-out. `side` is the sidebar version (name and role, opening upwards); `bar` is
 * the top-bar version, which on phones opens as a bottom sheet. `detail` replaces the plain role
 * under the name, e.g. "HOC · Computer Engineering".
 */
export function AccountMenu({ placement = 'bar', detail }: Readonly<{ placement?: 'bar' | 'side'; detail?: string | null }> = {}) {
  const panelId = `account-menu-${useId().replace(/:/g, '')}`;
  const [accountName, setAccountName] = useState<string | null>(null);
  const [accountType, setAccountType] = useState<'student' | 'lecturer' | 'administrator' | null>(null);
  const [checked, setChecked] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  // Phones: the panel is a bottom sheet that drags down to close.
  useDragToDismiss(panelRef, { enabled: open && placement === 'bar', onDismiss: () => setOpen(false), scrim: scrimRef });

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
    const load = () => {
      void lookupSession().then((result) => {
        if (!active) return;
        const account = result.kind === 'signed_in' ? result.account : null;
        setAccountName(account?.displayName ?? null);
        setAccountType(account?.accountType ?? null);
        setChecked(true);
      });
    };
    load();
    const unsubscribe = onAccountChanged(load);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  async function signOut() {
    setSigningOut(true);
    await endSession();
    window.location.assign('/');
  }

  if (!checked) {
    return placement === 'side'
      ? <span className="account-menu-status account-menu-status-side" role="status" aria-label="Checking account status" />
      : <span className="account-menu-status" aria-label="Checking account status">Account</span>;
  }

  if (accountName && accountType) {
    const workspaceHref = workspacePath(accountType);
    const workspaceText = workspaceLabel(accountType);
    const roleText = detail || roleLabel(accountType);
    const initials = initialsOf(accountName);
    const side = placement === 'side';
    return (
      <>
        <div className="account-menu account-menu-signed-in" data-placement={placement} ref={menuRef}>
          <button
            className="account-menu-trigger"
            type="button"
            aria-expanded={open}
            aria-haspopup="true"
            aria-controls={panelId}
            onClick={() => setOpen((value) => !value)}
            data-tip={side ? accountName : undefined}
            data-tip-when-hidden={side ? '.account-menu-who' : undefined}
          >
            <span className="account-menu-avatar" aria-hidden="true">{initials}</span>
            {side ? (
              <span className="account-menu-who">
                <span className="account-menu-name">{addressName(accountName)}</span>
                <span className="account-menu-role">{roleText}</span>
              </span>
            ) : (
              <span className="account-menu-name" data-tip={accountName}>{addressName(accountName)}</span>
            )}
            {side
              ? <ChevronsUpDown size={16} aria-hidden="true" className="account-menu-chevron" />
              : <ChevronDown size={14} aria-hidden="true" className="account-menu-chevron" />}
            <span className="sr-only">Account menu</span>
          </button>
          {open ? (
            <div className="account-menu-panel" id={panelId} ref={panelRef}>
              {side ? null : <span className="account-menu-grabber" aria-hidden="true" data-drag-handle />}
              <div className="account-menu-identity">
                <span className="account-menu-avatar account-menu-avatar-large" aria-hidden="true">{initials}</span>
                <span>
                  <strong>{accountName}</strong>
                  <span>{roleText}</span>
                </span>
              </div>
              <div className="account-menu-items">
                <Link className="account-menu-item" href={workspaceHref} onClick={() => setOpen(false)}>
                  <LayoutGrid size={18} strokeWidth={1.9} aria-hidden="true" />{workspaceText}
                </Link>
                <Link className="account-menu-item" href="/account/security" onClick={() => setOpen(false)}>
                  <KeyRound size={18} strokeWidth={1.9} aria-hidden="true" />Account and password
                </Link>
                <Link className="account-menu-item" href="/start" onClick={() => setOpen(false)}>
                  <CirclePlay size={18} strokeWidth={1.9} aria-hidden="true" />Watch the guide (3 min)
                </Link>
                <InstallAppButton className="account-menu-item account-menu-install" label="Install the app" />
              </div>
              <button className="account-menu-item account-menu-signout" type="button" onClick={signOut} disabled={signingOut}>
                <LogOut size={18} strokeWidth={1.9} aria-hidden="true" />{signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </div>
          ) : null}
        </div>
        {/* Phones: the menu is a bottom sheet over a dimmed page. */}
        {open && !side ? <div className="account-menu-scrim" aria-hidden="true" ref={scrimRef} /> : null}
      </>
    );
  }

  return (
    <div className="account-menu">
      <Link className="account-menu-signin" href="/sign-in">Sign in</Link>
      <Link className="account-menu-signup" href="/sign-up">Open account</Link>
    </div>
  );
}
