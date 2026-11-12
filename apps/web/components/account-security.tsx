'use client';

import {
  AccountSessionsSchema,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordChangedSchema,
  PasswordResetCompletedSchema,
  SessionsRevokedSchema,
  type AccountSession,
} from '@lasuatos/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { problemMessage, readJson } from './account-forms';
import { PasswordField } from './password-field';

const UNREACHABLE = 'The account service did not respond. Try again when it is available.';

const dateTime = new Intl.DateTimeFormat('en-NG', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Africa/Lagos',
});

function formatDate(value: string | null): string {
  return value ? dateTime.format(new Date(value)) : 'Not recorded';
}

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

export function ForgotPasswordForm() {
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

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
        <p className="section-kicker">PASSWORD RESET</p>
        <h2>Check your email</h2>
        <p>If an active LASUATOS account uses that address, a reset link is on its way. It expires in 30 minutes and works once. Check your spam folder if it does not arrive within a few minutes.</p>
        <p>For your privacy we show this message whether or not the address has an account. Accounts still waiting for email confirmation need a new confirmation link instead.</p>
        <Link className="account-secondary-button" href="/sign-in">Back to sign in</Link>
      </section>
    );
  }

  return (
    <section className="account-panel" aria-labelledby="forgot-heading">
      <div className="account-panel-heading">
        <p className="section-kicker">PASSWORD RESET</p>
        <h2 id="forgot-heading">Reset your password</h2>
        <p>Enter the email address you sign in with. We will email a single-use link to choose a new password.</p>
      </div>
      <form className="account-form" onSubmit={submit}>
        <label className="account-field">
          <span>Email address</span>
          <input name="email" type="email" autoComplete="email" maxLength={320} required />
        </label>
        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <button className="account-primary-button" type="submit" disabled={busy}>
          {busy ? 'Requesting link' : 'Email me a reset link'}
        </button>
      </form>
    </section>
  );
}

export function PasswordResetForm() {
  const [status, setStatus] = useState<'checking' | 'ready' | 'missing' | 'done'>('checking');
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
    window.setTimeout(() => setStatus(/^[A-Za-z0-9_-]{43}$/.test(token.current) ? 'ready' : 'missing'), 0);
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
      <section className="account-panel account-verification" aria-live="polite">
        <p className="section-kicker">PASSWORD RESET</p>
        <h2>Loading reset link</h2>
        <p>Please keep this page open for a moment.</p>
      </section>
    );
  }

  if (status === 'missing') {
    return (
      <section className="account-panel account-verification">
        <p className="section-kicker">PASSWORD RESET</p>
        <h2>No reset link found</h2>
        <p>Open the link from your most recent reset email, or request a new one. Links expire after 30 minutes and work once.</p>
        <Link className="account-primary-button" href="/forgot-password">Request a new link</Link>
      </section>
    );
  }

  if (status === 'done') {
    return (
      <section className="account-panel account-verification" aria-live="polite">
        <span className="account-result-mark" aria-hidden="true">✓</span>
        <h2>Password reset</h2>
        <p>Your new password is set and every device that was signed in has been signed out. We have emailed you a confirmation.</p>
        <Link className="account-primary-button" href="/sign-in">Sign in</Link>
      </section>
    );
  }

  return (
    <section className="account-panel" aria-labelledby="reset-heading">
      <div className="account-panel-heading">
        <p className="section-kicker">PASSWORD RESET</p>
        <h2 id="reset-heading">Choose a new password</h2>
        <p>Saving a new password signs you out on every device, including any you no longer use.</p>
      </div>
      <form className="account-form" onSubmit={submit}>
        <NewPasswordFields autoFocus />
        {error ? (
          <p className="account-error" role="alert">
            {error} {error.startsWith('This reset link') ? <Link href="/forgot-password">Request a new link</Link> : null}
          </p>
        ) : null}
        <button className="account-primary-button" type="submit" disabled={busy}>
          {busy ? 'Saving password' : 'Save new password'}
        </button>
      </form>
    </section>
  );
}

type SessionsState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'signed-out' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly sessions: readonly AccountSession[] };

export function AccountSecurity() {
  const [state, setState] = useState<SessionsState>({ kind: 'loading' });
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/v1/auth/sessions', { cache: 'no-store', signal: controller.signal })
      .then(async (response): Promise<SessionsState> => {
        if (response.status === 401) return { kind: 'signed-out' };
        const body = await readJson(response);
        const parsed = AccountSessionsSchema.safeParse(body);
        if (response.ok && parsed.success) return { kind: 'ready', sessions: parsed.data.sessions };
        return { kind: 'error', message: problemMessage(response.status, body, 'Your sessions could not be loaded.') };
      })
      .catch((): SessionsState => ({ kind: 'error', message: UNREACHABLE }))
      .then((next) => {
        if (!controller.signal.aborted) setState(next);
      });
    return () => controller.abort();
  }, [reload]);

  async function revoke(sessionId: string | null) {
    setPending(sessionId ?? 'others');
    setNotice('');
    setActionError('');
    try {
      const response = await fetch(
        sessionId ? `/api/v1/auth/sessions/${sessionId}` : '/api/v1/auth/sessions/revoke-others',
        { method: sessionId ? 'DELETE' : 'POST' },
      );
      const body = await readJson(response);
      const parsed = SessionsRevokedSchema.safeParse(body);
      if (response.ok && parsed.success) {
        const count = parsed.data.revokedSessions;
        setNotice(count === 0
          ? 'There were no other signed-in sessions.'
          : `Signed out ${count} other session${count === 1 ? '' : 's'}.`);
      } else if (response.status === 404) {
        setNotice('That session had already ended.');
      } else {
        setActionError(problemMessage(response.status, body, 'The session could not be signed out.'));
      }
    } catch {
      setActionError(UNREACHABLE);
    } finally {
      setPending(null);
      setReload((value) => value + 1);
    }
  }

  if (state.kind === 'loading') {
    return <section className="account-panel"><p className="section-kicker">ACCOUNT SECURITY</p><h2>Loading your sessions</h2></section>;
  }
  if (state.kind === 'signed-out') {
    return (
      <section className="account-panel account-verification">
        <p className="section-kicker">ACCOUNT SECURITY</p>
        <h2>Sign in to manage your account</h2>
        <p>Your session has ended or you are not signed in.</p>
        <Link className="account-primary-button" href="/sign-in">Sign in</Link>
      </section>
    );
  }

  const others = state.kind === 'ready' ? state.sessions.filter((session) => !session.current).length : 0;

  return (
    <>
      <section className="account-panel" aria-labelledby="sessions-heading">
        <div className="account-panel-heading">
          <p className="section-kicker">SIGNED-IN SESSIONS</p>
          <h2 id="sessions-heading">Where you are signed in</h2>
          <p>Each sign-in creates a session that lasts up to 30 days. If you see a session you do not recognise, sign it out and change your password. Device names are not recorded, so sessions are identified by when they started and were last used.</p>
        </div>
        {state.kind === 'error' ? <p className="account-error" role="alert">{state.message}</p> : null}
        {state.kind === 'ready' ? (
          <ul className="security-session-list">
            {state.sessions.map((session) => (
              <li key={session.id} className="security-session">
                <div>
                  <strong>{session.current ? 'This browser' : 'Another session'}</strong>
                  {session.current ? <span className="security-session-badge">Current</span> : null}
                  <dl>
                    <div><dt>Signed in</dt><dd>{formatDate(session.createdAt)}</dd></div>
                    <div><dt>Last active</dt><dd>{formatDate(session.lastSeenAt)}</dd></div>
                    <div><dt>Expires</dt><dd>{formatDate(session.expiresAt)}</dd></div>
                  </dl>
                </div>
                {session.current ? null : (
                  <button
                    className="account-secondary-button"
                    type="button"
                    disabled={pending !== null}
                    onClick={() => void revoke(session.id)}
                  >
                    {pending === session.id ? 'Signing out' : 'Sign out'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        {notice ? <p className="account-success" role="status">{notice}</p> : null}
        {actionError ? <p className="account-error" role="alert">{actionError}</p> : null}
        <button
          className="account-secondary-button"
          type="button"
          disabled={pending !== null || others === 0}
          onClick={() => void revoke(null)}
        >
          {pending === 'others' ? 'Signing out' : 'Sign out all other sessions'}
        </button>
        <p className="account-fine-print">To end this browser’s session, use Sign out in the header.</p>
      </section>
      <ChangePasswordForm onChanged={() => setReload((value) => value + 1)} />
    </>
  );
}

function ChangePasswordForm({ onChanged }: { readonly onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const newPassword = String(form.get('newPassword') ?? '');
    const problem = newPasswordProblem(newPassword, String(form.get('confirmPassword') ?? ''));
    setMessage('');
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError('');

    try {
      const response = await fetch('/api/v1/auth/password', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentPassword: form.get('currentPassword'), newPassword }),
      });
      const body = await readJson(response);
      const parsed = PasswordChangedSchema.safeParse(body);
      if (response.ok && parsed.success) {
        formElement.reset();
        const count = parsed.data.revokedSessions;
        setMessage(`Password changed.${count ? ` ${count} other session${count === 1 ? ' was' : 's were'} signed out.` : ''} We have emailed you a confirmation.`);
        onChanged();
        return;
      }
      const detail = body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string' ? body.detail : '';
      setError(response.status === 400 && detail ? detail : problemMessage(response.status, body, 'Your password could not be changed.'));
    } catch {
      setError(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-panel" aria-labelledby="password-heading">
      <div className="account-panel-heading">
        <p className="section-kicker">PASSWORD</p>
        <h2 id="password-heading">Change your password</h2>
        <p>You stay signed in here; every other session is signed out.</p>
      </div>
      <form className="account-form" onSubmit={submit}>
        <PasswordField label="Current password" name="currentPassword" autoComplete="current-password" maxLength={PASSWORD_MAX_LENGTH} />
        <NewPasswordFields />
        {message ? <p className="account-success" role="status">{message}</p> : null}
        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <button className="account-primary-button" type="submit" disabled={busy}>
          {busy ? 'Changing password' : 'Change password'}
        </button>
      </form>
    </section>
  );
}
