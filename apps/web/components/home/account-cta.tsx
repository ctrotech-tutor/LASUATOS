'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { firstName, useCurrentAccount } from '../../lib/current-account';
import { workspaceAction, workspacePath } from '../../lib/workspace';
import { InstallAppButton } from '../install-app';

/**
 * The homepage lines that invite people to open an account. Someone already signed in is sent to
 * their own workspace instead. Until the session is known the signed-out text shows, which is what
 * the server rendered, so nothing shifts for visitors who are signed out.
 */
export function HeroAccountNote() {
  const account = useCurrentAccount();
  if (account) {
    return (
      <p className="hp-hero-note">
        Signed in as {firstName(account.displayName)}. <Link href={workspacePath(account.accountType)}>{workspaceAction(account.accountType)}</Link>
      </p>
    );
  }
  return (
    <p className="hp-hero-note">
      New here? <Link href="/sign-up">Open your student account</Link> with your matric number.
    </p>
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
