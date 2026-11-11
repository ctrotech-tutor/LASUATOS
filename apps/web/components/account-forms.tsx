'use client';

import { ApiProblemSchema, AuthenticatedSessionSchema, EmailVerifiedSchema } from '@lasuatos/contracts';
import { useEffect, useRef, useState, type FormEvent } from 'react';

function problemMessage(status: number, body: unknown, fallback: string): string {
  if (status === 503) {
    return 'Account services are not configured in this environment yet. No account was created.';
  }
  if (status === 401) {
    return 'Email or password was not accepted. If you have not confirmed your email, request a new link below.';
  }
  const parsed = ApiProblemSchema.safeParse(body);
  if (parsed.success && parsed.data.status === 400) return 'Check the information and try again.';
  return fallback;
}

async function readJson(response: Response): Promise<unknown> {
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
        <p>Use an email address you can open. LASU email is welcome, and other email addresses work the same way.</p>
      </div>

      <div className="account-notice">
        <strong>What this confirms</strong>
        <p>Your email link confirms mailbox access only. The matric number is self-reported and is not checked against LASU records.</p>
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
          <small>Keep any leading zeroes. This number is not verified during sign-up.</small>
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
      <p className="account-fine-print">Do not enter real student information in a test environment. A live pilot still needs approved data-handling and retention rules.</p>
    </section>
  );
}

export function AccountLoginForm() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
        window.location.assign(session.data.account.accountType === 'lecturer' ? '/lecturer/courses' : '/courses');
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
        <p className="section-kicker">STUDENT OR LECTURER ACCOUNT</p>
        <h2 id="login-heading">Sign in</h2>
        <p>Students and provisioned lecturers can sign in with their LASUATOS email and password. Lecturer access is assigned separately.</p>
      </div>
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
        <><span className="account-result-mark" aria-hidden="true">✓</span><h2>Email confirmed</h2><p>Your LASUATOS student account is ready to use. This confirms the email address only, not LASU student status or the matric number.</p><button className="account-primary-button" type="button" onClick={() => window.location.assign('/')}>Continue to LASUATOS</button></>
      ) : null}
      {status === 'unavailable' ? (
        <><p className="section-kicker">ACCOUNT SERVICES</p><h2>Confirmation is not available</h2><p>The account service is not configured in this environment. Your link has not been confirmed.</p></>
      ) : null}
      {status === 'invalid' || status === 'missing' ? (
        <><p className="section-kicker">EMAIL CONFIRMATION</p><h2>{status === 'missing' ? 'No confirmation link found' : 'This link could not be confirmed'}</h2><p>Links expire after 30 minutes and can only be used once. Request a new one if you still need to confirm your account.</p><ResendVerificationForm /></>
      ) : null}
    </section>
  );
}
