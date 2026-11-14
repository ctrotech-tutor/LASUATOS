'use client';

import {
  CONTACT_PRIVACY_REQUEST_LABELS,
  CONTACT_ROLE_LABELS,
  CONTACT_TOPIC_LABELS,
  CONTACT_TOPICS,
  type ContactInbox,
  type ContactMessage,
  type ContactTopic,
} from '@lasuatos/contracts';
import { BadgeCheck, Bug, Building2, CheckCheck, Inbox, KeyRound, Mail, MessageSquareText, RotateCcw, ShieldCheck, Undo2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CONTACT_INBOX_CHANGED_EVENT, loadContactInbox, setContactMessageStatus } from '../lib/contact-api';
import { lookupAdministrator } from '../lib/current-account';
import { failureText } from '../lib/lecture-api';
import { useFeedback } from './feedback';
import { Select } from './ui/select';
import { ListSkeleton } from './ui/skeleton';

type View = 'new' | 'handled' | 'all';

const TOPIC_ICONS: Record<ContactTopic, typeof Bug> = {
  adoption: Building2,
  problem: Bug,
  account: KeyRound,
  privacy: ShieldCheck,
  other: MessageSquareText,
};

const when = new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' });

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly inbox: ContactInbox };

function replyLink(message: ContactMessage): string {
  const subject = `Re: ${CONTACT_TOPIC_LABELS[message.topic]} [${message.reference}]`;
  const quoted = message.message.split('\n').slice(0, 12).map((line) => `> ${line}`).join('\n');
  const body = `Hello ${message.name.split(' ')[0] ?? message.name},\n\n\n\n—\nOn ${when.format(new Date(message.createdAt))} you wrote:\n${quoted}`;
  return `mailto:${encodeURIComponent(message.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

/**
 * Messages sent to the LASUATOS team from the contact page. Institution
 * administrators reply by email (the sender is the reply address) and mark
 * each message handled; handled messages are deleted after a year.
 */
export function ContactInboxWorkspace() {
  const feedback = useFeedback();
  const [view, setView] = useState<View>('new');
  const [topic, setTopic] = useState<ContactTopic | ''>('');
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState('');

  const filters = useMemo(() => ({ status: view, ...(topic ? { topic } : {}) }), [view, topic]);

  useEffect(() => {
    const controller = new AbortController();
    void lookupAdministrator('read messages to the team').then(async (session) => {
      if (session.kind === 'error') {
        if (!controller.signal.aborted) setLoad({ kind: 'error', message: session.message });
        return;
      }
      if (session.account.role !== 'institution_administrator') {
        if (!controller.signal.aborted) setLoad({ kind: 'error', message: 'Only institution administrators read messages to the LASUATOS team.' });
        return;
      }
      try {
        const inbox = await loadContactInbox(filters, controller.signal);
        if (!controller.signal.aborted) setLoad({ kind: 'ready', inbox });
      } catch (caught) {
        if (!controller.signal.aborted) setLoad({ kind: 'error', message: failureText(caught, 'The messages could not be loaded.') });
      }
    });
    return () => controller.abort();
  }, [filters, attempt]);

  async function mark(message: ContactMessage, status: 'new' | 'handled') {
    if (load.kind !== 'ready') return;
    setBusyId(message.id);
    try {
      const updated = await setContactMessageStatus(message.id, status);
      const leaves = view !== 'all' && view !== status;
      const counts = {
        new: load.inbox.counts.new + (status === 'new' ? 1 : -1),
        handled: load.inbox.counts.handled + (status === 'handled' ? 1 : -1),
      };
      setLoad({
        kind: 'ready',
        inbox: {
          ...load.inbox,
          counts,
          messages: leaves ? load.inbox.messages.filter((item) => item.id !== message.id) : load.inbox.messages.map((item) => (item.id === message.id ? updated : item)),
        },
      });
      window.dispatchEvent(new Event(CONTACT_INBOX_CHANGED_EVENT));
      feedback.toast(status === 'handled' ? `${message.reference} marked handled` : `${message.reference} moved back to new`);
    } catch (caught) {
      feedback.toast(failureText(caught, 'That did not work. Try again.'), 'error');
    } finally {
      setBusyId(null);
    }
  }

  async function loadMore(inbox: ContactInbox) {
    if (!inbox.nextCursor) return;
    setMoreBusy(true);
    setMoreError('');
    try {
      const next = await loadContactInbox({ ...filters, cursor: inbox.nextCursor });
      setLoad({ kind: 'ready', inbox: { ...next, messages: [...inbox.messages, ...next.messages] } });
    } catch (caught) {
      setMoreError(failureText(caught));
    } finally {
      setMoreBusy(false);
    }
  }

  const counts = load.kind === 'ready' ? load.inbox.counts : null;
  const tabs: ReadonlyArray<{ id: View; label: string; count: number | null }> = [
    { id: 'new', label: 'New', count: counts?.new ?? null },
    { id: 'handled', label: 'Handled', count: counts?.handled ?? null },
    { id: 'all', label: 'All', count: counts ? counts.new + counts.handled : null },
  ];

  return (
    <div className="page-stack mx-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">ADMINISTRATION</p>
          <h1>Messages</h1>
          <p className="page-lede">
            What people sent the LASUATOS team from the contact page. Reply by email (it goes straight to the sender), then mark the message handled.
            Handled messages are deleted after a year.
          </p>
        </div>
      </section>

      <div className="mx-bar">
        <div className="mx-tabs" role="tablist" aria-label="Which messages">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={view === tab.id}
              className={`mx-tab${view === tab.id ? ' is-active' : ''}`}
              onClick={() => { if (view !== tab.id) { setView(tab.id); setLoad({ kind: 'loading' }); } }}
            >
              {tab.label}
              {tab.count !== null ? <span className="mx-tab-count">{tab.count}</span> : null}
            </button>
          ))}
        </div>
        <label className="account-field mx-topic">
          <span className="sr-only">Topic</span>
          <Select
            value={topic}
            onValueChange={(value) => { setTopic(value as ContactTopic | ''); setLoad({ kind: 'loading' }); }}
            options={[{ value: '', label: 'Every topic' }, ...CONTACT_TOPICS.map((value) => ({ value, label: CONTACT_TOPIC_LABELS[value] }))]}
            searchable={false}
            size="sm"
            aria-label="Topic"
          />
        </label>
      </div>

      {load.kind === 'loading' ? <ListSkeleton label="Loading messages…" rows={4} /> : null}

      {load.kind === 'error' ? (
        <section className="workspace-message" role="alert">
          <span className="workspace-message-icon" aria-hidden="true">!</span>
          <div>
            <h2>Messages are unavailable</h2>
            <p>{load.message}</p>
            <div className="workspace-message-actions">
              <button className="button button-primary" type="button" onClick={() => { setLoad({ kind: 'loading' }); setAttempt((value) => value + 1); }}>Try again</button>
              <Link className="button button-secondary" href="/admin">Back to administration</Link>
            </div>
          </div>
        </section>
      ) : null}

      {load.kind === 'ready' && load.inbox.messages.length === 0 ? (
        <div className="fr-empty">
          <Inbox size={30} aria-hidden="true" />
          <strong>{view === 'new' ? 'Nothing waiting' : 'No messages here'}</strong>
          <span>{view === 'new' ? 'New messages from the contact page appear here, and you are emailed about each one.' : 'Try another tab or topic.'}</span>
        </div>
      ) : null}

      {load.kind === 'ready' && load.inbox.messages.length > 0 ? (
        <ol className="mx-list">
          {load.inbox.messages.map((message) => {
            const Icon = TOPIC_ICONS[message.topic];
            const facts = [
              message.role ? CONTACT_ROLE_LABELS[message.role] : null,
              message.department,
              message.matricNumber ? `Matric ${message.matricNumber}` : null,
              message.privacyRequest ? CONTACT_PRIVACY_REQUEST_LABELS[message.privacyRequest] : null,
              message.students ? `About ${message.students.toLocaleString('en-NG')} students` : null,
              message.page ? `Where: ${message.page}` : null,
            ].filter((fact): fact is string => Boolean(fact));
            return (
              <li key={message.id} className={`mx-item is-${message.status} is-${message.topic}`}>
                <header className="mx-head">
                  <span className="mx-icon" aria-hidden="true"><Icon size={17} /></span>
                  <div className="mx-who">
                    <strong>{message.name}</strong>
                    <a href={`mailto:${message.email}`}>{message.email}</a>
                  </div>
                  <div className="mx-meta">
                    <time dateTime={message.createdAt}>{when.format(new Date(message.createdAt))}</time>
                    <span className="mx-ref">{message.reference}</span>
                  </div>
                </header>
                <div className="mx-tags">
                  <span className="mx-topic-tag">{CONTACT_TOPIC_LABELS[message.topic]}</span>
                  {message.signedIn ? <span className="mx-verified"><BadgeCheck size={14} aria-hidden="true" /> Signed in</span> : null}
                  {facts.map((fact) => <span key={fact}>{fact}</span>)}
                </div>
                <p className="mx-body">{message.message}</p>
                {message.device ? <p className="mx-device">{message.device}</p> : null}
                <footer className="mx-actions">
                  <a className="button button-primary mx-reply" href={replyLink(message)}><Mail size={16} aria-hidden="true" /> Reply by email</a>
                  {message.status === 'new' ? (
                    <button className="button button-secondary" type="button" disabled={busyId === message.id} onClick={() => void mark(message, 'handled')}>
                      <CheckCheck size={16} aria-hidden="true" /> Mark handled
                    </button>
                  ) : (
                    <>
                      <span className="mx-handled"><CheckCheck size={15} aria-hidden="true" /> Handled{message.handledByName ? ` by ${message.handledByName}` : ''}{message.handledAt ? `, ${when.format(new Date(message.handledAt))}` : ''}</span>
                      <button className="lx-link-button" type="button" disabled={busyId === message.id} onClick={() => void mark(message, 'new')}>
                        <Undo2 size={14} aria-hidden="true" /> Move back to new
                      </button>
                    </>
                  )}
                </footer>
              </li>
            );
          })}
        </ol>
      ) : null}

      {moreError ? <p className="lx-error" role="alert">{moreError}</p> : null}
      {load.kind === 'ready' && load.inbox.nextCursor ? (
        <button className="button button-secondary lx-load-more" type="button" disabled={moreBusy} onClick={() => void loadMore(load.inbox)}>
          <RotateCcw size={15} aria-hidden="true" /> {moreBusy ? 'Loading…' : 'Show older messages'}
        </button>
      ) : null}
    </div>
  );
}
