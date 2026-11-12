'use client';

import { ApiProblemSchema, AuthenticatedSessionSchema, EmailVerifiedSchema } from '@lasuatos/contracts';
import Link from 'next/link';
import { hasPendingCheckIn } from '../lib/check-in-device';
import { useEffect, useRef, useState, type FormEvent } from 'react';

export function problemMessage(status: number, body: unknown, fallback: string): string {
  const parsed = ApiProblemSchema.safeParse(body);
  if (status === 429) {
    return parsed.success && parsed.data.detail ? parsed.data.detail : 'Too many attempts. Wait a few minutes and try again.';
  }
  if (status === 403 && parsed.success && parsed.data.detail) return parsed.data.detail;
  if (status === 503) {
    return 'Account services are temporarily unavailable. Please try again shortly.';
  }
  if (status === 401) {
    return 'Email or password was not accepted. If you have not confirmed your email, request a new link below.';
  }
  if (parsed.success && parsed.data.status === 400) return 'Check the information and try again.';
  return fallback;
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
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const confirmation = String(form.get('confirmation') ?? '');
    if (password !== confirmation) {
      setError('The passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          displayName: form.get('displayName'),
          email: form.get('email'),
          matricNumber: form.get('matricNumber'),
          password,
        }),
      });
      if (response.status === 202) {
        setSent(true);
        return;
      }
      setError(problemMessage(response.status, await readJson(response), 'Registration could not be completed.'));
    } catch {
      setError('The account service did not respond. Try again when it is available.');
    } finally {
      setBusy(false);
    }
  }

  if (sent) {
    return (
      <section className="account-panel account-result" aria-live="polite">
        <span className="account-result-mark" aria-hidden="true">✓</span>
        <div>
          <h2>Check your inbox</h2>
          <p>If the address can be registered, a confirmation link will be sent. If it does not arrive, request another link in a few minutes.</p>
          <p className="account-fine-print">Email confirmation proves access to the mailbox only. It does not confirm LASU registration or verify the matric number.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="account-panel" aria-labelledby="registration-heading">
      <div className="account-panel-heading">
        <p className="section-kicker">STUDENT ACCOUNT</p>
        <h2 id="registration-heading">Create your account</h2>
        <p>Set up your LASU student workspace with an email address you can access.</p>
      </div>

      <div className="account-notice">
        <strong>A note about your details</strong>
        <p>Your email link confirms access to this mailbox. The matric number is associated with your account but is not checked against LASU records by sign-up.</p>
      </div>

      <form className="account-form" onSubmit={submit}>
        <label className="account-field">
          <span>Full name</span>
          <input name="displayName" type="text" autoComplete="name" maxLength={160} required />
        </label>
        <label className="account-field">
          <span>Email address</span>
          <input name="email" type="email" autoComplete="email" maxLength={320} required />
        </label>
        <label className="account-field">
          <span>Matric number</span>
          <input name="matricNumber" type="text" autoComplete="off" autoCapitalize="characters" maxLength={64} required />
          <small>Use the number associated with your LASU studies, including any leading zeroes.</small>
        </label>
        <label className="account-field">
          <span>Password</span>
          <input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
          <small>Use at least 12 characters.</small>
        </label>
        <label className="account-field">
          <span>Confirm password</span>
          <input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required />
        </label>

        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <button className="account-primary-button" type="submit" disabled={busy}>
          {busy ? 'Sending confirmation' : 'Create student account'}
        </button>
      </form>
    </section>
  );
}

export function AccountLoginForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pendingCheckIn, setPendingCheckIn] = useState(false);

  useEffect(() => {
    setPendingCheckIn(hasPendingCheckIn());
  }, []);

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
        // A student who opened a QR check-in link before signing in resumes it.
        if (accountType === 'student' && hasPendingCheckIn()) {
          window.location.assign('/check-in');
          return;
        }
        window.location.assign(accountType === 'lecturer'
          ? '/lecturer/courses'
          : accountType === 'administrator'
            ? '/admin'
            : '/courses');
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
        <p>Students, lecturers and administrators use the same sign-in. Your LASU-assigned access opens the right workspace; only student accounts can be created here.</p>
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
          {busy ? 'Signing in' : 'Sign in'}
        </button>
        <p className="account-inline-link"><Link href="/forgot-password">Forgot your password?</Link></p>
      </form>
      <ResendVerificationForm />
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
        <><span className="account-result-mark" aria-hidden="true">✓</span><h2>Email confirmed</h2><p>Your student workspace is ready. Email confirmation verifies your mailbox, not LASU student status or the matric number.</p><button className="account-primary-button" type="button" onClick={() => window.location.assign('/courses')}>Open My courses</button></>
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
