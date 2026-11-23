'use client';

import type { StudentSetup } from '@lasuatos/contracts';
import { BadgeCheck, ChevronRight, MailCheck, MailPlus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { failureText } from '../../lib/lecture-api';
import {
  removeSecondaryEmail,
  requestSecondaryEmailCode,
  setMailDelivery,
  verifySecondaryEmail,
} from '../../lib/student-api';
import { Badge, Button, Section } from '../ds';
import { useFeedback } from '../feedback';
import { PasswordField } from '../password-field';
import { BreakableEmail } from './details';

/*
 * The student's linked personal email (ADR 040), for students who cannot open
 * their LASU mailbox: it can get the account's mail (codes, notices) instead,
 * and Google sign-in with it opens the account. Linking asks for the password
 * and a code sent to the address; the LASU email is told about every change.
 */

/** Whether the account's emails (codes and notices) go to the personal email. */
export function mailGoesToPersonal(setup: Pick<StudentSetup, 'mailDelivery' | 'secondaryEmail' | 'secondaryEmailVerified'>): boolean {
  return setup.mailDelivery === 'secondary' && setup.secondaryEmailVerified && Boolean(setup.secondaryEmail);
}

/** The 'Personal email' section on Account, students only. */
export function PersonalEmailSection({ setup, onEdit, onChanged }: Readonly<{
  setup: StudentSetup;
  onEdit: () => void;
  onChanged: (patch: Partial<StudentSetup>, notice: string) => void;
}>) {
  const dialogs = useFeedback();
  const [busy, setBusy] = useState<null | 'mail' | 'remove'>(null);
  const linked = setup.secondaryEmailVerified ? setup.secondaryEmail : null;
  const deliver = mailGoesToPersonal(setup);

  async function chooseMail(delivery: 'primary' | 'secondary') {
    if (busy || (delivery === 'secondary') === deliver) return;
    setBusy('mail');
    try {
      const result = await setMailDelivery(delivery);
      onChanged({ mailDelivery: result.mailDelivery }, delivery === 'secondary' ? 'Your emails now go to your personal email.' : 'Your emails now go to your LASU email.');
    } catch (caught) {
      dialogs.toast(failureText(caught, 'That was not saved. Try again.'), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function remove(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const password = String(new FormData(event.currentTarget).get('password') ?? '');
    if (!password) return dialogs.toast('Type your password to remove it.', 'error');
    setBusy('remove');
    try {
      await removeSecondaryEmail(password);
      onChanged({ secondaryEmail: null, secondaryEmailVerified: false, mailDelivery: 'primary' }, 'Personal email removed. Your emails go to your LASU email again.');
    } catch (caught) {
      dialogs.toast(failureText(caught, 'It was not removed. Try again.'), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <Section
      title="Personal email"
      id="acs-personal-email"
      footer="For when you can’t open your LASU mailbox. Your emails can go to a personal email instead, and Google sign-in with it opens this account. Both addresses are told when it is added, changed or removed."
    >
      <ul className="ds-list acs-details">
        {linked ? (
          <>
            <li>
              <button className="ds-row acs-detail" type="button" onClick={onEdit}>
                <span className="ds-row-body">
                  <span className="acs-detail-label">Linked email</span>
                  <span className="acs-detail-value acs-detail-email"><BreakableEmail email={linked} /></span>
                </span>
                <Badge tone="success"><BadgeCheck size={13} strokeWidth={2.4} aria-hidden="true" /> Verified</Badge>
                <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </li>
            {!setup.emailVerified ? (
              <li>
                <Link className="ds-row acs-action" href="/account/setup">
                  <span className="ds-row-leading" aria-hidden="true"><MailCheck size={18} strokeWidth={2} /></span>
                  <span className="ds-row-body">
                    <span className="ds-row-title">Confirm your LASU email</span>
                    <span className="ds-row-detail">Its code comes to your personal email — no LASU mailbox needed.</span>
                  </span>
                  <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
                </Link>
              </li>
            ) : null}
            <li>
              <div className="ds-row acs-detail acs-mail-choice" role="group" aria-label="Where your emails go">
                <span className="ds-row-body">
                  <span className="acs-detail-label">Your emails go to</span>
                  <span className="acs-mail-options">
                    <button
                      type="button"
                      className={`acs-mail-option${deliver ? '' : ' is-on'}`}
                      aria-pressed={!deliver}
                      disabled={busy === 'mail'}
                      onClick={() => void chooseMail('primary')}
                    >
                      LASU email
                    </button>
                    <button
                      type="button"
                      className={`acs-mail-option${deliver ? ' is-on' : ''}`}
                      aria-pressed={deliver}
                      disabled={busy === 'mail'}
                      onClick={() => void chooseMail('secondary')}
                    >
                      Personal email
                    </button>
                  </span>
                </span>
              </div>
            </li>
            <li>
              <form className="acs-detail acs-remove" onSubmit={(event) => void remove(event)}>
                <PasswordField label="Remove it — your password" name="password" autoComplete="current-password" />
                <Button type="submit" variant="plain" busy={busy === 'remove'} disabled={busy !== null} icon={<Trash2 size={16} aria-hidden="true" />}>
                  {busy === 'remove' ? 'Removing…' : 'Remove personal email'}
                </Button>
              </form>
            </li>
          </>
        ) : (
          <li>
            <button className="ds-row acs-action" type="button" onClick={onEdit}>
              <span className="ds-row-leading" aria-hidden="true"><MailPlus size={18} strokeWidth={2} /></span>
              <span className="ds-row-body">
                <span className="ds-row-title">Link a personal email</span>
                <span className="ds-row-detail">e.g. your Gmail. You’ll get a code there to confirm it.</span>
              </span>
              <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </li>
        )}
      </ul>
    </Section>
  );
}

/**
 * Add or change the personal email, in a sheet: email + password, a code to
 * the address, then the code. The address becomes the mail address (it can be
 * switched back on the section).
 */
export function PersonalEmailForm({ setup, onDone, onChanged }: Readonly<{
  setup: StudentSetup;
  onDone: () => void;
  onChanged: (patch: Partial<StudentSetup>, notice: string) => void;
}>) {
  const dialogs = useFeedback();
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const current = setup.secondaryEmailVerified ? setup.secondaryEmail : null;

  async function sendCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const address = String(form.get('email') ?? '').trim().toLowerCase();
    const password = String(form.get('password') ?? '');
    if (!address) return setError('Enter the personal email to link.');
    if (!password) return setError('Type your password.');
    setBusy(true);
    setError('');
    try {
      await requestSecondaryEmailCode(password, address);
      setEmail(address);
      setStep('code');
      dialogs.toast(`Code sent to ${address}.`);
    } catch (caught) {
      setError(failureText(caught, 'The code could not be sent. Check the email and try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    if (!code) return setError('Enter the 6-digit code from the email.');
    setBusy(true);
    setError('');
    try {
      const result = await verifySecondaryEmail(code);
      onDone();
      onChanged(
        { secondaryEmail: result.email, secondaryEmailVerified: true, mailDelivery: 'secondary' },
        setup.emailVerified
          ? 'Personal email linked. Your emails now go there.'
          : 'Personal email linked. Your emails now go there — confirm your LASU email next; its code comes here.',
      );
    } catch (caught) {
      setError(failureText(caught, 'That code was not right. Check it and try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (step === 'code') {
    return (
      <form className="acs-form" onSubmit={(event) => void confirm(event)} noValidate>
        <p className="acs-step-text">We sent a 6-digit code to <strong><BreakableEmail email={email} /></strong>. Enter it here — it proves that mailbox is yours.</p>
        <label className="account-field">
          <span>Code from the email</span>
          <input
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="6-digit code"
            autoFocus
            data-autofocus
          />
        </label>
        {error ? <p className="acs-error" role="alert">{error}</p> : null}
        <Button type="submit" size="lg" block busy={busy} disabled={busy}>{busy ? 'Checking…' : 'Link this email'}</Button>
        <Button type="button" variant="plain" block onClick={() => { setStep('email'); setError(''); }}>Use a different email</Button>
      </form>
    );
  }

  return (
    <form className="acs-form" onSubmit={(event) => void sendCode(event)} noValidate>
      <p className="acs-step-text">
        {current
          ? <>Your personal email is <strong><BreakableEmail email={current} /></strong>. The new one replaces it after its code.</>
          : 'One you can open on your phone, e.g. your Gmail. We email a code there; enter it and it is linked.'}
      </p>
      <label className="account-field">
        <span>Personal email</span>
        <input
          name="email"
          type="email"
          inputMode="email"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          placeholder="name@gmail.com"
          autoFocus
          data-autofocus
        />
      </label>
      <PasswordField label="Your password" name="password" autoComplete="current-password" hint="Needed to link an email to your account." />
      {error ? <p className="acs-error" role="alert">{error}</p> : null}
      <Button type="submit" size="lg" block busy={busy} disabled={busy}>{busy ? 'Sending the code…' : 'Send the code'}</Button>
    </form>
  );
}
