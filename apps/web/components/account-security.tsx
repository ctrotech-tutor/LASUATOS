'use client';

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordResetCompletedSchema,
} from '@lasuatos/contracts';
import { ArrowRight, BadgeCheck, Link2Off, MailCheck, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { problemMessage, readJson } from './account-forms';
import { PasswordField } from './password-field';
import { AccountPanelSkeleton } from './ui/skeleton';
import { forgetSession, quickAccount, type CurrentAccount } from '../lib/current-account';
import { useGoogleSignIn } from './onboarding/google-button';

const UNREACHABLE = 'The account service did not respond. Try again when it is available.';

/** Checks the two new-password fields; returns an error message or null. */
export function newPasswordProblem(password: string, confirmation: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters. A short phrase is easier to remember than symbols.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Use at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (password !== confirmation) return 'The two new passwords do not match.';
  return null;
}

export function NewPasswordFields({ autoFocus = false }: { readonly autoFocus?: boolean }) {
  return (
    <>
      <PasswordField
        label="New password"
        name="newPassword"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        maxLength={PASSWORD_MAX_LENGTH}
        autoFocus={autoFocus}
        hint={<>At least {PASSWORD_MIN_LENGTH} characters. A memorable phrase works well; do not reuse a password from another site.</>}
      />
      <PasswordField label="Confirm new password" name="confirmPassword" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={PASSWORD_MAX_LENGTH} />
    </>
  );
}

/**
 * `done`: where the "Check your email" screen leads; sign in by default.
 * `signedIn`: the visitor is helping someone else while signed in, so the student code route
 * (on the open-an-account page, which a signed-in visitor cannot use) is not offered.
 */
export function ForgotPasswordForm({
  done = { href: '/sign-in', label: 'Back to sign in' },
  signedIn = false,
}: Readonly<{ done?: { href: string; label: string }; signedIn?: boolean }>) {
  const fieldId = useId();
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  // Students can also reset from their matric number: a 6-digit code, or Google where it is set up.
  const google = useGoogleSignIn();
  const studentRoute = google ? 'a 6-digit code or Google' : 'a 6-digit code';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/v1/auth/password-reset/request', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: form.get('email') }),
      });
      if (response.status === 202) {
        setSent(true);
        return;
      }
      setError(problemMessage(response.status, await readJson(response), 'The request could not be completed.'));
    } catch {
      setError(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section className="account-panel account-verification" aria-live="polite">
        <span className="account-result-mark is-info" aria-hidden="true"><MailCheck size={28} /></span>
        <h2>Check your email</h2>
        <p>If an active LASUATOS account matches, a reset link is on its way to the email on that account (for students, the LASU email they confirmed). It expires in 30 minutes and works once. Check your spam folder if it does not arrive within a few minutes.</p>
        <p>For your privacy we show this message whether or not there is an account.{signedIn ? null : <> Students can also use {studentRoute} instead: <Link href="/sign-up">type your matric number</Link>, then “Reset my password”.</>}</p>
        <Link className="account-secondary-button" href={done.href}>{done.label}</Link>
      </section>
    );
  }

  return (
    <section className="account-panel" aria-label="Reset your password">
      <form className="account-form" onSubmit={submit}>
        <div className="account-field">
          <label htmlFor={`${fieldId}-email`}>Email or matric number</label>
          <input id={`${fieldId}-email`} name="email" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} minLength={3} maxLength={320} required aria-describedby={`${fieldId}-email-hint`} />
          <small id={`${fieldId}-email-hint`}>Students: the link goes to the LASU email on your account.</small>
        </div>
        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <button className="account-primary-button" type="submit" disabled={busy}>
          {busy ? 'Requesting link…' : <>Email me a reset link <ArrowRight size={18} aria-hidden="true" /></>}
        </button>
        {signedIn ? null : <p className="account-inline-link au-alt"><Link href="/sign-up">{google ? 'Student? Reset with your matric number and Google or a code' : 'Student? Get a 6-digit code to your LASU email instead'}</Link></p>}
      </form>
    </section>
  );
}

export function PasswordResetForm() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'missing' | 'done'>('checking');
  const [signedIn, setSignedIn] = useState<CurrentAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const token = useRef('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Read the token from the fragment, then remove it from the address bar and history.
    token.current = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token.current)) {
      window.setTimeout(() => setStatus('missing'), 0);
      return;
    }
    // Someone signed in here is told up front that finishing signs this browser out too.
    void quickAccount().then((account) => {
      setSignedIn(account);
      setStatus('ready');
    });
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('newPassword') ?? '');
    const problem = newPasswordProblem(password, String(form.get('confirmPassword') ?? ''));
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/v1/auth/password-reset/complete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.current, password }),
      });
      const body = await readJson(response);
      if (response.ok && PasswordResetCompletedSchema.safeParse(body).success) {
        token.current = '';
        // The server ended every session, this browser's included.
        forgetSession();
        setStatus('done');
        return;
      }
      if (response.status === 400) {
        setError('This reset link is invalid, has expired or has already been used. Request a new one below.');
        return;
      }
      setError(problemMessage(response.status, body, 'Your password could not be reset.'));
    } catch {
      setError(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  if (status === 'checking') {
    return (
      <AccountPanelSkeleton label="Checking your reset link…" />
    );
  }

  if (status === 'missing') {
    return (
      <section className="account-panel account-verification">
        <span className="account-result-mark is-warn" aria-hidden="true"><Link2Off size={28} /></span>
        <h2>No reset link found</h2>
        <p>Open the link from your most recent reset email, or request a new one. Links expire after 30 minutes and work once.</p>
        <Link className="account-primary-button" href="/forgot-password">Request a new link</Link>
      </section>
    );
  }

  if (status === 'done') {
    return (
      <section className="account-panel account-verification" aria-live="polite">
        <span className="account-result-mark" aria-hidden="true"><BadgeCheck size={30} /></span>
        <h2>Password reset</h2>
        <p>Your new password is set and every device that was signed in has been signed out. We have emailed you a confirmation.</p>
        <Link className="account-primary-button" href="/sign-in">Sign in <ArrowRight size={18} aria-hidden="true" /></Link>
      </section>
    );
  }

  return (
    <section className="account-panel" aria-label="Choose a new password">
      {signedIn ? (
        <p className="account-notice" role="note">
          This browser is signed in as <strong>{signedIn.displayName}</strong>. Saving a new password signs this browser out as well, so you will sign in again afterwards.
        </p>
      ) : null}
      <form className="account-form" onSubmit={submit}>
        <NewPasswordFields autoFocus />
        {error ? (
          <p className="account-error" role="alert">
            {error} {error.startsWith('This reset link') ? <Link href="/forgot-password">Request a new link</Link> : null}
          </p>
        ) : null}
        <button className="account-primary-button" type="submit" disabled={busy}>
          {busy ? 'Saving password…' : 'Save new password'}
        </button>
        <p className="account-fine-print au-assure"><ShieldCheck size={16} aria-hidden="true" /> The link works once. We email you when the password changes.</p>
      </form>
    </section>
  );
}
