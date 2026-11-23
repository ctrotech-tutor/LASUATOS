'use client';

import { ApiProblemSchema, AuthenticatedSessionSchema, EmailVerifiedSchema, type GoogleProof } from '@lasuatos/contracts';
import { ArrowRight, BadgeCheck, CloudOff, Fingerprint, Link2Off, MailCheck } from 'lucide-react';
import Link from 'next/link';
import { hasPendingCheckIn } from '../lib/check-in-device';
import { takeGoogleResult } from '../lib/google-proof';
import { GoogleButton, useGoogleSignIn } from './onboarding/google-button';
import { forgetSession, useCurrentAccount } from '../lib/current-account';
import { deviceHasPasskey, passkeysAvailable, signInWithPasskey } from '../lib/passkeys';
import { safeNextPath, workspacePath, type AccountKind } from '../lib/workspace';
import { PasswordField } from './password-field';
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
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

/** An autofill passkey request is re-armed when the email field is used after this long (challenges last 5 minutes). */
const AUTOFILL_REARM_MS = 4 * 60_000;

export function AccountLoginForm() {
  const fieldId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [withGoogle, setWithGoogle] = useState(false);
  const [withPasskey, setWithPasskey] = useState(false);
  // Read on the client only; the server render always shows the plain sign-in copy.
  const pendingCheckIn = useSyncExternalStore(subscribeNever, hasPendingCheckIn, () => false);
  const passkeys = useSyncExternalStore(subscribeNever, passkeysAvailable, () => false);
  const google = useGoogleSignIn();
  const autofillArmedAt = useRef(0);
  const leaving = useRef(false);
  /** The email-or-matric field, so "Sign in with Google" can pre-select a typed address. */
  const identifierRef = useRef<HTMLInputElement>(null);
  // The autofill request arms itself again after a failure; a ref, as a callback can't name itself.
  const rearm = useRef<() => void>(() => undefined);

  // Passkeys (ADR 037, staff). On a device that has used one here, they are offered in the email
  // field's suggestions; anywhere else, the button below asks for one. Students never start this.
  const armAutofill = useCallback(() => {
    if (leaving.current || !passkeysAvailable() || !deviceHasPasskey()) return;
    autofillArmedAt.current = Date.now();
    void signInWithPasskey('autofill', () => { setWithPasskey(true); setBusy(true); setError(''); }).then((result) => {
      if (result.kind === 'signed_in') {
        leaving.current = true;
        goAfterSignIn(result.account.accountType);
        return;
      }
      if (result.kind === 'cancelled') {
        // Replaced by the button, or timed out: the button or the email field arms it again.
        autofillArmedAt.current = 0;
        return;
      }
      setWithPasskey(false);
      setBusy(false);
      setError(result.kind === 'expired' ? 'That took too long. Choose your passkey again.' : result.message);
      autofillArmedAt.current = 0;
      window.setTimeout(() => rearm.current(), 0);
    });
  }, []);

  useEffect(() => {
    rearm.current = armAutofill;
    const timer = window.setTimeout(armAutofill, 0);
    return () => window.clearTimeout(timer);
  }, [armAutofill]);

  async function passkeySignIn() {
    setBusy(true);
    setWithPasskey(true);
    setError('');
    const result = await signInWithPasskey('button');
    if (result.kind === 'signed_in') {
      leaving.current = true;
      goAfterSignIn(result.account.accountType);
      return;
    }
    setBusy(false);
    setWithPasskey(false);
    if (result.kind === 'expired') setError('That took too long. Try again.');
    else if (result.kind === 'failed') setError(result.message);
    else setError('');
    // The button's request replaced the autofill one.
    autofillArmedAt.current = 0;
    armAutofill();
  }

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
      {withPasskey ? <p className="account-notice" role="status">Signing you in with your passkey…</p> : null}
      <form className="account-form" onSubmit={submit}>
        <div className="account-field">
          <label htmlFor={`${fieldId}-email`}>Email or matric number</label>
          <input
            id={`${fieldId}-email`}
            name="email"
            type="text"
            ref={identifierRef}
            // "webauthn": passkeys can appear in this field's suggestions (only where autofill is armed).
            autoComplete="username webauthn"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            maxLength={320}
            required
            aria-describedby={`${fieldId}-email-hint`}
            onFocus={() => { if (autofillArmedAt.current === 0 || Date.now() - autofillArmedAt.current > AUTOFILL_REARM_MS) armAutofill(); }}
          />
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
      {passkeys ? (
        <div className="account-passkey">
          <p className="gsi-or">or</p>
          <button className="account-secondary-button account-passkey-button" type="button" disabled={busy} aria-busy={withPasskey || undefined} onClick={() => void passkeySignIn()}>
            <Fingerprint size={20} strokeWidth={2} aria-hidden="true" />
            Sign in with a passkey
          </button>
          <p className="account-google-note">For staff who have added one in Account. Uses your fingerprint, face or screen lock instead of your password.</p>
        </div>
      ) : null}
      {google ? (
        <div className="account-google">
          {passkeys ? null : <p className="gsi-or">or</p>}
          <GoogleButton
            config={google}
            label="Sign in with Google"
            disabled={busy}
            prepare={() => {
              /* A typed address pre-selects that account on Google's page: it skips the
                 account chooser, which can hide accounts that are on the phone but not in
                 the browser's Google session (and then refuse them as "already on this
                 device"). A matric number is no hint: Google needs the email. */
              const typed = identifierRef.current?.value.trim() ?? '';
              return {
                purpose: 'signin',
                returnTo: `${window.location.pathname}${window.location.search}`,
                personal: true,
                loginHint: /^[^\s@]+@[^\s@]+$/.test(typed) ? typed : null,
              };
            }}
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
