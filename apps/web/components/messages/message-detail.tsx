'use client';

import { CONTACT_NOTE_MAX, CONTACT_TOPIC_LABELS, type ContactMessage, type ContactTopic } from '@lasuatos/contracts';
import {
  BadgeCheck, Bug, Building2, CheckCheck, ChevronDown, ChevronUp, CircleAlert, Copy, KeyRound, Link2, Mail, MessageSquareText, PenLine,
  RotateCcw, ShieldCheck, X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Badge, Button, buttonClassName, Menu } from '../ds';
import { useFeedback } from '../feedback';
import {
  agoLabel, copyText, deletedOn, dueState, durationLabel, factsOf, fullDate, listTime, needsIdentityCheck, PATH, preview, replyHref, shortDate,
  startersFor, TOPIC_SHORT, topicLine,
} from './format';

export const TOPIC_ICONS: Readonly<Record<ContactTopic, typeof Bug>> = {
  adoption: Building2,
  problem: Bug,
  account: KeyRound,
  privacy: ShieldCheck,
  other: MessageSquareText,
};

export function TopicGlyph({ topic, size = 18 }: Readonly<{ topic: ContactTopic; size?: number }>) {
  const Icon = TOPIC_ICONS[topic];
  return (
    <span className={`msg-glyph is-${topic}`} aria-hidden="true">
      <Icon size={size} strokeWidth={2.1} />
    </span>
  );
}

export type Nav = {
  readonly previous: (() => void) | null;
  readonly next: (() => void) | null;
  /** "3 of 7" */
  readonly position: string | null;
};

/**
 * One message: who sent it and what they told us, when the reply is due, ways to reply by
 * email, and marking it handled with a note of what was done. In the reading pane on wide
 * screens and in a sheet on phones (`inSheet`, where the sheet's title names the sender).
 */
export function MessageDetail({ message, others, othersError, now, signature, inSheet, onMark, onOpen, onClose, nav }: Readonly<{
  message: ContactMessage;
  /** The sender's other messages; null while they load. */
  others: readonly ContactMessage[] | null;
  othersError?: string | undefined;
  now: number;
  /** The administrator's name, to sign replies. */
  signature: string;
  inSheet: boolean;
  /** Resolves true when the change was saved. */
  onMark: (message: ContactMessage, status: 'new' | 'handled', note?: string) => Promise<boolean>;
  onOpen: (reference: string) => void;
  onClose?: (() => void) | undefined;
  nav: Nav;
}>) {
  const feedback = useFeedback();
  const [note, setNote] = useState(message.note ?? '');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<'handled' | 'new' | 'note' | null>(null);
  const due = dueState(message, now);
  const facts = factsOf(message);
  const starters = startersFor(message);
  const [reply, ...drafts] = starters;
  const handled = message.status === 'handled';
  const tooLong = note.trim().length > CONTACT_NOTE_MAX;

  function copy(text: string, what: string) {
    void copyText(text).then((done) => done
      ? feedback.toast(`${what} copied`)
      : feedback.toast(`The ${what.toLowerCase()} could not be copied.`, 'error'));
  }

  async function mark(status: 'new' | 'handled', kind: 'handled' | 'new' | 'note') {
    if (tooLong) return;
    setBusy(kind);
    const saved = await onMark(message, status, status === 'handled' ? note.trim() : undefined);
    setBusy(null);
    if (saved) setEditing(false);
  }

  const menu = (
    <Menu
      label="Message actions"
      title={`${message.reference} · ${message.name}`}
      items={[
        { label: 'Copy email address', icon: <Mail size={17} />, onSelect: () => copy(message.email, 'Email address') },
        { label: 'Copy reference', icon: <Copy size={17} />, onSelect: () => copy(message.reference, 'Reference') },
        { label: 'Copy link to this message', icon: <Link2 size={17} />, onSelect: () => copy(`${window.location.origin}${PATH}?message=${message.reference}`, 'Link') },
        handled ? { label: 'Move back to new', icon: <RotateCcw size={17} />, onSelect: () => void mark('new', 'new') } : null,
      ]}
    />
  );

  return (
    <article className="msg-detail" tabIndex={-1} aria-label={inSheet ? undefined : `Message from ${message.name}`}>
      <div className="msg-detail-bar">
        <div className="msg-detail-nav">
          <button className="ds-icon-btn" type="button" aria-label="Previous message" data-tip="Previous (K)" disabled={!nav.previous} onClick={nav.previous ?? undefined}>
            <ChevronUp size={18} strokeWidth={2.3} aria-hidden="true" />
          </button>
          <button className="ds-icon-btn" type="button" aria-label="Next message" data-tip="Next (J)" disabled={!nav.next} onClick={nav.next ?? undefined}>
            <ChevronDown size={18} strokeWidth={2.3} aria-hidden="true" />
          </button>
          {nav.position ? <span className="msg-detail-position">{nav.position}</span> : null}
        </div>
        <div className="msg-detail-tools">
          {menu}
          {onClose ? (
            <button className="ds-icon-btn" type="button" aria-label="Close message" data-tip="Close" onClick={onClose}>
              <X size={17} strokeWidth={2.4} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      </div>

      <header className="msg-detail-head">
        <div className="msg-detail-badges">
          <Badge tone={message.topic === 'privacy' ? 'accent' : 'tint'}>{TOPIC_SHORT[message.topic]}</Badge>
          {handled ? <Badge tone="success">Handled</Badge> : <Badge tone="tint" dot>New</Badge>}
          {due && due.tone !== 'neutral' ? <Badge tone={due.tone}>{due.short}</Badge> : null}
        </div>
        {inSheet ? null : <h2 className="msg-detail-name">{message.name}</h2>}
        <p className="msg-detail-from">
          <a href={`mailto:${message.email}`}>{message.email}</a>
          {message.signedIn ? (
            <span className="msg-verified"><BadgeCheck size={15} strokeWidth={2.3} aria-hidden="true" />Signed in</span>
          ) : null}
        </p>
        <p className="msg-detail-when">
          <button className="msg-ref" type="button" onClick={() => copy(message.reference, 'Reference')} aria-label={`${message.reference}, copy reference`} data-tip="Copy reference">
            {message.reference}
          </button>
          <span>
            <time dateTime={message.createdAt}>{fullDate(message.createdAt)}</time>
            {' · '}
            {agoLabel(message.createdAt, now)}
          </span>
        </p>
      </header>

      {due ? (
        <p className={`msg-due is-${due.tone}`}>
          <CircleAlert size={17} strokeWidth={2.3} aria-hidden="true" />
          <span>{due.long}.</span>
        </p>
      ) : null}

      <section className="msg-block" aria-labelledby={`msg-body-${message.id}`}>
        <h3 className="msg-block-title" id={`msg-body-${message.id}`}>{topicLine(message)}</h3>
        <div className="msg-body">{message.message}</div>
      </section>

      {facts.length ? (
        <dl className="msg-facts">
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd className={fact.mono ? 'ds-mono' : undefined}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {needsIdentityCheck(message) ? (
        <p className="msg-callout is-warning">
          <CircleAlert size={17} strokeWidth={2.3} aria-hidden="true" />
          <span>
            <strong>Not signed in, so this email isn’t confirmed.</strong>
            {' '}Check it’s really them before you change an account or send anyone’s data.
          </span>
        </p>
      ) : null}

      <section className="msg-block" aria-labelledby={`msg-reply-${message.id}`}>
        <h3 className="msg-block-title" id={`msg-reply-${message.id}`}>Reply</h3>
        <div className="msg-reply">
          {reply ? (
            <a className={buttonClassName({ variant: handled ? 'tinted' : 'filled' })} href={replyHref(message, reply, signature)}>
              <Mail size={18} strokeWidth={2.2} aria-hidden="true" />
              {handled ? 'Reply again' : 'Reply by email'}
            </a>
          ) : null}
          {drafts.map((starter) => (
            <a key={starter.id} className={buttonClassName({ variant: 'gray', size: 'sm', className: 'msg-draft' })} href={replyHref(message, starter, signature)}>
              <PenLine size={15} strokeWidth={2.2} aria-hidden="true" />
              {starter.label}
            </a>
          ))}
        </div>
        <p className="msg-fine">Opens your email app with the reference in the subject and their message quoted. Read the draft and change it before sending.</p>
      </section>

      <section className="msg-block" aria-labelledby={`msg-done-${message.id}`}>
        <h3 className="msg-block-title" id={`msg-done-${message.id}`}>{handled ? 'Handled' : 'When you’ve replied'}</h3>
        {handled && !editing ? (
          <div className="msg-handled">
            <p className="msg-handled-line">
              <CheckCheck size={18} strokeWidth={2.3} aria-hidden="true" />
              <span>
                {message.handledByName ? <strong>{message.handledByName}</strong> : 'Someone'}
                {' marked it handled '}
                {message.handledAt ? (
                  <>
                    <time dateTime={message.handledAt}>{fullDate(message.handledAt)}</time>
                    {', '}
                    {durationLabel((Date.parse(message.handledAt) - Date.parse(message.createdAt)) / 3_600_000)} after it arrived.
                  </>
                ) : null}
              </span>
            </p>
            {message.note ? <p className="msg-note">{message.note}</p> : <p className="msg-fine">No note about what was done.</p>}
            <div className="msg-actions">
              <Button variant="gray" size="sm" icon={<PenLine size={15} strokeWidth={2.2} />} onClick={() => { setNote(message.note ?? ''); setEditing(true); }}>
                {message.note ? 'Edit note' : 'Add a note'}
              </Button>
              <Button variant="plain" size="sm" icon={<RotateCcw size={15} strokeWidth={2.2} />} busy={busy === 'new'} disabled={busy !== null} onClick={() => void mark('new', 'new')}>
                Move back to new
              </Button>
            </div>
            {message.handledAt ? <p className="msg-fine">Deleted on {shortDate(deletedOn(message.handledAt), now)}, a year after it was handled.</p> : null}
          </div>
        ) : (
          <div className="msg-handle">
            <label className="msg-note-field">
              <span>Note for other administrators <span className="msg-optional">(optional)</span></span>
              <textarea
                value={note}
                rows={handled ? 3 : 2}
                maxLength={CONTACT_NOTE_MAX + 200}
                placeholder={message.topic === 'privacy' ? 'What you did, e.g. Deleted face data on 12 Nov after checking with the HOC' : 'What you did, e.g. Replied with the steps to reset a password'}
                aria-invalid={tooLong || undefined}
                onChange={(event) => setNote(event.target.value)}
              />
              {tooLong ? <span className="msg-field-error" role="alert">Keep the note under {CONTACT_NOTE_MAX} characters.</span> : null}
            </label>
            <div className="msg-actions">
              {handled ? (
                <>
                  <Button size="sm" busy={busy === 'note'} disabled={busy !== null || tooLong} onClick={() => void mark('handled', 'note')}>Save note</Button>
                  <Button variant="plain" size="sm" disabled={busy !== null} onClick={() => { setNote(message.note ?? ''); setEditing(false); }}>Cancel</Button>
                </>
              ) : (
                <Button icon={<CheckCheck size={18} strokeWidth={2.3} />} busy={busy === 'handled'} disabled={busy !== null || tooLong} onClick={() => void mark('handled', 'handled')}>
                  Mark handled
                </Button>
              )}
            </div>
            {message.topic === 'privacy' && !handled ? <p className="msg-fine">The note is your record of how the request was answered. Keep it factual.</p> : null}
          </div>
        )}
      </section>

      <Others others={others} error={othersError} now={now} email={message.email} onOpen={onOpen} />
    </article>
  );
}

function Others({ others, error, now, email, onOpen }: Readonly<{
  others: readonly ContactMessage[] | null;
  error: string | undefined;
  now: number;
  email: string;
  onOpen: (reference: string) => void;
}>) {
  let content: ReactNode;
  if (error && !others) content = <p className="msg-fine">{error}</p>;
  else if (!others) content = <span className="ds-skeleton msg-others-skeleton" aria-hidden="true" />;
  else if (others.length === 0) content = <p className="msg-fine">This is the only message from {email}.</p>;
  else {
    content = (
      <ul className="ds-list msg-others">
        {others.map((other) => (
          <li key={other.id}>
            <button className="ds-row msg-other" type="button" onClick={() => onOpen(other.reference)}>
              <TopicGlyph topic={other.topic} size={15} />
              <span className="ds-row-body">
                <span className="ds-row-title msg-ellipsis">{preview(other.message, 90)}</span>
                <span className="ds-row-subtitle">
                  {CONTACT_TOPIC_LABELS[other.topic]} · {other.reference} · {other.status === 'handled' ? 'handled' : 'new'}
                </span>
              </span>
              <span className="ds-row-detail">{listTime(other.createdAt, now)}</span>
            </button>
          </li>
        ))}
      </ul>
    );
  }
  return (
    <section className="msg-block" aria-label="Other messages from this sender">
      <h3 className="msg-block-title">Also from this sender</h3>
      {content}
    </section>
  );
}
