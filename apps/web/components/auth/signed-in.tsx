'use client';

import { ArrowRight, ChevronRight, KeyRound, MailCheck, UsersRound } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { hasPendingCheckIn } from '../../lib/check-in-device';
import { lookupSession, type CurrentAccount } from '../../lib/current-account';
import { initialsOf, roleLabel, safeNextPath, workspaceAction, workspacePath } from '../../lib/workspace';
import { problemMessage, readJson } from '../account-forms';
import { ForgotPasswordForm } from '../account-security';
import { AccountPanelSkeleton } from '../ui/skeleton';

/** Where a signed-in visitor of a sign-in page goes: the page they were sent from, a scanned QR check-in, or home. */
function destinationFor(account: CurrentAccount): string {
  const next = safeNextPath(new URLSearchParams(window.location.search).get('next'));
  if (next) return next;
  if (account.accountType === 'student' && hasPendingCheckIn()) return '/check-in';
  return workspacePath(account.accountType);
}

/**
 * Sign in and open an account, for someone who is already signed in.
 * The proxy (proxy.ts) normally redirects before the page is sent; this is the backstop for when
 * that check could not finish in time. The form shows straight away (signed-out visitors never wait)
 * and is swapped for a skeleton only once we know this browser is signed in.
 * It looks once, on arrival: someone who opens an account on this page is then signed in, and
 * must not be moved off it halfway through the steps.
 */
export function SignedInRedirect({ children }: Readonly<{ children: ReactNode }>) {
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    let active = true;
    void lookupSession().then((result) => {
      if (!active || result.kind !== 'signed_in') return;
      setLeaving(true);
      window.location.replace(destinationFor(result.account));
    });
    return () => {
      active = false;
    };
  }, []);

  return leaving ? <AccountPanelSkeleton label="You are already signed in. Opening your workspace…" /> : <>{children}</>;
}

/** Who this browser is signed in as: initials, name, email and role. */
export function SignedInAs({ account, compact = false }: Readonly<{ account: CurrentAccount; compact?: boolean }>) {
  return (
    <div className={compact ? 'au-who is-compact' : 'au-who'}>
      <span className="au-who-avatar" aria-hidden="true">{initialsOf(account.displayName)}</span>
      <span className="au-who-copy">
        <strong>{account.displayName}</strong>
        <small><span className="au-who-email">{account.email}</span><span aria-hidden="true"> · </span>{roleLabel(account.accountType)}</small>
      </span>
    </div>
  );
}

type HelpState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'fallback' }
  | { readonly kind: 'ready'; readonly account: CurrentAccount };

/**
 * Password help for someone who is signed in (proxy.ts shows this at /forgot-password).
 * They usually want to change their own password, which is done from their account; if they no
 * longer know the current one, a reset link to their own email is one tap. Helping a classmate or
 * colleague is still possible, without signing out.
 */
export function SignedInPasswordHelp() {
  const [state, setState] = useState<HelpState>({ kind: 'loading' });
  const [mode, setMode] = useState<'choose' | 'sending' | 'sent' | 'other'>('choose');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void lookupSession().then((result) => {
      if (!active) return;
      if (result.kind === 'signed_in') setState({ kind: 'ready', account: result.account });
      // Opened directly while signed out: the plain password-help page is the right one.
      else if (result.kind === 'signed_out') window.location.replace('/forgot-password');
      else setState({ kind: 'fallback' });
    });
    return () => {
      active = false;
    };
  }, []);

  if (state.kind === 'loading') return <AccountPanelSkeleton label="Checking your account…" rows={3} />;
  if (state.kind === 'fallback') return <ForgotPasswordForm />;

  const { account } = state;
  const home = workspacePath(account.accountType);
  const homeAction = workspaceAction(account.accountType);

  async function emailMe() {
    setMode('sending');
    setError('');
    try {
      const response = await fetch('/api/v1/auth/password-reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: account.email }),
      });
      if (response.status === 202) {
        setMode('sent');
        return;
      }
      setError(problemMessage(response.status, await readJson(response), 'The reset link could not be requested.'));
    } catch {
      setError('The account service did not respond. Try again when it is available.');
    }
    setMode('choose');
  }

  if (mode === 'sent') {
    return (
      <section className="account-panel account-verification" aria-live="polite">
        <span className="account-result-mark is-info" aria-hidden="true"><MailCheck size={28} /></span>
        <h2>Check your inbox</h2>
        <p>A reset link is on its way to <strong className="au-break">{account.email}</strong>. It works once and expires in 30 minutes. Check your spam folder if it is not there in a few minutes.</p>
        <p className="account-fine-print">Choosing a new password signs out every device, this one included. You stay signed in until then.</p>
        <Link className="account-secondary-button" href={home}>{homeAction}</Link>
      </section>
    );
  }

  if (mode === 'other') {
    return (
      <div className="au-other">
        <p className="account-notice">For a classmate or colleague: the link goes to the email on <em>their</em> account, so they need to open it. You stay signed in.</p>
        <ForgotPasswordForm done={{ href: home, label: homeAction }} signedIn />
        <p className="account-inline-link au-alt"><button className="au-text-button" type="button" onClick={() => setMode('choose')}>It’s my own password</button></p>
      </div>
    );
  }

  return (
    <section className="account-panel" aria-label="Password help">
      <SignedInAs account={account} />
      <div className="au-choices">
        <Link className="au-choice" href="/account/security#change-password">
          <span className="au-choice-icon" aria-hidden="true"><KeyRound size={19} /></span>
          <span className="au-choice-copy"><strong>Change my password</strong><small>In your account, with your current password</small></span>
          <ChevronRight className="au-choice-arrow" size={18} aria-hidden="true" />
        </Link>
        <button className="au-choice" type="button" onClick={() => void emailMe()} disabled={mode === 'sending'} aria-busy={mode === 'sending'}>
          <span className="au-choice-icon" aria-hidden="true"><MailCheck size={19} /></span>
          <span className="au-choice-copy">
            <strong>{mode === 'sending' ? 'Sending the link…' : 'I don’t know it: email me a link'}</strong>
            <small>To <span className="au-break">{account.email}</span></small>
          </span>
          <ChevronRight className="au-choice-arrow" size={18} aria-hidden="true" />
        </button>
        <button className="au-choice" type="button" onClick={() => setMode('other')}>
          <span className="au-choice-icon" aria-hidden="true"><UsersRound size={19} /></span>
          <span className="au-choice-copy"><strong>Someone else’s password</strong><small>Send a link to a classmate or colleague</small></span>
          <ChevronRight className="au-choice-arrow" size={18} aria-hidden="true" />
        </button>
      </div>
      {error ? <p className="account-error" role="alert">{error}</p> : null}
      <Link className="account-secondary-button" href={home}>{homeAction} <ArrowRight size={18} aria-hidden="true" /></Link>
    </section>
  );
}
