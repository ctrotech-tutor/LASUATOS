'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { addressName, endSession, useCurrentAccount, type CurrentAccount } from '../../lib/current-account';
import { primaryAction, workspaceAction, workspacePath } from '../../lib/workspace';
import { InstallAppButton } from '../install-app';
import { PrimaryActionIcon } from '../public/primary-action-icon';

/** The quieter second button beside the main one, from the person's side. */
function secondFor(account: CurrentAccount | null | undefined): { href: string; label: string } {
  if (!account) return { href: '/sessions', label: 'Take attendance' };
  if (account.accountType === 'lecturer') return { href: '/registers', label: 'Course registers' };
  if (account.accountType === 'administrator') return { href: '/admin/attendance', label: 'Attendance overview' };
  return { href: workspacePath('student'), label: 'My attendance' };
}

/**
 * The hero buttons and the line under them. Signed out, or a student: mark attendance (the job
 * of nearly everyone who opens this page in a lecture hall). Lecturers and administrators never
 * mark attendance, so they get their own work instead. Until the session is known the signed-out
 * version shows, which is what the server rendered.
 */
export function HeroActions() {
  const account = useCurrentAccount();
  const [signingOut, setSigningOut] = useState(false);
  const action = primaryAction(account?.accountType);
  const second = secondFor(account);
  const label = action.icon === 'scan' ? 'Mark my attendance' : action.icon === 'admin' ? 'Open administration' : action.label;

  const signOut = async () => {
    setSigningOut(true);
    await endSession();
    window.location.reload();
  };

  return (
    <>
      <div className="hp-cta-row">
        <Link className="hp-btn hp-btn-primary" href={action.href}>
          <PrimaryActionIcon icon={action.icon} size={18} /> {label}
        </Link>
        <Link className="hp-btn hp-btn-ghost" href={second.href}>
          {second.label} <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>
      {account ? (
        // On a borrowed or shared phone, the way out is one tap away.
        <p className="hp-hero-note">
          Signed in as {addressName(account.displayName)}. Not you?{' '}
          <button className="hp-note-button" type="button" onClick={() => void signOut()} disabled={signingOut}>
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </p>
      ) : (
        <p className="hp-hero-note">
          New here? <Link href="/sign-up">Open your student account</Link> with your matric number.
        </p>
      )}
    </>
  );
}

export function FinalActions() {
  const account = useCurrentAccount();
  return (
    <div className="hp-final-actions">
      {account ? (
        <Link className="hp-btn hp-btn-gold" href={workspacePath(account.accountType)}>
          {workspaceAction(account.accountType)} <ArrowRight size={17} aria-hidden="true" />
        </Link>
      ) : (
        <>
          <Link className="hp-btn hp-btn-gold" href="/sign-up">Open my student account <ArrowRight size={17} aria-hidden="true" /></Link>
          <Link className="hp-btn hp-btn-onDark" href="/sessions">Take attendance</Link>
        </>
      )}
      <InstallAppButton className="hp-install" label="Install the app" />
    </div>
  );
}
