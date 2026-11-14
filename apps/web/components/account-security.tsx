'use client';

import {
  AccountSessionsSchema,
  checkPersonName,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  PasswordChangedSchema,
  PasswordResetCompletedSchema,
  ProfileUpdatedSchema,
  SessionsRevokedSchema,
  type AccountSession,
} from '@lasuatos/contracts';
import { ArrowRight, BadgeCheck, Link2Off, MailCheck, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { problemMessage, readJson } from './account-forms';
import { PasswordField } from './password-field';
import { FaceReplacePanel } from './face-replace-panel';
import { AccountPanelSkeleton } from './ui/skeleton';
import { announceAccountChanged, forgetSession, lookupSession, quickAccount, type CurrentAccount } from '../lib/current-account';

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

/**
 * `done`: where the "Check your email" screen leads; sign in by default.
 * `signedIn`: the visitor is helping someone else while signed in, so the student code route
 * (on the open-an-account page, which a signed-in visitor cannot use) is not offered.
 */
export function ForgotPasswordForm({
  done = { href: '/sign-in', label: 'Back to sign in' },
  signedIn = false,
}: Readonly<{ done?: { href: string; label: string }; signedIn?: boolean }>) {
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
        <span className="account-result-mark is-info" aria-hidden="true"><MailCheck size={28} /></span>
        <h2>Check your email</h2>
        <p>If an active LASUATOS account matches, a reset link is on its way to the email on that account (for students, the LASU email they confirmed). It expires in 30 minutes and works once. Check your spam folder if it does not arrive within a few minutes.</p>
        <p>For your privacy we show this message whether or not there is an account.{signedIn ? null : <> Students can also get a 6-digit code instead: <Link href="/sign-up">type your matric number</Link>, then “Reset my password with a code”.</>}</p>
        <Link className="account-secondary-button" href={done.href}>{done.label}</Link>
      </section>
    );
  }

  return (
    <section className="account-panel" aria-label="Reset your password">
      <form className="account-form" onSubmit={submit}>
        <label className="account-field">
          <span>Email or matric number</span>
          <input name="email" type="text" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} minLength={3} maxLength={320} required />
          <small>Students: the link goes to the LASU email on your account.</small>
        </label>
        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <button className="account-primary-button" type="submit" disabled={busy}>
          {busy ? 'Requesting link…' : <>Email me a reset link <ArrowRight size={18} aria-hidden="true" /></>}
        </button>
        {signedIn ? null : <p className="account-inline-link au-alt"><Link href="/sign-up">Student? Get a 6-digit code to your LASU email instead</Link></p>}
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
    return <AccountPanelSkeleton label="Loading your account…" rows={3} />;
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
      <ProfileForm />
      <FaceReplacePanel />
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

/**
 * The person's own name and, for students, their matric number. A matric
 * number can be corrected until the university confirms it; changing it asks
 * for the current password because it decides which attendance is theirs.
 */
function ProfileForm() {
  const [account, setAccount] = useState<CurrentAccount | null | undefined>(undefined);
  const [displayName, setDisplayName] = useState('');
  const [matricNumber, setMatricNumber] = useState('');
  const [staffNumber, setStaffNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void lookupSession().then((result) => {
      if (!active) return;
      const current = result.kind === 'signed_in' ? result.account : null;
      setAccount(current);
      if (current) {
        setDisplayName(current.displayName);
        setMatricNumber(current.accountType === 'student' ? current.matricNumber : '');
      }
    });
    return () => {
      active = false;
    };
  }, []);

  if (account === undefined) return <AccountPanelSkeleton label="Loading your details…" rows={2} />;
  if (account === null) return null;

  const isStudent = account.accountType === 'student';
  const matricLocked = isStudent && account.matricNumberVerified;
  // A student confirmed against the class list is named by it; the HOC corrects it there.
  const nameLocked = matricLocked;
  const normalizedMatric = matricNumber.replace(/\s+/g, '').toUpperCase();
  const matricChanged = isStudent && !matricLocked && normalizedMatric !== account.matricNumber;
  const nameChanged = !nameLocked && displayName.trim().replace(/\s+/g, ' ') !== account.displayName;
  // Lecturers add the staff number LASU issued them once; after that only an administrator corrects it.
  const isLecturer = account.accountType === 'lecturer';
  const recordedStaffNumber = account.accountType === 'lecturer' ? account.staffNumber ?? null : null;
  const normalizedStaffNumber = staffNumber.trim().replace(/\s+/g, ' ').toUpperCase();
  const staffNumberAdded = isLecturer && !recordedStaffNumber && normalizedStaffNumber.length > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!account) return;
    setMessage('');
    setError('');
    if (!nameChanged && !matricChanged && !staffNumberAdded) {
      setMessage('Nothing to save — your details are unchanged.');
      return;
    }
    if (nameChanged && isStudent) {
      // The server's rule, checked first: a first name and surname, no initials.
      const check = checkPersonName(displayName, 'full name', 'full');
      if (!check.ok) {
        setError(check.message);
        return;
      }
    }
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      const response = await fetch('/api/v1/auth/profile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...(nameChanged ? { displayName: displayName.trim() } : {}),
          ...(matricChanged ? { matricNumber: normalizedMatric, currentPassword: form.get('currentPassword') } : {}),
          ...(staffNumberAdded ? { staffNumber: normalizedStaffNumber } : {}),
        }),
      });
      const body = await readJson(response);
      const parsed = ProfileUpdatedSchema.safeParse(body);
      if (response.ok && parsed.success) {
        const next = account.accountType === 'student'
          ? { ...account, displayName: parsed.data.displayName, matricNumber: parsed.data.matricNumber ?? account.matricNumber }
          : account.accountType === 'lecturer'
            ? { ...account, displayName: parsed.data.displayName, staffNumber: parsed.data.staffNumber ?? account.staffNumber ?? null }
            : { ...account, displayName: parsed.data.displayName };
        setAccount(next);
        setStaffNumber('');
        setDisplayName(next.displayName);
        if (next.accountType === 'student') setMatricNumber(next.matricNumber);
        setMessage(matricChanged
          ? 'Saved. Your level is now worked out from the corrected matric number.'
          : staffNumberAdded
            ? 'Saved. Your staff number is now on your account.'
            : 'Your name was updated.');
        announceAccountChanged();
        return;
      }
      const detail = body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string' ? body.detail : '';
      setError((response.status === 400 || response.status === 409) && detail ? detail : problemMessage(response.status, body, 'Your details could not be saved.'));
    } catch {
      setError(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-panel" aria-labelledby="profile-heading">
      <div className="account-panel-heading">
        <p className="section-kicker">YOUR DETAILS</p>
        <h2 id="profile-heading">Name{isStudent ? ' and matric number' : isLecturer ? ' and staff number' : ''}</h2>
        <p>
          {nameLocked
            ? 'Your name and matric number come from your class list. Lecturers see them on attendance registers.'
            : isStudent
              ? 'Use your full name as it appears on university records (no initials). Lecturers see it on attendance registers.'
              : 'This is the name students and colleagues see on sessions and registers.'}
        </p>
      </div>
      <form className="account-form" onSubmit={submit}>
        <label className="account-field">
          <span>Full name</span>
          <input
            name="displayName"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            readOnly={nameLocked}
            aria-readonly={nameLocked || undefined}
            required
            minLength={2}
            maxLength={160}
            autoComplete="name"
          />
          {nameLocked ? <small className="account-field-hint">From your class list. If it is wrong, ask your HOC to correct it: it updates everywhere straight away.</small> : null}
        </label>
        {isStudent ? (
          <label className="account-field">
            <span>Matric number</span>
            <input
              name="matricNumber"
              value={matricNumber}
              onChange={(event) => setMatricNumber(event.target.value)}
              readOnly={matricLocked}
              aria-readonly={matricLocked || undefined}
              required
              minLength={5}
              maxLength={32}
              pattern="[A-Za-z0-9\/ \-]+"
              data-pattern-message="Use letters, digits, / or - only."
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="profile-matric-hint"
            />
            <small className="account-field-hint" id="profile-matric-hint">
              {matricLocked
                ? 'Confirmed by the university, so it can no longer be changed here.'
                : 'Your level comes from the first two digits (your entry year), so fix any typo here.'}
            </small>
          </label>
        ) : null}
        {isLecturer ? (
          <label className="account-field">
            <span>LASU staff number</span>
            <input
              name="staffNumber"
              value={recordedStaffNumber ?? staffNumber}
              onChange={(event) => setStaffNumber(event.target.value.toUpperCase())}
              readOnly={Boolean(recordedStaffNumber)}
              aria-readonly={Boolean(recordedStaffNumber) || undefined}
              maxLength={64}
              pattern="[A-Za-z0-9][A-Za-z0-9 .\/\-]*"
              data-pattern-message="Use letters, digits, spaces, dots, / or - only."
              placeholder="As on your LASU staff ID"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              aria-describedby="profile-staff-hint"
            />
            <small className="account-field-hint" id="profile-staff-hint">
              {recordedStaffNumber
                ? 'Recorded on your account. If it is wrong, ask your administrator to correct it.'
                : 'Not recorded yet. Add the number on your LASU staff ID once; it can only be changed by an administrator afterwards.'}
            </small>
          </label>
        ) : null}
        {matricChanged ? (
          <PasswordField label="Current password" name="currentPassword" autoComplete="current-password" maxLength={PASSWORD_MAX_LENGTH}
            hint="Needed to change your matric number." />
        ) : null}
        {message ? <p className="account-success" role="status">{message}</p> : null}
        {error ? <p className="account-error" role="alert">{error}</p> : null}
        {nameLocked && matricLocked ? null : (
          <button className="account-primary-button" type="submit" disabled={busy}>
            {busy ? 'Saving' : 'Save details'}
          </button>
        )}
      </form>
    </section>
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
    <section className="account-panel" aria-labelledby="password-heading" id="change-password">
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
