'use client';

import { ApiProblemSchema, AuthenticatedSessionSchema, EmailVerifiedSchema, PASSWORD_MIN_LENGTH } from '@lasuatos/contracts';
import Link from 'next/link';
import { hasPendingCheckIn } from '../lib/check-in-device';
import { forgetSession } from '../lib/current-account';
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';

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
  if (status === 401) return 'That email and password do not match. Check them and try again.';
  if (status === 400 || status === 422) return 'Check the information and try again.';
  return fallback;
}

/** A same-site path from `?next=`, or null. Never an absolute or protocol-relative URL. */
export function nextPathFromLocation(): string | null {
  if (typeof window === 'undefined') return null;
  const next = new URLSearchParams(window.location.search).get('next');
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return null;
  return next.length <= 300 ? next : null;
}

export function homePathFor(accountType: 'student' | 'lecturer' | 'administrator'): string {
  if (accountType === 'lecturer') return '/sessions';
  if (accountType === 'administrator') return '/admin';
  return '/attendance';
}

export async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export function StudentRegistrationForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');

    setBusy(true);
    try {
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: String(form.get('displayName') ?? '').trim(),
          email: String(form.get('email') ?? '').trim(),
          matricNumber: String(form.get('matricNumber') ?? '').trim(),
          entryLevel: Number(form.get('entryLevel') ?? 100),
          password,
        }),
      });
      if (response.status === 201) {
        forgetSession();
        // Signed in already: continue to a scanned check-in, or to attendance.
        window.location.assign(nextPathFromLocation() ?? (hasPendingCheckIn() ? '/check-in' : '/attendance'));
        return;
      }
      setError(problemMessage(response.status, await readJson(response), 'Your account could not be created. Try again.'));
    } catch {
      setError('LASUATOS did not respond. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-panel" aria-labelledby="registration-heading">
      <div className="account-panel-heading">
        <p className="section-kicker">STUDENT ACCOUNT</p>
        <h2 id="registration-heading">Create your account</h2>
        <p>Takes a minute. You are signed in straight away, and your name and matric number are filled in every time you mark attendance.</p>
      </div>

      <form className="account-form" onSubmit={submit}>
        <label className="account-field">
          <span>Full name</span>
          <input name="displayName" type="text" autoComplete="name" maxLength={160} required placeholder="As on your school ID card" />
        </label>
        <label className="account-field">
          <span>Matric number</span>
          <input name="matricNumber" type="text" inputMode="numeric" autoComplete="off" autoCapitalize="characters" minLength={5} maxLength={32} required placeholder="e.g. 240591001" />
          <small>Your level is worked out from the first two digits (your entry year).</small>
        </label>
        <label className="account-field">
          <span>Email address</span>
          <input name="email" type="email" autoComplete="email" maxLength={320} required />
          <small>You sign in with this. It is also used if you forget your password.</small>
        </label>
        <label className="account-field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="new-password" minLength={PASSWORD_MIN_LENGTH} maxLength={128} required />
          <small>At least {PASSWORD_MIN_LENGTH} characters.</small>
        </label>
        <details className="account-more">
          <summary>Direct Entry student?</summary>
          <label className="account-field">
            <span>How did you enter LASU?</span>
            <select name="entryLevel" defaultValue="100">
              <option value="100">100 Level — UTME</option>
              <option value="200">200 Level — Direct Entry</option>
              <option value="300">300 Level — Direct Entry</option>
            </select>
          </label>
        </details>

        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <button className="account-primary-button" type="submit" disabled={busy}>
          {busy ? 'Creating your account…' : 'Create account'}
        </button>
        <p className="account-fine-print">You do not need an account to mark attendance: scan the QR code and type your name and matric number.</p>
        <p className="account-fine-print">By creating an account you agree to how LASUATOS uses your details, described in the <Link href="/privacy">privacy notice</Link>.</p>
      </form>
    </section>
  );
}

const subscribeNever = () => () => undefined;

export function AccountLoginForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Read on the client only; the server render always shows the plain sign-in copy.
  const pendingCheckIn = useSyncExternalStore(subscribeNever, hasPendingCheckIn, () => false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const form = new FormData(event.currentTarget);

    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: form.get('email'),
          password: form.get('password'),
        }),
      });
      const body = await readJson(response);
      const session = AuthenticatedSessionSchema.safeParse(body);
      if (response.ok && session.success) {
        const accountType = session.data.account.accountType;
        forgetSession();
        const next = nextPathFromLocation();
        if (next) {
          window.location.assign(next);
          return;
        }
        // A student who opened a QR check-in link before signing in resumes it.
        if (accountType === 'student' && hasPendingCheckIn()) {
          window.location.assign('/check-in');
          return;
        }
        window.location.assign(homePathFor(accountType));
        return;
      }
      setError(problemMessage(response.status, body, 'Sign-in could not be completed.'));
    } catch {
      setError('The account service did not respond. Try again when it is available.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-panel" aria-labelledby="login-heading">
      <div className="account-panel-heading">
        <p className="section-kicker">STUDENT · LECTURER · ADMINISTRATOR</p>
        <h2 id="login-heading">Sign in</h2>
        <p>One sign-in for students, class reps, lecturers and administrators. It opens the right place for your account.</p>
      </div>
      {pendingCheckIn ? (
        <p className="account-notice" role="status">Sign in to finish the lecture check-in you scanned. If the QR code has changed by then, simply scan it again.</p>
      ) : null}
      <form className="account-form" onSubmit={submit}>
        <label className="account-field">
          <span>Email address</span>
          <input name="email" type="email" autoComplete="email" maxLength={320} required />
        </label>
        <label className="account-field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="current-password" maxLength={128} required />
        </label>
        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <button className="account-primary-button" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p className="account-inline-link"><Link href="/forgot-password">Forgot your password?</Link></p>
      </form>
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

  return (
    <section className="account-panel account-verification" aria-live="polite">
      {status === 'checking' ? (
        <><p className="section-kicker">EMAIL CONFIRMATION</p><h2>Loading confirmation link</h2><p>Please keep this page open for a moment.</p></>
      ) : null}
      {status === 'ready' ? (
        <><p className="section-kicker">EMAIL CONFIRMATION</p><h2>Confirm your email address</h2><p>Continue only if you requested this account. Confirmation proves access to this mailbox only. It does not verify LASU student status or the matric number.</p><button className="account-primary-button" type="button" onClick={() => void confirmEmail()}>Confirm email address</button></>
      ) : null}
      {status === 'verifying' ? (
        <><p className="section-kicker">EMAIL CONFIRMATION</p><h2>Confirming your email</h2><p>Please keep this page open while the account service responds.</p></>
      ) : null}
      {status === 'verified' ? (
        <><span className="account-result-mark" aria-hidden="true">✓</span><h2>Email confirmed</h2><p>Your student workspace is ready. Email confirmation verifies your mailbox, not LASU student status or the matric number.</p><button className="account-primary-button" type="button" onClick={() => window.location.assign('/attendance')}>Continue</button></>
      ) : null}
      {status === 'unavailable' ? (
        <><p className="section-kicker">EMAIL CONFIRMATION</p><h2>We couldn’t confirm your email</h2><p>Please try again shortly. Your email address has not been confirmed yet.</p></>
      ) : null}
      {status === 'invalid' || status === 'missing' ? (
        <><p className="section-kicker">EMAIL CONFIRMATION</p><h2>{status === 'missing' ? 'No confirmation link found' : 'This link could not be confirmed'}</h2><p>Links expire after 30 minutes and can only be used once. Request a new one if you still need to confirm your account.</p><ResendVerificationForm /></>
      ) : null}
    </section>
  );
}
