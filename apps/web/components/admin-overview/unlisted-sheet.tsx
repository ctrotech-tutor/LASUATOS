'use client';

import type { UnlistedStudent, UnlistedStudents } from '@lasuatos/contracts';
import { AlertTriangle, ArrowUpRight, CircleCheck, RotateCw, ShieldCheck, ShieldOff, UserRoundSearch } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { failureText } from '../../lib/lecture-api';
import { primeResource, useResource } from '../../lib/resource';
import { changeUnlistedStudentStatus, loadUnlistedStudents } from '../../lib/student-api';
import { Badge, Button, EmptyState, List, ListRow, Sheet, SkeletonLines } from '../ds';
import { useFeedback } from '../feedback';
import { initials, shortDate, whenLabel } from '../staff/format';
import { numberFormat, plural } from './format';
import {
  sortUnlisted,
  UNLISTED_LABEL,
  UNLISTED_REACTIVATE_REASONS,
  UNLISTED_REASON_MIN,
  UNLISTED_SUSPEND_REASONS,
  unlistedAdvice,
  unlistedKind,
} from './unlisted';

const KEY = 'admin:unlisted';
const load = (signal: AbortSignal) => loadUnlistedStudents(signal);

type View = { readonly kind: 'list' } | { readonly kind: 'person' | 'status'; readonly userId: string };

/**
 * Student accounts that are linked to no name on any class list: who they are, why they are
 * probably there, and a way to suspend (or reactivate) them with a reason for the audit log.
 */
export function UnlistedSheet({ open, onClose, onChanged }: Readonly<{
  open: boolean;
  onClose: () => void;
  /** After a suspension or reactivation, so the overview's counts catch up. */
  onChanged: () => void;
}>) {
  const [view, setView] = useState<View>({ kind: 'list' });
  // Start from the list each time it opens.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setView({ kind: 'list' });
  }
  const accounts = useResource(open ? KEY : null, load, { maxAge: 0 });
  const data = accounts.data;
  const person = view.kind === 'list' ? undefined : data?.accounts.find((account) => account.userId === view.userId);

  function patch(userId: string, status: UnlistedStudent['status']) {
    if (data) primeResource<UnlistedStudents>(KEY, { ...data, accounts: data.accounts.map((item) => (item.userId === userId ? { ...item, status } : item)) });
    onChanged();
  }

  const title = person ? person.name : 'Unlisted student accounts';
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      {view.kind === 'status' && person ? (
        <StatusForm
          key={`status-${person.userId}`}
          account={person}
          onCancel={() => setView({ kind: 'person', userId: person.userId })}
          onDone={(status) => {
            patch(person.userId, status);
            setView({ kind: 'person', userId: person.userId });
          }}
        />
      ) : view.kind !== 'list' && person ? (
        <Person
          key={person.userId}
          account={person}
          onBack={() => setView({ kind: 'list' })}
          onStatus={() => setView({ kind: 'status', userId: person.userId })}
        />
      ) : (
        <Accounts resource={accounts} onOpen={(userId) => setView({ kind: 'person', userId })} />
      )}
    </Sheet>
  );
}

function Accounts({ resource, onOpen }: Readonly<{
  resource: ReturnType<typeof useResource<UnlistedStudents>>;
  onOpen: (userId: string) => void;
}>) {
  const now = useNow();
  const sorted = useMemo(() => sortUnlisted(resource.data?.accounts ?? []), [resource.data]);
  if (!resource.data) {
    if (resource.error) {
      return (
        <EmptyState
          error
          icon={<RotateCw size={22} aria-hidden="true" />}
          title="The accounts did not load"
          message={resource.error}
          action={<Button variant="gray" size="sm" onClick={resource.reload}>Try again</Button>}
        />
      );
    }
    return <div className="ovu"><SkeletonLines lines={5} label="Loading accounts" /></div>;
  }
  const { total } = resource.data;
  if (sorted.length === 0) {
    return (
      <EmptyState
        icon={<CircleCheck size={22} aria-hidden="true" />}
        title="Every student account is on a class list"
        message="Accounts that aren’t linked to a class-list name show up here."
      />
    );
  }
  const active = sorted.filter((account) => account.status === 'active');
  const suspended = sorted.filter((account) => account.status === 'suspended');
  return (
    <div className="ovu">
      <p className="ovu-intro">
        These accounts can be used to sign in, but they aren’t linked to any name on a class list, so they are left out of class lists, levels
        and the class-list counts. Usually it’s a second account for one student, a test account, or someone whose number isn’t on a list yet.
      </p>
      {active.length ? (
        <Group label={`Can sign in · ${numberFormat.format(active.length)}`} accounts={active} now={now} onOpen={onOpen} />
      ) : (
        <p className="ovu-note" role="note">
          <ShieldCheck size={16} strokeWidth={2.1} aria-hidden="true" />
          <span>None of these can sign in now. Reactivate one if it was suspended by mistake.</span>
        </p>
      )}
      {suspended.length ? <Group label={`Suspended · ${numberFormat.format(suspended.length)}`} accounts={suspended} now={now} onOpen={onOpen} /> : null}
      {total > sorted.length ? <p className="ovu-footnote">Showing the newest {numberFormat.format(sorted.length)} of {numberFormat.format(total)}.</p> : null}
    </div>
  );
}

function Group({ label, accounts, now, onOpen }: Readonly<{
  label: string;
  accounts: readonly UnlistedStudent[];
  now: number;
  onOpen: (userId: string) => void;
}>) {
  return (
    <section className="ovu-group" aria-label={label}>
      <h3 className="ovu-group-title">{label}</h3>
      <List leading>
        {accounts.map((account) => {
          const kind = unlistedKind(account);
          const off = account.status === 'suspended';
          const badge = off ? <Badge tone="danger">Suspended</Badge> : <Badge tone={kind === 'second' ? 'warning' : kind === 'unlinked' ? 'tint' : 'neutral'}>{UNLISTED_LABEL[kind]}</Badge>;
          return (
            <ListRow
              key={account.userId}
              leading={<span className={`ovu-initials${off ? ' is-off' : ''}`}>{initials(account.name)}</span>}
              title={account.name}
              subtitle={(
                <>
                  <span className="ds-mono">{account.studentNumber}</span>
                  {' · '}
                  {account.lastSeenAt ? `Last seen ${whenLabel(account.lastSeenAt, now).toLowerCase()}` : 'Never signed in'}
                  {/* On phones the badge sits under the details, so the name keeps the width. */}
                  <span className="ovu-badge-narrow">{badge}</span>
                </>
              )}
              trailing={<span className="ovu-badge-wide">{badge}</span>}
              onClick={() => onOpen(account.userId)}
              chevron
            />
          );
        })}
      </List>
    </section>
  );
}

function Person({ account, onBack, onStatus }: Readonly<{
  account: UnlistedStudent;
  onBack: () => void;
  onStatus: () => void;
}>) {
  const now = useNow();
  const advice = unlistedAdvice(account);
  const suspended = account.status === 'suspended';
  return (
    <div className="ovu">
      <div className="ovu-head">
        <span className={`ovu-avatar${suspended ? ' is-off' : ''}`} aria-hidden="true">{initials(account.name)}</span>
        <div className="ovu-who">
          <p className="ovu-number ds-mono">{account.studentNumber}</p>
          <p className="ovu-area">{account.departmentName ?? 'No department'}</p>
          <p className="ovu-badges">
            {suspended ? <Badge tone="danger">Suspended</Badge> : null}
            <Badge tone={unlistedKind(account) === 'second' ? 'warning' : 'neutral'}>{UNLISTED_LABEL[unlistedKind(account)]}</Badge>
            {account.isStaff ? <Badge tone="accent">Staff access</Badge> : null}
          </p>
        </div>
      </div>

      <dl className="ovu-figures">
        <div>
          <dt>Last seen</dt>
          <dd>{account.lastSeenAt ? whenLabel(account.lastSeenAt, now) : 'Never'}</dd>
        </div>
        <div className={account.attendanceRecords > 0 ? 'is-tint' : ''}>
          <dt>Attendance</dt>
          <dd>{account.attendanceRecords > 0 ? plural(account.attendanceRecords, 'check-in') : 'None'}</dd>
        </div>
        <div>
          <dt>Opened</dt>
          <dd>{shortDate(account.createdAt, now)}</dd>
        </div>
      </dl>

      <div className={`ovu-advice${advice.suggestSuspend && !suspended ? ' is-warning' : ''}`}>
        <p className="ovu-advice-title">
          {advice.suggestSuspend && !suspended ? <AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" /> : <UserRoundSearch size={16} strokeWidth={2.1} aria-hidden="true" />}
          {advice.title}
        </p>
        <p className="ovu-advice-text">{advice.text}</p>
        {advice.link ? (
          <Link className="ovu-link" href={advice.link.href}>
            {advice.link.label}
            <ArrowUpRight size={15} strokeWidth={2.2} aria-hidden="true" />
          </Link>
        ) : null}
      </div>

      <List label="Details">
        <ListRow title="Email" subtitle={<span className="ovu-wrap">{account.email}</span>} trailing={account.emailConfirmed ? <Badge tone="success">Confirmed</Badge> : <Badge>Not confirmed</Badge>} />
        <ListRow title="Registered face" detail={account.faceRegistered ? 'Yes' : 'No'} />
      </List>

      {account.isStaff ? (
        <p className="ovu-note" role="note">
          <ShieldCheck size={16} strokeWidth={2.1} aria-hidden="true" />
          <span>This account also has staff access, so it is suspended or reactivated on the <Link className="ovu-inline-link" href="/admin/staff">Staff page</Link>.</span>
        </p>
      ) : null}

      <div className="ovu-actions">
        <Button variant="gray" onClick={onBack}>All accounts</Button>
        {account.isStaff ? null : suspended ? (
          <Button variant="tinted" icon={<ShieldCheck size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={onStatus}>Reactivate</Button>
        ) : (
          <Button variant="gray" className="ovu-danger-text" icon={<ShieldOff size={18} strokeWidth={2.1} aria-hidden="true" />} onClick={onStatus}>Suspend</Button>
        )}
      </div>
    </div>
  );
}

function StatusForm({ account, onCancel, onDone }: Readonly<{
  account: UnlistedStudent;
  onCancel: () => void;
  onDone: (status: UnlistedStudent['status']) => void;
}>) {
  const feedback = useFeedback();
  const suspend = account.status === 'active';
  const reasons: readonly string[] = suspend ? UNLISTED_SUSPEND_REASONS : UNLISTED_REACTIVATE_REASONS;
  const [reason, setReason] = useState('');
  const [other, setOther] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const name = useId();
  const errorId = useId();
  const otherRef = useRef<HTMLTextAreaElement>(null);
  const reasonsRef = useRef<HTMLFieldSetElement>(null);
  const text = reason === 'other' ? other.trim() : reason;
  const first = account.name.split(/\s+/)[0] || account.name;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reason) {
      setError('Choose a reason. It goes in the audit log.');
      reasonsRef.current?.querySelector('input')?.focus();
      return;
    }
    if (text.length < UNLISTED_REASON_MIN) {
      setError(`Say why in at least ${UNLISTED_REASON_MIN} characters.`);
      otherRef.current?.focus();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const changed = await changeUnlistedStudentStatus(account.userId, suspend ? 'suspend' : 'reactivate', text);
      feedback.toast(changed.status === 'suspended' ? `${account.name}’s account was suspended and signed out.` : `${account.name} can sign in again.`);
      onDone(changed.status);
    } catch (caught) {
      setError(failureText(caught, 'That change could not be made. Try again.'));
      setBusy(false);
    }
  }

  return (
    <form className="ovu ovu-form" onSubmit={(event) => void submit(event)} noValidate>
      <fieldset ref={reasonsRef} className="ovu-reasons" aria-describedby={error ? errorId : undefined}>
        <legend>{suspend ? `Why suspend ${first}’s account?` : `Why reactivate ${first}’s account?`}</legend>
        {[...reasons, 'other'].map((value) => (
          <label key={value} className={`ovu-reason${suspend ? ' is-danger' : ''}`}>
            <input
              type="radio"
              name={name}
              value={value}
              checked={reason === value}
              onChange={() => {
                setReason(value);
                setError('');
                if (value === 'other') window.setTimeout(() => otherRef.current?.focus());
              }}
            />
            <span>{value === 'other' ? 'Something else' : value}</span>
          </label>
        ))}
        {reason === 'other' ? (
          <label className="account-field">
            <span className="sr-only">The reason</span>
            <textarea
              ref={otherRef}
              className="ovu-textarea"
              value={other}
              onChange={(event) => setOther(event.target.value)}
              rows={2}
              maxLength={300}
              placeholder="A few words for the audit log"
            />
          </label>
        ) : null}
      </fieldset>
      <p className={`ovu-note${suspend ? ' is-warning' : ''}`} role="note">
        {suspend ? <AlertTriangle size={16} strokeWidth={2.1} aria-hidden="true" /> : <ShieldCheck size={16} strokeWidth={2.1} aria-hidden="true" />}
        <span>
          {suspend
            ? `${account.studentNumber} is signed out on every device at once and can’t sign in until reactivated. Its attendance${account.faceRegistered ? ', face' : ''} and history stay.`
            : 'It can sign in again with its usual password. It is still on no class list until the number is added to one.'}
        </span>
      </p>
      {error ? <p className="ovu-error" id={errorId} role="alert">{error}</p> : null}
      <div className="ovu-actions">
        <Button variant="gray" type="button" onClick={onCancel}>Back</Button>
        <Button type="submit" variant={suspend ? 'destructive' : 'filled'} busy={busy}>
          {suspend ? (busy ? 'Suspending…' : 'Suspend') : (busy ? 'Reactivating…' : 'Reactivate')}
        </Button>
      </div>
    </form>
  );
}

/** The time for "last seen" labels, refreshed each minute while the sheet is open. */
function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}
