'use client';

import { PASSWORD_MAX_LENGTH } from '@lasuatos/contracts';
import { useState, type FormEvent } from 'react';
import { NewPasswordFields, newPasswordProblem } from '../account-security';
import { Button } from '../ds';
import { PasswordField } from '../password-field';
import { changePassword } from './api';

/**
 * Changing the password, in a sheet. This device stays signed in; the server signs out every
 * other one, and `onChanged` gets how many.
 */
export function PasswordForm({ starting, onChanged }: Readonly<{
  /** Still on the LASU-style starting password: said at the top. */
  starting: boolean;
  onChanged: (signedOut: number) => void;
}>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const form = new FormData(element);
    // Put the cursor in the field to fix, with its text selected, so a retry is one gesture.
    const fail = (message: string, field: string) => {
      setError(message);
      const input = element.elements.namedItem(field);
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
    };
    const current = String(form.get('currentPassword') ?? '');
    const next = String(form.get('newPassword') ?? '');
    if (!current) return fail(starting ? 'Type your starting password: LASU + matric number + SURNAME.' : 'Type your current password.', 'currentPassword');
    const problem = newPasswordProblem(next, String(form.get('confirmPassword') ?? ''));
    if (problem) return fail(problem, problem.includes('match') ? 'confirmPassword' : 'newPassword');
    if (next === current) return fail('Choose a password different from your current one.', 'newPassword');
    setBusy(true);
    setError('');
    try {
      onChanged(await changePassword(current, next));
    } catch (caught) {
      const message = caught instanceof Error && caught.message ? caught.message : 'Your password was not changed. Try again.';
      setBusy(false);
      if (/current password/i.test(message)) fail(message, 'currentPassword');
      else setError(message);
      return;
    }
    setBusy(false);
  }

  return (
    <form className="acs-form" onSubmit={(event) => void submit(event)} onInput={() => setError('')} noValidate>
      <PasswordField
        label={starting ? 'Starting password' : 'Current password'}
        name="currentPassword"
        autoComplete="current-password"
        maxLength={PASSWORD_MAX_LENGTH}
        autoFocus
        hint={starting ? 'LASU + your matric number + your SURNAME, e.g. LASU250211184ODEJOBI. Capitals and spaces don’t matter.' : undefined}
      />
      <NewPasswordFields />
      {error ? <p className="acs-error" role="alert">{error}</p> : null}
      <Button type="submit" size="lg" block busy={busy} disabled={busy}>{busy ? 'Changing…' : 'Change password'}</Button>
      <p className="acs-fine">You stay signed in here; every other sign-in ends. Forgot your password? Sign out, then choose “Forgot password” on the sign-in page.</p>
    </form>
  );
}
