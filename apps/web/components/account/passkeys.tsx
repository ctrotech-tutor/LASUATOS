'use client';

import { PASSWORD_MAX_LENGTH, type Passkey, type PasskeyList } from '@lasuatos/contracts';
import { ChevronRight, Cloud, Fingerprint, Plus, Smartphone } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type FormEvent } from 'react';
import type { CurrentAccount } from '../../lib/current-account';
import { passkeyLine } from '../../lib/passkey-model';
import { addPasskey, passkeysAvailable, syncPasskeysWithDevice } from '../../lib/passkeys';
import { primeResource, useResource } from '../../lib/resource';
import { Button, Section, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { PasswordField } from '../password-field';
import { loadPasskeys, removePasskey, renamePasskey } from './api';
import { ago, dateLabel } from './model';

export const PASSKEYS_KEY = 'account:passkeys';
const subscribeNever = () => () => undefined;

type StaffAccount = Exclude<CurrentAccount, { accountType: 'student' }>;

/** The account's passkeys (staff only), shared by the section and the administrator prompt. */
export function usePasskeys(account: CurrentAccount | null) {
  return useResource(account && account.accountType !== 'student' ? PASSKEYS_KEY : null, loadPasskeys, { maxAge: 15_000 });
}

/**
 * Passkeys (ADR 037), for lecturers and administrators: sign in with the phone or computer's own
 * screen lock instead of the password. Each opens a sheet to rename or remove it; adding one asks
 * for the password first. The password keeps working either way.
 */
export function PasskeysSection({ account, now, adding, onAdding }: Readonly<{
  account: StaffAccount;
  now: number;
  /** The add sheet is open (also opened by the administrator prompt at the top of the page). */
  adding: boolean;
  onAdding: (open: boolean) => void;
}>) {
  const passkeys = usePasskeys(account);
  const supported = useSyncExternalStore(subscribeNever, passkeysAvailable, () => true);
  const dialogs = useFeedback();
  const [managing, setManaging] = useState<Passkey | null>(null);
  const list = passkeys.data;
  const full = Boolean(list && list.passkeys.length >= list.limit);

  // Keep the password manager in step: removed passkeys stop being offered, new names show.
  useEffect(() => {
    if (list) void syncPasskeysWithDevice(list, account);
  }, [list, account]);

  const replace = (next: PasskeyList) => primeResource(PASSKEYS_KEY, next);

  return (
    <Section
      title="Passkeys"
      id="acs-passkeys"
      aside={list && list.passkeys.length > 0 ? `${list.passkeys.length} of ${list.limit}` : undefined}
      footer="A passkey signs you in with your fingerprint, face or screen lock. It only works on LASUATOS itself, so a fake sign-in page can’t steal it. Your password still works."
    >
      {list ? (
        <ul className="ds-list has-leading acs-passkeys">
          {list.passkeys.map((passkey) => (
            <li key={passkey.id}>
              <button className="ds-row acs-passkey" type="button" onClick={() => setManaging(passkey)}>
                <span className="ds-row-leading" aria-hidden="true">{passkey.synced ? <Cloud size={18} strokeWidth={2} /> : <Smartphone size={18} strokeWidth={2} />}</span>
                <span className="ds-row-body">
                  <span className="ds-row-title">{passkey.name}</span>
                  <span className="ds-row-subtitle">{passkeyLine(passkey, (iso) => ago(iso, now), (iso) => dateLabel(iso, now))}</span>
                </span>
                <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </li>
          ))}
          <li>
            <button className="ds-row acs-action" type="button" disabled={!supported || full} onClick={() => onAdding(true)}>
              <span className="ds-row-leading" aria-hidden="true"><Plus size={18} strokeWidth={2.2} /></span>
              <span className="ds-row-body">
                <span className="ds-row-title is-tint">{list.passkeys.length === 0 ? 'Add a passkey' : 'Add another passkey'}</span>
                {!supported ? <span className="ds-row-subtitle">This browser can’t make passkeys. Try Chrome, Safari or Edge, up to date.</span>
                  : full ? <span className="ds-row-subtitle">You have {list.limit}, the most allowed. Remove one you no longer use first.</span>
                    : list.passkeys.length === 0 ? <span className="ds-row-subtitle">Takes about 20 seconds. Your phone or computer asks for your fingerprint, face or PIN.</span>
                      : null}
              </span>
              {supported && !full ? <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" /> : null}
            </button>
          </li>
        </ul>
      ) : passkeys.error ? (
        <div className="ds-card acs-load-error" role="alert">
          <p>{passkeys.error}</p>
          <Button variant="tinted" size="sm" onClick={passkeys.reload}>Try again</Button>
        </div>
      ) : (
        <ul className="ds-list has-leading" role="status" aria-label="Loading your passkeys">
          <li>
            <div className="ds-row">
              <span className="ds-row-leading ds-skeleton" />
              <span className="ds-row-body"><span className="ds-skeleton" style={{ width: '55%', height: 16 }} /></span>
            </div>
          </li>
        </ul>
      )}

      <Sheet open={adding} onClose={() => onAdding(false)} title="Add a passkey">
        {adding ? (
          <AddPasskeyForm
            onAdded={(passkey) => {
              onAdding(false);
              if (list) replace({ ...list, passkeys: [...list.passkeys, passkey] });
              passkeys.reload();
              dialogs.toast(`Passkey added. Next time, choose “Sign in with a passkey”.`);
            }}
          />
        ) : null}
      </Sheet>

      <Sheet open={managing !== null} onClose={() => setManaging(null)} title="Passkey">
        {managing && list ? (
          <ManagePasskey
            key={managing.id}
            passkey={managing}
            last={list.passkeys.length === 1}
            now={now}
            onClose={() => setManaging(null)}
            onRenamed={(renamed) => {
              replace({ ...list, passkeys: list.passkeys.map((item) => (item.id === renamed.id ? renamed : item)) });
              setManaging(null);
              dialogs.toast('Name saved.');
            }}
            onRemoved={(id) => {
              replace({ ...list, passkeys: list.passkeys.filter((item) => item.id !== id) });
              setManaging(null);
              passkeys.reload();
              dialogs.toast('Passkey removed.');
            }}
          />
        ) : null}
      </Sheet>
    </Section>
  );
}

/** The password again, then the device's own prompt. */
function AddPasskeyForm({ onAdded }: Readonly<{ onAdded: (passkey: Passkey) => void }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const element = event.currentTarget;
    const field = element.elements.namedItem('currentPassword');
    const password = field instanceof HTMLInputElement ? field.value : '';
    const focusPassword = () => {
      if (field instanceof HTMLInputElement) {
        field.focus();
        field.select();
      }
    };
    if (!password) {
      setError('Type your password.');
      focusPassword();
      return;
    }
    setBusy(true);
    setError('');
    setNote('');
    const result = await addPasskey(password);
    setBusy(false);
    if (result.kind === 'added') return onAdded(result.passkey);
    if (result.kind === 'cancelled') {
      setNote('Nothing was added. Press Continue when you’re ready.');
      return;
    }
    setError(result.message);
    if (result.field) focusPassword();
  }

  return (
    <form className="acs-form" onSubmit={(event) => void submit(event)} onInput={() => { setError(''); setNote(''); }} noValidate>
      <p className="acs-step-text"><Fingerprint size={17} strokeWidth={2.2} aria-hidden="true" /> Your phone or computer will ask for your fingerprint, face or screen lock PIN. A passkey saved in Google Password Manager or iCloud Keychain also works on your other devices.</p>
      <PasswordField
        label="Your password"
        name="currentPassword"
        autoComplete="current-password"
        maxLength={PASSWORD_MAX_LENGTH}
        autoFocus
        hint="To check it’s you before adding a new way to sign in."
      />
      {error ? <p className="acs-error" role="alert">{error}</p> : null}
      {note ? <p className="acs-fine" role="status">{note}</p> : null}
      <Button type="submit" size="lg" block busy={busy} disabled={busy} icon={busy ? undefined : <Fingerprint size={18} aria-hidden="true" />}>
        {busy ? 'Waiting for your device…' : 'Continue'}
      </Button>
      <p className="acs-fine">Using a shared or borrowed computer? Don’t add a passkey there.</p>
    </form>
  );
}

/** Rename, or remove after a confirmation. */
function ManagePasskey({ passkey, last, now, onRenamed, onRemoved, onClose }: Readonly<{
  passkey: Passkey;
  last: boolean;
  now: number;
  onClose: () => void;
  onRenamed: (passkey: Passkey) => void;
  onRemoved: (id: string) => void;
}>) {
  const dialogs = useFeedback();
  const [name, setName] = useState(passkey.name);
  const [busy, setBusy] = useState<'rename' | 'remove' | null>(null);
  const [error, setError] = useState('');

  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tidy = name.trim().replace(/\s+/g, ' ');
    if (!tidy) return setError('Give the passkey a name.');
    if (tidy === passkey.name) return onClose();
    setBusy('rename');
    setError('');
    try {
      onRenamed(await renamePasskey(passkey.id, tidy));
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'The name was not saved. Try again.');
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    const sure = await dialogs.confirm({
      title: `Remove “${passkey.name}”?`,
      body: last
        ? 'It will no longer sign you in. This is your only passkey, so you’ll sign in with your password until you add another.'
        : 'It will no longer sign you in. Your password and other passkeys still work.',
      confirmLabel: 'Remove',
      tone: 'danger',
    });
    if (!sure) return;
    setBusy('remove');
    setError('');
    try {
      await removePasskey(passkey.id);
      onRemoved(passkey.id);
    } catch (caught) {
      if (caught && typeof caught === 'object' && 'status' in caught && caught.status === 404) onRemoved(passkey.id);
      else setError(caught instanceof Error && caught.message ? caught.message : 'The passkey was not removed. Try again.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="acs-form">
      <form className="acs-form" onSubmit={(event) => void rename(event)} noValidate>
        <label className="account-field">
          <span>Name</span>
          <input
            name="passkeyName"
            value={name}
            onChange={(event) => { setName(event.target.value); setError(''); }}
            maxLength={60}
            autoComplete="off"
            aria-describedby="acs-passkey-hint"
          />
          <small id="acs-passkey-hint">
            {passkey.synced ? 'Synced through a password manager' : 'Kept on one device or security key'} · added {dateLabel(passkey.createdAt, now)}
            {passkey.lastUsedAt ? ` · last used ${ago(passkey.lastUsedAt, now)}` : ' · not used yet'}
          </small>
        </label>
        {error ? <p className="acs-error" role="alert">{error}</p> : null}
        <Button type="submit" block busy={busy === 'rename'} disabled={busy !== null}>{busy === 'rename' ? 'Saving…' : 'Save name'}</Button>
      </form>
      <Button variant="gray" block className="acs-signout-others" busy={busy === 'remove'} disabled={busy !== null} onClick={() => void remove()}>
        {busy === 'remove' ? 'Removing…' : 'Remove passkey'}
      </Button>
      <p className="acs-fine">Removing it here stops it working for LASUATOS. Your browser may also stop offering it; if not, delete it in your password manager.</p>
    </div>
  );
}
