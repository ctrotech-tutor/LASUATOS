'use client';

import { AuthenticatedSessionSchema, STAFF_ROLE_LABELS, StaffInvitationPreviewSchema, type StaffInvitationPreview } from '@lasuatos/contracts';
import { ArrowRight, Link2Off } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { endSession, firstName, quickAccount, type CurrentAccount } from '../lib/current-account';
import { workspaceAction, workspacePath } from '../lib/workspace';
import { problemMessage, readJson } from './account-forms';
import { NewPasswordFields, newPasswordProblem } from './account-security';
import { SignedInAs } from './auth/signed-in';
import { AccountPanelSkeleton } from './ui/skeleton';

const UNREACHABLE = 'The account service did not respond. Try again when it is available.';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const dateTime = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });

type State =
  | { readonly kind: 'checking' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'ready'; readonly preview: StaffInvitationPreview };

export function AcceptInvitationForm() {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Someone already signed in on this browser (often the administrator who sent the invitation,
  // checking the link). Activating would swap their session for the new account, so they are asked
  // to sign out first.
  const [signedIn, setSignedIn] = useState<CurrentAccount | null>(null);
  const token = useRef('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Read the token from the fragment, then remove it from the address bar and history.
    token.current = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    if (!TOKEN_PATTERN.test(token.current)) {
      window.setTimeout(() => setState({ kind: 'invalid', message: 'No invitation link was found on this page.' }), 0);
      return;
    }
    const checked = fetch('/api/v1/staff-invitations/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token.current }),
      cache: 'no-store',
    })
      .then(async (response): Promise<State> => {
        const body = await readJson(response);
        const preview = StaffInvitationPreviewSchema.safeParse(body);
        if (response.ok && preview.success) return { kind: 'ready', preview: preview.data };
        return {
          kind: 'invalid',
          message: response.status === 404
            ? 'This invitation link is invalid, has expired, has been replaced by a newer one, or has already been used.'
            : problemMessage(response.status, body, 'The invitation could not be checked.'),
        };
      })
      .catch((): State => ({ kind: 'invalid', message: UNREACHABLE }));
    // Both answers arrive together, so the page does not change shape after it appears.
    void Promise.all([checked, quickAccount()]).then(([next, account]) => {
      setSignedIn(account);
      setState(next);
    });
  }, []);

  async function signOutHere() {
    setBusy(true);
    setError('');
    const ok = await endSession();
    setBusy(false);
    // The invitation stays on screen (its link was already taken out of the address bar).
    if (ok) setSignedIn(null);
    else setError('You could not be signed out. Check your connection and try again.');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('newPassword') ?? '');
    const problem = newPasswordProblem(password, String(form.get('confirmPassword') ?? ''));
    if (problem) {
      setError(problem);
      return;
    }
    // Lecturers confirm (or give) the staff number LASU issued them; empty means "not now".
    const isLecturer = state.kind === 'ready' && state.preview.role === 'lecturer';
    const staffNumber = String(form.get('staffNumber') ?? '').trim().replace(/\s+/g, ' ').toUpperCase();
    if (isLecturer && staffNumber && !/^[A-Z0-9][A-Z0-9 ./-]*$/.test(staffNumber)) {
      setError('Use only letters, numbers, spaces, dots, slashes and dashes in the staff number.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/v1/staff-invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.current, password, ...(isLecturer ? { staffNumber: staffNumber || null } : {}) }),
      });
      const body = await readJson(response);
      const session = AuthenticatedSessionSchema.safeParse(body);
      if (response.ok && session.success) {
        token.current = '';
        // replace(): the invitation is spent, so Back should not return to it.
        window.location.replace(workspacePath(session.data.account.accountType));
        return;
      }
      setError(response.status === 404
        ? 'This invitation link is no longer valid. Ask your administrator to resend it.'
        : problemMessage(response.status, body, 'Your account could not be activated.'));
    } catch {
      setError(UNREACHABLE);
    } finally {
      setBusy(false);
    }
  }

  if (state.kind === 'checking') {
    return (
      <AccountPanelSkeleton label="Checking your invitation…" />
    );
  }

  if (state.kind === 'invalid') {
    return (
      <section className="account-panel account-verification">
        <span className="account-result-mark is-warn" aria-hidden="true"><Link2Off size={28} /></span>
        <h2>This invitation cannot be used</h2>
        <p>{state.message} Open the link from the most recent invitation email, or ask the administrator who invited you to resend it.</p>
        {signedIn ? (
          <Link className="account-primary-button" href={workspacePath(signedIn.accountType)}>{workspaceAction(signedIn.accountType)} <ArrowRight size={18} aria-hidden="true" /></Link>
        ) : (
          <Link className="account-primary-button" href="/sign-in">Go to sign in <ArrowRight size={18} aria-hidden="true" /></Link>
        )}
      </section>
    );
  }

  const { preview } = state;
  const ticket = (
    <div className="au-invite">
      <h2 className="au-invite-name" id="invitation-heading">Welcome, {preview.displayName}</h2>
      <p className="au-invite-role">
        <strong>{STAFF_ROLE_LABELS[preview.role]}</strong>
        <span>for {preview.scopeLabel}</span>
      </p>
      <dl>
        <div><dt>Invited by</dt><dd>{preview.invitedByName ?? 'Your administrator'}, {preview.institutionName}</dd></div>
        <div><dt>Account email</dt><dd>{preview.email}</dd></div>
        <div><dt>Link expires</dt><dd>{dateTime.format(new Date(preview.expiresAt))} · works once</dd></div>
      </dl>
    </div>
  );

  if (signedIn) {
    const sameEmail = signedIn.email.toLowerCase() === preview.email.toLowerCase();
    return (
      <section className="account-panel" aria-labelledby="invitation-heading">
        {ticket}
        <div className="au-held" role="note">
          <SignedInAs account={signedIn} compact />
          {sameEmail ? (
            <p>You are signed in with the email this invitation is for. Sign out, then set the password for your new role from this invitation.</p>
          ) : (
            <p>
              This browser is signed in to another account. The invitation is for <strong className="au-break">{preview.email}</strong>:
              if that is your email, sign out first, then set your password. If it is not, forward the invitation to {firstName(preview.displayName)}.
            </p>
          )}
        </div>
        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <button className="account-primary-button" type="button" onClick={() => void signOutHere()} disabled={busy}>
          {busy ? 'Signing out…' : <>Sign out and continue <ArrowRight size={18} aria-hidden="true" /></>}
        </button>
        <Link className="account-secondary-button" href={workspacePath(signedIn.accountType)}>{workspaceAction(signedIn.accountType)}</Link>
      </section>
    );
  }

  return (
    <section className="account-panel" aria-labelledby="invitation-heading">
      {ticket}
      <form className="account-form" onSubmit={submit}>
        <NewPasswordFields autoFocus />
        {preview.role === 'lecturer' ? (
          <label className="account-field">
            <span>LASU staff number <small className="field-optional">optional</small></span>
            <input
              name="staffNumber"
              defaultValue={preview.staffNumber ?? ''}
              maxLength={64}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="As on your LASU staff ID"
            />
            <small>
              {preview.staffNumber
                ? 'Filled in by your administrator. Correct it if it is wrong.'
                : 'The number on your LASU staff ID card. Leave it empty if you do not have it to hand: you can add it later in your account.'}
            </small>
          </label>
        ) : null}
        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <button className="account-primary-button" type="submit" disabled={busy}>
          {busy ? 'Activating account…' : <>Activate account and sign in <ArrowRight size={18} aria-hidden="true" /></>}
        </button>
      </form>
    </section>
  );
}
