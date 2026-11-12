'use client';

import { AuthenticatedSessionSchema, STAFF_ROLE_LABELS, StaffInvitationPreviewSchema, type StaffInvitationPreview } from '@lasuatos/contracts';
import Link from 'next/link';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { problemMessage, readJson } from './account-forms';
import { NewPasswordFields, newPasswordProblem } from './account-security';

const UNREACHABLE = 'The account service did not respond. Try again when it is available.';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const dateTime = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });

type State =
  | { readonly kind: 'checking' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'ready'; readonly preview: StaffInvitationPreview };

function workspaceFor(accountType: string): string {
  return accountType === 'lecturer' ? '/sessions' : accountType === 'administrator' ? '/admin' : '/courses';
}

export function AcceptInvitationForm() {
  const [state, setState] = useState<State>({ kind: 'checking' });
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
    if (!TOKEN_PATTERN.test(token.current)) {
      window.setTimeout(() => setState({ kind: 'invalid', message: 'No invitation link was found on this page.' }), 0);
      return;
    }
    void fetch('/api/v1/staff-invitations/preview', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: token.current }),
      cache: 'no-store',
    })
      .then(async (response) => {
        const body = await readJson(response);
        const preview = StaffInvitationPreviewSchema.safeParse(body);
        if (response.ok && preview.success) {
          setState({ kind: 'ready', preview: preview.data });
          return;
        }
        setState({
          kind: 'invalid',
          message: response.status === 404
            ? 'This invitation link is invalid, has expired, has been replaced by a newer one, or has already been used.'
            : problemMessage(response.status, body, 'The invitation could not be checked.'),
        });
      })
      .catch(() => setState({ kind: 'invalid', message: UNREACHABLE }));
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
      const response = await fetch('/api/v1/staff-invitations/accept', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.current, password }),
      });
      const body = await readJson(response);
      const session = AuthenticatedSessionSchema.safeParse(body);
      if (response.ok && session.success) {
        token.current = '';
        window.location.assign(workspaceFor(session.data.account.accountType));
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
      <section className="account-panel account-verification" aria-live="polite">
        <p className="section-kicker">STAFF INVITATION</p>
        <h2>Checking your invitation</h2>
        <p>Please keep this page open for a moment.</p>
      </section>
    );
  }

  if (state.kind === 'invalid') {
    return (
      <section className="account-panel account-verification">
        <p className="section-kicker">STAFF INVITATION</p>
        <h2>This invitation cannot be used</h2>
        <p>{state.message} Open the link from the most recent invitation email, or ask the administrator who invited you to resend it.</p>
        <Link className="account-primary-button" href="/sign-in">Go to sign in</Link>
      </section>
    );
  }

  const { preview } = state;
  return (
    <section className="account-panel" aria-labelledby="invitation-heading">
      <div className="account-panel-heading">
        <p className="section-kicker">STAFF INVITATION</p>
        <h2 id="invitation-heading">Welcome, {preview.displayName}</h2>
        <p>
          {preview.invitedByName ? `${preview.invitedByName} invited you` : 'You have been invited'} to join LASUATOS at{' '}
          {preview.institutionName} as <strong>{STAFF_ROLE_LABELS[preview.role]}</strong> for <strong>{preview.scopeLabel}</strong>.
        </p>
        <p>
          Your account email is <strong>{preview.email}</strong>. Choose a password to activate it; you will be signed in
          straight away. This link expires {dateTime.format(new Date(preview.expiresAt))} and works once.
        </p>
      </div>
      <form className="account-form" onSubmit={submit}>
        <NewPasswordFields autoFocus />
        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <button className="account-primary-button" type="submit" disabled={busy}>
          {busy ? 'Activating account' : 'Activate account and sign in'}
        </button>
      </form>
    </section>
  );
}
