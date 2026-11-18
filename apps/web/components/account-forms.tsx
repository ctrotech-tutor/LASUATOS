'use client';

import { ApiProblemSchema, AuthenticatedSessionSchema, EmailVerifiedSchema, type GoogleProof } from '@lasuatos/contracts';
import { ArrowRight, BadgeCheck, CloudOff, Link2Off, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { hasPendingCheckIn } from '../lib/check-in-device';
import { takeGoogleResult } from '../lib/google-proof';
import { GoogleButton, useGoogleSignIn } from './onboarding/google-button';
import { forgetSession, useCurrentAccount } from '../lib/current-account';
import { safeNextPath, workspacePath, type AccountKind } from '../lib/workspace';
import { PasswordField } from './password-field';
import { useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { AccountPanelSkeleton } from './ui/skeleton';

export function problemMessage(status: number, body: unknown, fallback: string): string {
  const parsed = ApiProblemSchema.safeParse(body);
  const detail = parsed.success ? parsed.data.detail : undefined;
  const generic = new Set([
    'The request is invalid.',
    'Authentication is required.',
    'The request conflicts with the current resource state.',
    'The request could not be processed.',
  ]);
  if (status === 503 || status >= 500) {
    return 'LASUATOS is busy or waking up. Wait a few seconds and try again.';
  }
  // Server-written messages ("That email already has an account…") are shown as they are.
  if (detail && !generic.has(detail)) return detail;
  if (status === 429) return 'Too many attempts. Wait a few minutes and try again.';
  if (status === 401) return 'That sign-in and password do not match. Check them and try again.';
  if (status === 400 || status === 422) return 'Check the information and try again.';
  return fallback;
}

/** A same-site path from `?next=`, or null. Never an absolute or protocol-relative URL. */
export function nextPathFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  return safeNextPath(new URLSearchParams(window.location.search).get('next'));
}

export function homePathFor(accountType: AccountKind): string {
  return workspacePath(accountType);
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

const subscribeNever = () => () => undefined;

/** Where a fresh sign-in goes: `?next=`, a scanned check-in, or the account's workspace. */
function goAfterSignIn(accountType: AccountKind) {
  forgetSession();
  const next = nextPathFromLocation();
  // replace(), not assign(): Back from the workspace goes to where they were before signing
  // in, not to a sign-in form they no longer need.
  if (next) {
    window.location.replace(next);
    return;
  }
  // A student who opened a QR check-in link before signing in resumes it.
  if (accountType === 'student' && hasPendingCheckIn()) {
    window.location.replace('/check-in');
    return;
  }
  window.location.replace(homePathFor(accountType));
}

/** Signs in and leaves the page; on failure, resolves to the message to show. */
async function signInWith(url: string, payload: { email?: FormDataEntryValue | null; password?: FormDataEntryValue | null; google?: GoogleProof }): Promise<string | null> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await readJson(response);
    const session = AuthenticatedSessionSchema.safeParse(body);
    if (response.ok && session.success) {
      goAfterSignIn(session.data.account.accountType);
      return null;
    }
    return problemMessage(response.status, body, 'Sign-in could not be completed.');
  } catch {
    return 'The account service did not respond. Try again when it is available.';
  }
}

export function AccountLoginForm() {
  const fieldId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [withGoogle, setWithGoogle] = useState(false);
  // Read on the client only; the server render always shows the plain sign-in copy.
  const pendingCheckIn = useSyncExternalStore(subscribeNever, hasPendingCheckIn, () => false);
  const google = useGoogleSignIn();

  // Back from "Sign in with Google" (ADR 028): finish signing in with what Google said.
  useEffect(() => {
    const result = takeGoogleResult(['signin']);
    if (!result) return;
    void (async () => {
      await Promise.resolve();
      if (result.kind === 'error') {
        setError(result.message);
        return;
      }
      setWithGoogle(true);
      setBusy(true);
      const problem = await signInWith('/api/v1/auth/google', { google: result.proof });
      if (problem) {
        setError(problem);
        setWithGoogle(false);
        setBusy(false);
      }
    })();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);
    const problem = await signInWith('/api/v1/auth/login', { email: form.get('email'), password: form.get('password') });
    if (problem) {
      setError(problem);
      setBusy(false);
    }
  }

  return (
    <section className="account-panel" aria-label="Sign in">
      {pendingCheckIn ? (
        <p className="account-notice" role="status">Sign in to finish the lecture check-in you scanned. If the QR code has changed by then, simply scan it again.</p>
      ) : null}
      {withGoogle ? <p className="account-notice" role="status">Signing you in with Google…</p> : null}
      <form className="account-form" onSubmit={submit}>
        <div className="account-field">
          <label htmlFor={`${fieldId}-email`}>Email or matric number</label>
          <input id={`${fieldId}-email`} name="email" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} maxLength={320} required aria-describedby={`${fieldId}-email-hint`} />
          <small id={`${fieldId}-email-hint`}>Students can use their matric number. Staff use their email address.</small>
        </div>
        <PasswordField
          label="Password"
          name="password"
          autoComplete="current-password"
          hint={<>Students: unless you changed it, your password is <strong>LASU</strong> + matric number + <strong>SURNAME</strong>, e.g. LASU250211184ODEJOBI.</>}
        />
        <p className="account-inline-link au-forgot"><Link href="/forgot-password">Forgot your password?</Link></p>
        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <button className="account-primary-button" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : <>Sign in <ArrowRight size={18} aria-hidden="true" /></>}
        </button>
      </form>
      {google ? (
        <div className="account-google">
          <p className="gsi-or">or</p>
          <GoogleButton
            config={google}
            label="Sign in with Google"
            disabled={busy}
            prepare={() => ({ purpose: 'signin', returnTo: `${window.location.pathname}${window.location.search}`, personal: true })}
          />
          <p className="account-google-note">For accounts with a confirmed LASU or Gmail address. Google tells LASUATOS only your email address.</p>
        </div>
      ) : null}
    </section>
  );
}

export function ResendVerificationForm() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage('');
    setError('');
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/v1/auth/resend-verification', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: form.get('email') }),
      });
      if (response.status === 202) {
        setMessage('If this account is waiting for confirmation, a new link will be sent. A short resend delay applies.');
        return;
      }
      setError(problemMessage(response.status, await readJson(response), 'The request could not be completed.'));
    } catch {
      setError('The account service did not respond. Try again when it is available.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="account-resend">
      <summary>Need another confirmation link?</summary>
      <form className="account-form account-resend-form" onSubmit={submit}>
        <label className="account-field">
          <span>Email address</span>
          <input name="email" type="email" autoComplete="email" maxLength={320} required />
        </label>
        {message ? <p className="account-success" role="status">{message}</p> : null}
        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <button className="account-secondary-button" type="submit" disabled={busy}>
          {busy ? 'Requesting link' : 'Request a new link'}
        </button>
      </form>
    </details>
  );
}

export function EmailVerification() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'verifying' | 'verified' | 'invalid' | 'unavailable' | 'missing'>('checking');
  // Signed in already (often the case when the link is opened on the same phone): go to that
  // account's own workspace rather than assuming a student one.
  const account = useCurrentAccount();
  const token = useRef('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    token.current = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    window.setTimeout(() => setStatus(token.current ? 'ready' : 'missing'), 0);
  }, []);

  async function confirmEmail() {
    if (!token.current || status !== 'ready') return;
    setStatus('verifying');

    try {
      const response = await fetch('/api/v1/auth/verify-email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.current }),
      });
      const body = await readJson(response);
      if (response.status === 503) {
        setStatus('unavailable');
        return;
      }
      setStatus(response.ok && EmailVerifiedSchema.safeParse(body).success ? 'verified' : 'invalid');
    } catch {
      setStatus('unavailable');
    }
  }

  if (status === 'checking') return <AccountPanelSkeleton label="Checking your confirmation link…" />;

  return (
    <section className="account-panel account-verification" aria-live="polite">
      {status === 'ready' ? (
        <><span className="account-result-mark is-info" aria-hidden="true"><MailCheck size={28} /></span><h2>Confirm your email address</h2><p>Continue only if you requested this account. Confirmation proves access to this mailbox only. It does not verify LASU student status or the matric number.</p><button className="account-primary-button" type="button" onClick={() => void confirmEmail()}>Confirm email address <ArrowRight size={18} aria-hidden="true" /></button></>
      ) : null}
      {status === 'verifying' ? (
        <><span className="account-result-mark is-info au-pulse" aria-hidden="true"><MailCheck size={28} /></span><h2>Confirming your email</h2><p>Please keep this page open while the account service responds.</p></>
      ) : null}
      {status === 'verified' ? (
        <><span className="account-result-mark" aria-hidden="true"><BadgeCheck size={30} /></span><h2>Email confirmed</h2><p>Your student workspace is ready. Email confirmation verifies your mailbox, not LASU student status or the matric number.</p><button className="account-primary-button" type="button" onClick={() => window.location.assign(account ? workspacePath(account.accountType) : '/attendance')}>Continue <ArrowRight size={18} aria-hidden="true" /></button></>
      ) : null}
      {status === 'unavailable' ? (
        <><span className="account-result-mark is-warn" aria-hidden="true"><CloudOff size={28} /></span><h2>We couldn’t confirm your email</h2><p>Please try again shortly. Your email address has not been confirmed yet.</p><button className="account-secondary-button" type="button" onClick={() => setStatus('ready')}>Try again</button></>
      ) : null}
      {status === 'invalid' || status === 'missing' ? (
        <><span className="account-result-mark is-warn" aria-hidden="true"><Link2Off size={28} /></span><h2>{status === 'missing' ? 'No confirmation link found' : 'This link could not be confirmed'}</h2><p>Links expire after 30 minutes and can only be used once. Request a new one if you still need to confirm your account.</p><ResendVerificationForm /></>
      ) : null}
    </section>
  );
}
