'use client';

import { checkPersonName, PASSWORD_MAX_LENGTH, type StudentSetup } from '@lasuatos/contracts';
import { BadgeCheck, ChevronRight, Lock } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent, type ReactNode } from 'react';
import { announceAccountChanged, type CurrentAccount } from '../../lib/current-account';
import { staleResources } from '../../lib/resource';
import { Badge, Button, Section } from '../ds';
import { useFeedback } from '../feedback';
import { PasswordField } from '../password-field';
import { updateProfile } from './api';
import { detailsNote, normalizeMatric, normalizeStaffNumber, tidyName, type AccountSheet } from './model';

/** One detail: the label over its value. A button with a chevron when it can be changed here. */
function DetailRow({ label, value, onEdit, trailing, href, valueClass }: Readonly<{
  label: string;
  value: ReactNode;
  onEdit?: (() => void) | undefined;
  href?: string | undefined;
  trailing?: ReactNode;
  valueClass?: string | undefined;
}>) {
  const body = (
    <>
      <span className="ds-row-body">
        <span className="acs-detail-label">{label}</span>
        <span className={`acs-detail-value${valueClass ? ` ${valueClass}` : ''}`}>{value}</span>
      </span>
      {trailing}
      {onEdit || href ? <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" /> : null}
    </>
  );
  if (href) return <li><Link className="ds-row acs-detail" href={href}>{body}</Link></li>;
  if (onEdit) return <li><button className="ds-row acs-detail" type="button" onClick={onEdit}>{body}</button></li>;
  return <li><div className="ds-row acs-detail">{body}</div></li>;
}

const locked = (
  <span className="acs-lock">
    <Lock size={15} strokeWidth={2.2} aria-hidden="true" />
    <span className="sr-only">Can’t be changed here</span>
  </span>
);

/**
 * Name, matric or staff number, and email. What can be changed opens a sheet; what can't says
 * who changes it (the footnote).
 */
export function DetailsSection({ account, setup, onEdit }: Readonly<{
  account: CurrentAccount;
  setup: StudentSetup | null | undefined;
  onEdit: (sheet: AccountSheet) => void;
}>) {
  const student = account.accountType === 'student' ? account : null;
  const lecturer = account.accountType === 'lecturer' ? account : null;
  const nameLocked = Boolean(student?.matricNumberVerified);
  const emailUnconfirmed = Boolean(student && setup && !setup.emailVerified);

  return (
    <Section title="Your details" id="acs-details" footer={detailsNote(account)}>
      <ul className="ds-list acs-details">
        <DetailRow
          label="Full name"
          value={account.displayName}
          onEdit={nameLocked ? undefined : () => onEdit('name')}
          trailing={nameLocked ? locked : null}
        />
        {student ? (
          <DetailRow
            label="Matric number"
            value={student.matricNumber}
            valueClass="ds-mono"
            onEdit={student.matricNumberVerified ? undefined : () => onEdit('matric')}
            trailing={student.matricNumberVerified
              ? <Badge tone="success"><BadgeCheck size={13} strokeWidth={2.4} aria-hidden="true" /> Verified</Badge>
              : null}
          />
        ) : null}
        {lecturer ? (
          <DetailRow
            label="LASU staff number"
            value={lecturer.staffNumber ?? <span className="acs-detail-add">Add your staff number</span>}
            valueClass={lecturer.staffNumber ? 'ds-mono' : undefined}
            onEdit={lecturer.staffNumber ? undefined : () => onEdit('staff')}
            trailing={lecturer.staffNumber ? locked : null}
          />
        ) : null}
        <DetailRow
          label="Email"
          value={<BreakableEmail email={account.email} />}
          valueClass="acs-detail-email"
          href={emailUnconfirmed ? '/account/setup' : undefined}
          trailing={emailUnconfirmed ? <Badge tone="warning">Confirm</Badge> : null}
        />
      </ul>
    </Section>
  );
}

function failure(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback;
}

/** The name, in a sheet. Students write it in full, without initials (the server's rule, checked first). */
export function NameForm({ account, onDone }: Readonly<{ account: CurrentAccount; onDone: () => void }>) {
  const dialogs = useFeedback();
  const [value, setValue] = useState(account.displayName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const student = account.accountType === 'student';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = tidyName(value);
    if (name === account.displayName) return onDone();
    if (name.length < 2) return setError('Type your full name.');
    if (student) {
      const check = checkPersonName(name, 'name', 'full');
      if (!check.ok) return setError(check.message);
    }
    setBusy(true);
    setError('');
    try {
      await updateProfile({ displayName: name });
      announceAccountChanged();
      dialogs.toast('Name saved.');
      onDone();
    } catch (caught) {
      setError(failure(caught, 'Your name was not saved. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="acs-form" onSubmit={(event) => void submit(event)} noValidate>
      <label className="account-field">
        <span>Full name</span>
        <input
          name="displayName"
          value={value}
          onChange={(event) => { setValue(event.target.value); setError(''); }}
          autoComplete="name"
          autoCapitalize="words"
          maxLength={160}
          aria-invalid={error ? true : undefined}
          aria-describedby="acs-name-hint"
          autoFocus
          data-autofocus
        />
        <small id="acs-name-hint">
          {student ? 'First name and surname as on university records, no initials.' : 'As students should see it on sessions and registers, e.g. Dr. Funke Adebayo.'}
        </small>
      </label>
      {error ? <p className="acs-error" role="alert">{error}</p> : null}
      <Button type="submit" size="lg" block busy={busy} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
    </form>
  );
}

/**
 * The matric number, until the university confirms it. Changing it asks for the password,
 * because it decides whose attendance is whose.
 */
export function MatricForm({ account, onDone }: Readonly<{ account: Extract<CurrentAccount, { accountType: 'student' }>; onDone: () => void }>) {
  const dialogs = useFeedback();
  const [value, setValue] = useState(account.matricNumber);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [matricWrong, setMatricWrong] = useState(false);
  const next = normalizeMatric(value);
  const changed = next !== account.matricNumber.toUpperCase();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!changed) return onDone();
    if (!/^[A-Z0-9/-]{5,32}$/.test(next)) {
      setMatricWrong(true);
      return setError('Use 5 to 32 letters, digits, / or -.');
    }
    const currentPassword = String(new FormData(event.currentTarget).get('currentPassword') ?? '');
    if (!currentPassword) return setError('Type your password to change your matric number.');
    setBusy(true);
    setError('');
    try {
      await updateProfile({ matricNumber: next, currentPassword });
      announceAccountChanged();
      staleResources('student:');
      dialogs.toast('Matric number saved. Your level now comes from it.');
      onDone();
    } catch (caught) {
      const message = failure(caught, 'Your matric number was not saved. Try again.');
      setMatricWrong(!/password/i.test(message));
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="acs-form" onSubmit={(event) => void submit(event)} noValidate>
      <label className="account-field">
        <span>Matric number</span>
        <input
          name="matricNumber"
          className="ds-mono"
          value={value}
          onChange={(event) => { setValue(event.target.value); setError(''); setMatricWrong(false); }}
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={32}
          aria-invalid={matricWrong || undefined}
          aria-describedby="acs-matric-hint"
          autoFocus
          data-autofocus
        />
        <small id="acs-matric-hint">The first two digits are your entry year, which sets your level. You can correct it until the university confirms it.</small>
      </label>
      {changed ? <PasswordField label="Your password" name="currentPassword" autoComplete="current-password" maxLength={PASSWORD_MAX_LENGTH} hint="Needed to change your matric number." /> : null}
      {error ? <p className="acs-error" role="alert">{error}</p> : null}
      <Button type="submit" size="lg" block busy={busy} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
    </form>
  );
}

/** A lecturer's staff number, added once; after that only an administrator corrects it. */
export function StaffNumberForm({ onDone }: Readonly<{ onDone: () => void }>) {
  const dialogs = useFeedback();
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const staffNumber = normalizeStaffNumber(value);
    if (!staffNumber) return setError('Type the number on your LASU staff ID.');
    if (!/^[A-Z0-9][A-Z0-9 ./-]*$/.test(staffNumber)) return setError('Use letters, digits, spaces, dots, / or - only.');
    setBusy(true);
    setError('');
    try {
      await updateProfile({ staffNumber });
      announceAccountChanged();
      dialogs.toast('Staff number saved.');
      onDone();
    } catch (caught) {
      setError(failure(caught, 'Your staff number was not saved. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="acs-form" onSubmit={(event) => void submit(event)} noValidate>
      <label className="account-field">
        <span>LASU staff number</span>
        <input
          name="staffNumber"
          className="ds-mono"
          value={value}
          onChange={(event) => { setValue(event.target.value.toUpperCase()); setError(''); }}
          placeholder="As on your staff ID"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          aria-invalid={error ? true : undefined}
          aria-describedby="acs-staff-hint"
          autoFocus
          data-autofocus
        />
        <small id="acs-staff-hint">Check it before saving: after this, only an administrator can change it.</small>
      </label>
      {error ? <p className="acs-error" role="alert">{error}</p> : null}
      <Button type="submit" size="lg" block busy={busy} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
    </form>
  );
}

/** An address that wraps after the @ or before a dot on narrow screens, never mid-word. */
function BreakableEmail({ email }: Readonly<{ email: string }>) {
  const [user, domain] = email.split('@');
  if (domain === undefined) return email;
  const pieces = domain.split('.');
  return (
    <>
      {user}@<wbr />
      {pieces.map((piece, index) => <span key={index}>{index > 0 ? <><wbr />.</> : null}{piece}</span>)}
    </>
  );
}
