'use client';

import { CONTACT_TOPIC_LABELS, CONTACT_TOPICS, type ContactBrief, type ContactInbox, type ContactMessage, type ContactTopic } from '@lasuatos/contracts';
import { CheckCheck, ChevronRight, CircleAlert, ExternalLink, Inbox, RefreshCw, SearchX, ShieldAlert } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { CONTACT_INBOX_CHANGED_EVENT, loadContactInbox, loadContactMessage, setContactMessageStatus } from '../../lib/contact-api';
import { lookupAdministrator, type AdministratorAccount } from '../../lib/current-account';
import { failureText } from '../../lib/lecture-api';
import { primeResource, staleResources, useResource } from '../../lib/resource';
import { Badge, Button, EmptyState, Menu, PageHeader, SegmentedControl, Sheet, Stat, Stats } from '../ds';
import { useFeedback } from '../feedback';
import { GuideButton } from '../shell/guide-button';
import { useClock } from '../take-attendance/hooks';
import { SearchField } from '../ui/search-field';
import { Select } from '../ui/select';
import { useWide } from '../venues/hooks';
import {
  agoLabel, applyChange, dueState, durationLabel, inboxKey, INBOX_PREFIX, listTime, MESSAGE_PREFIX, messageKey, neighbourAfter, PATH, plural,
  preview, PRIVACY_SHORT, readView, shortDate, TOPIC_SHORT, topicLine, viewHref, type Show, type View,
} from './format';
import { MessageDetail, TopicGlyph, type Nav } from './message-detail';
import './messages.css';

type Answer = { readonly kind: 'ok'; readonly account: AdministratorAccount } | { readonly kind: 'denied'; readonly message: string };

const WHO_KEY = 'admin:messages-who';

async function loadWho(): Promise<Answer> {
  const session = await lookupAdministrator('read messages to the team');
  if (session.kind === 'error') return { kind: 'denied', message: session.message };
  if (session.account.role !== 'institution_administrator') {
    return { kind: 'denied', message: 'Messages from the contact page go to institution administrators. Ask one of them if you need something from it.' };
  }
  return { kind: 'ok', account: session.account };
}

/** Polling replaces the list with its first page, so it stops once older messages are loaded. */
const firstPageOnly = (inbox: ContactInbox) => inbox.messages.length <= 30;

/**
 * Messages: what people sent the LASUATOS team from the contact page. Opens on the new ones,
 * with what is overdue and the privacy requests (which have a legal deadline) first. Each
 * message opens beside the list on wide screens and in a sheet on phones: reply by email, then
 * mark it handled with a note of what was done.
 */
export function Messages() {
  const who = useResource(WHO_KEY, loadWho, { maxAge: 60_000 });
  const answer = who.data;
  if (answer?.kind === 'denied') {
    return (
      <div className="msg">
        <PageHeader title="Messages" />
        <div className="ds-card">
          <EmptyState icon={<Inbox size={26} strokeWidth={1.9} />} title="Messages are for institution administrators" message={answer.message} action={<Button href="/" variant="tinted">Go home</Button>} />
        </div>
      </div>
    );
  }
  if (!answer) {
    return (
      <div className="msg">
        <PageHeader title="Messages" />
        {who.error ? (
          <div className="ds-card">
            <EmptyState error title="Messages did not load" message={who.error} action={<Button variant="tinted" onClick={who.reload}>Try again</Button>} />
          </div>
        ) : <PageSkeleton />}
      </div>
    );
  }
  return <Workspace account={answer.account} />;
}

const SHOW_LABEL: Readonly<Record<Show, string>> = { new: 'New', handled: 'Handled', all: 'All' };

function Workspace({ account }: Readonly<{ account: AdministratorAccount }>) {
  const router = useRouter();
  const pathname = usePathname() ?? PATH;
  const params = useSearchParams();
  const view = readView(params);
  const wide = useWide();
  const now = useClock('fifteen');
  const feedback = useFeedback();

  // The search box answers at once; the address (and the server) follow after a pause.
  const [query, setQuery] = useState(view.q);
  const [lastQ, setLastQ] = useState(view.q);
  if (view.q !== lastQ) {
    setLastQ(view.q);
    setQuery(view.q);
  }

  const go = useCallback((next: Partial<View>) => {
    router.replace(viewHref(pathname, { ...view, ...next }), { scroll: false });
  }, [router, pathname, view]);
  const open = useCallback((reference: string | null) => go({ message: reference }), [go]);

  useEffect(() => {
    if (query.trim() === view.q.trim()) return undefined;
    const timer = window.setTimeout(() => go({ q: query, message: null }), 350);
    return () => window.clearTimeout(timer);
  }, [query, view.q, go]);

  const key = inboxKey(view);
  const { show, topic, q } = view;
  const loadInbox = useCallback(
    (signal: AbortSignal) => loadContactInbox({ status: show, ...(topic ? { topic } : {}), ...(q.trim() ? { q: q.trim() } : {}) }, signal),
    [show, topic, q],
  );
  const inbox = useResource(key, loadInbox, { maxAge: 20_000, poll: 60_000, pollWhile: firstPageOnly });

  // Keep the last answer on screen while another filter loads.
  const [lastInbox, setLastInbox] = useState<ContactInbox | null>(inbox.data ?? null);
  if (inbox.data && inbox.data !== lastInbox) setLastInbox(inbox.data);
  const data = inbox.data ?? lastInbox;
  const switching = !inbox.data && lastInbox !== null;

  const reference = view.message;
  const loadDetail = useCallback((signal: AbortSignal) => loadContactMessage(reference ?? '', signal), [reference]);
  const detail = useResource(reference ? messageKey(reference) : null, loadDetail, { maxAge: 20_000 });
  const detailData = detail.data?.message.reference === reference ? detail.data : undefined;

  const messages = data?.messages ?? [];
  const fromList = reference ? messages.find((item) => item.reference === reference) ?? null : null;
  const selected = detailData?.message ?? fromList;
  // After moving to another message from inside one, focus follows to the new message's top.
  const pendingFocus = useRef(false);
  const focusDetail = () => { pendingFocus.current = true; };
  const shownId = selected?.id ?? null;
  useEffect(() => {
    if (!pendingFocus.current || !shownId) return undefined;
    pendingFocus.current = false;
    const frame = window.requestAnimationFrame(() => {
      const host = document.querySelector<HTMLElement>('.msg-pane-card') ?? [...document.querySelectorAll<HTMLElement>('dialog[open] .ds-sheet-body')].pop();
      host?.scrollTo({ top: 0 });
      host?.querySelector<HTMLElement>('.msg-detail')?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [shownId]);

  const index = selected ? messages.findIndex((item) => item.id === selected.id) : -1;
  const nav: Nav = {
    previous: index > 0 ? () => { focusDetail(); open(messages[index - 1]!.reference); } : null,
    next: index >= 0 && index < messages.length - 1 ? () => { focusDetail(); open(messages[index + 1]!.reference); } : null,
    position: index >= 0 ? `${index + 1} of ${data?.nextCursor ? `${messages.length}+` : messages.length}` : null,
  };

  // J and K move through the list, Escape closes the message (wide screens; phones have the sheet).
  const keys = useRef({ nav, close: () => open(null), active: false });
  useEffect(() => {
    keys.current = { nav, close: () => open(null), active: wide };
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const { nav: current, close, active } = keys.current;
      if (!active || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="radiogroup"]') || document.querySelector('dialog[open]')) return;
      if (event.key === 'j' && current.next) { event.preventDefault(); current.next(); }
      else if (event.key === 'k' && current.previous) { event.preventDefault(); current.previous(); }
      else if (event.key === 'Escape' && current.position !== null) { event.preventDefault(); close(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [moreBusy, setMoreBusy] = useState(false);
  async function loadMore() {
    const current = inbox.data;
    if (!current?.nextCursor) return;
    setMoreBusy(true);
    try {
      const next = await loadContactInbox({ status: show, ...(topic ? { topic } : {}), ...(q.trim() ? { q: q.trim() } : {}), cursor: current.nextCursor });
      primeResource(key, { ...next, messages: [...current.messages, ...next.messages] });
    } catch (caught) {
      feedback.toast(failureText(caught, 'Older messages did not load. Try again.'), 'error');
    } finally {
      setMoreBusy(false);
    }
  }

  async function mark(message: ContactMessage, status: 'new' | 'handled', note?: string): Promise<boolean> {
    try {
      const updated = await setContactMessageStatus(message.id, status, note);
      const list = inbox.data;
      if (list) primeResource(key, applyChange(list, show, message, updated));
      const opened = detailData;
      if (opened && opened.message.id === updated.id) primeResource(messageKey(updated.reference), { ...opened, message: updated });
      staleResources(INBOX_PREFIX);
      staleResources(MESSAGE_PREFIX);
      staleResources('admin:messages-new');
      inbox.reload();
      window.dispatchEvent(new Event(CONTACT_INBOX_CHANGED_EVENT));
      const noteOnly = message.status === 'handled' && status === 'handled';
      feedback.toast(noteOnly ? 'Note saved' : status === 'handled' ? `${message.reference} marked handled` : `${message.reference} moved back to new`);
      // Handling a new message moves on to the next one, as a mail app does.
      if (status === 'handled' && message.status === 'new' && show === 'new' && list) {
        const next = neighbourAfter(list.messages, message.id);
        if (next) focusDetail();
        open(next ? next.reference : null);
      }
      return true;
    } catch (caught) {
      feedback.toast(failureText(caught, 'That did not save. Try again.'), 'error');
      return false;
    }
  }

  const reloadAll = () => {
    staleResources(INBOX_PREFIX);
    inbox.reload();
    detail.reload();
  };

  if (!data) {
    return (
      <div className="msg">
        <Header />
        {inbox.error ? (
          <div className="ds-card">
            <EmptyState error title="Messages did not load" message={inbox.error} action={<Button variant="tinted" onClick={inbox.reload}>Try again</Button>} />
          </div>
        ) : <PageSkeleton />}
      </div>
    );
  }

  const { counts, summary } = data;
  const filtered = Boolean(view.topic || view.q.trim());
  const subtitle = counts.new === 0
    ? 'All caught up'
    : [plural(counts.new, 'new message'), summary.overdue ? `${summary.overdue} overdue` : null].filter(Boolean).join(' · ');

  const renderDetail = (message: ContactMessage, inSheet: boolean) => (
    <MessageDetail
      key={message.id}
      message={message}
      others={detailData && detailData.message.id === message.id ? detailData.others : null}
      othersError={detail.error}
      now={now || Date.parse(message.createdAt)}
      signature={account.displayName}
      inSheet={inSheet}
      onMark={mark}
      onOpen={(next) => { focusDetail(); open(next); }}
      onClose={inSheet ? undefined : () => open(null)}
      nav={nav}
    />
  );

  const missing = reference && !selected ? (
    detail.error ? (
      <EmptyState
        error
        icon={<SearchX size={26} strokeWidth={1.9} />}
        title="That message isn’t here"
        message={detail.error}
        action={<Button variant="tinted" onClick={() => open(null)}>Back to messages</Button>}
      />
    ) : <DetailSkeleton />
  ) : null;

  return (
    <div className="msg">
      <Header subtitle={subtitle} onRefresh={reloadAll} />

      <MessageStats inbox={data} now={now} />

      <Attention summary={summary} now={now} onOpen={open} onAllPrivacy={() => go({ show: 'new', topic: 'privacy', q: '', message: null })} />

      <div className="msg-tools" id="msg-tools">
        <SegmentedControl
          label="Show"
          value={view.show}
          onChange={(value) => go({ show: value, message: null })}
          segments={(['new', 'handled', 'all'] as const).map((value) => ({
            value,
            label: value === 'all' ? SHOW_LABEL.all : (
              <>
                {SHOW_LABEL[value]}
                <span className="msg-count">{(value === 'new' ? counts.new : counts.handled).toLocaleString('en-NG')}</span>
              </>
            ),
          }))}
        />
        <label className="msg-topic">
          <span className="sr-only">Topic</span>
          <Select
            value={view.topic ?? 'all'}
            aria-label="Topic"
            onValueChange={(value) => go({ topic: value === 'all' ? null : value as ContactTopic, message: null })}
            options={[
              { value: 'all', label: 'Every topic', description: `${counts.new} new` },
              ...CONTACT_TOPICS.map((item) => ({ value: item, label: TOPIC_SHORT[item], description: `${summary.newByTopic[item]} new` })),
            ]}
          />
        </label>
        <SearchField className="msg-find" value={query} onValueChange={setQuery} placeholder={wide ? 'Name, email, reference or words' : 'Search'} aria-label="Search messages" />
      </div>

      <div className={`msg-split${wide ? ' is-wide' : ''}`}>
        <section className="msg-list-col" aria-label={`${SHOW_LABEL[view.show]} messages`} aria-busy={switching || undefined}>
          {messages.length === 0 ? (
            <div className="ds-card">
              <ListEmpty
                view={view}
                filtered={filtered}
                onClear={() => { setQuery(''); go({ q: '', topic: null, message: null }); }}
                onHandled={() => go({ show: 'handled', message: null })}
              />
            </div>
          ) : (
            <>
              {filtered ? (
                <p className="msg-result" role="status">
                  {plural(messages.length, 'message')}{data.nextCursor ? '+' : ''}
                  {view.topic ? ` about ${TOPIC_SHORT[view.topic].toLowerCase()}` : ''}
                  {view.q.trim() ? ` matching “${view.q.trim()}”` : ''}
                </p>
              ) : null}
              <ul className={`ds-list msg-list${switching ? ' is-switching' : ''}`}>
                {messages.map((message) => (
                  <MessageRow
                    key={message.id}
                    message={message}
                    now={now}
                    show={view.show}
                    selected={wide && message.id === selected?.id}
                    onOpen={() => open(message.reference)}
                  />
                ))}
              </ul>
              {data.nextCursor ? (
                <div className="msg-more">
                  <Button variant="gray" busy={moreBusy} disabled={moreBusy} onClick={() => void loadMore()}>Show older messages</Button>
                </div>
              ) : messages.length > 8 ? <p className="msg-end">That’s every {view.show === 'all' ? '' : `${SHOW_LABEL[view.show].toLowerCase()} `}message{filtered ? ' that matches' : ''}.</p> : null}
            </>
          )}
        </section>

        {wide ? (
          <aside className="msg-pane" aria-label={selected ? `Message from ${selected.name}` : 'Reading pane'}>
            <div className="msg-pane-card">
              {selected ? renderDetail(selected, false) : missing ?? <PanePlaceholder count={messages.length} />}
            </div>
          </aside>
        ) : null}
      </div>

      {!wide ? (
        <PhoneSheet open={reference !== null} selected={selected} fallback={missing} render={(message) => renderDetail(message, true)} onClose={() => open(null)} />
      ) : null}
    </div>
  );
}

function Header({ subtitle, onRefresh }: Readonly<{ subtitle?: string; onRefresh?: () => void }>) {
  return (
    <PageHeader
      title="Messages"
      subtitle={subtitle}
      actions={(
        <div className="msg-head-actions">
          <GuideButton page={PATH} label="Messages" />
          {onRefresh ? (
            <Menu
              label="More actions"
              items={[
                { label: 'Check for new messages', icon: <RefreshCw size={17} />, onSelect: onRefresh },
                { label: 'Open the contact page', icon: <ExternalLink size={17} />, onSelect: () => window.open('/contact', '_blank', 'noopener') },
              ]}
            />
          ) : null}
        </div>
      )}
    />
  );
}

function MessageStats({ inbox, now }: Readonly<{ inbox: ContactInbox; now: number }>) {
  const { counts, summary } = inbox;
  const nextPrivacy = summary.privacyOpen[0];
  const privacyDue = nextPrivacy ? dueState({ ...nextPrivacy, status: 'new' }, now) : null;
  return (
    <Stats label="Messages at a glance">
      <Stat label="New" value={counts.new.toLocaleString('en-NG')} hint={summary.oldestNewAt ? `oldest ${agoLabel(summary.oldestNewAt, now)}` : 'all caught up'} />
      <Stat label="Overdue" value={summary.overdue.toLocaleString('en-NG')} hint="past the reply date" tone={summary.overdue ? 'warning' : undefined} />
      <Stat
        label={summary.privacyOpen.length === 1 ? 'Privacy request' : 'Privacy requests'}
        value={summary.newByTopic.privacy.toLocaleString('en-NG')}
        hint={privacyDue ? `next due ${shortDate(privacyDue.due, now)}` : 'none open'}
        tone={privacyDue && privacyDue.tone !== 'neutral' ? 'warning' : undefined}
      />
      <Stat
        label="Handled, 30 days"
        value={summary.handledLast30Days.toLocaleString('en-NG')}
        hint={summary.medianHandleHours === null ? `${counts.handled} kept` : `usually in ${durationLabel(summary.medianHandleHours)}`}
        tone={summary.handledLast30Days ? 'success' : undefined}
      />
    </Stats>
  );
}

/** Privacy requests (30 days by law) and other messages past the two-working-day reply. */
function Attention({ summary, now, onOpen, onAllPrivacy }: Readonly<{
  summary: ContactInbox['summary'];
  now: number;
  onOpen: (reference: string) => void;
  onAllPrivacy: () => void;
}>) {
  const privacy = summary.privacyOpen.slice(0, 4);
  const late = summary.overdueOldest.slice(0, Math.max(2, 6 - privacy.length));
  if (!privacy.length && !late.length) return null;
  const morePrivacy = summary.newByTopic.privacy - privacy.length;
  const row = (item: ContactBrief) => {
    const due = dueState({ ...item, status: 'new' }, now);
    return (
      <li key={item.id}>
        <button className="ds-row msg-look-row" type="button" onClick={() => onOpen(item.reference)}>
          {item.topic === 'privacy'
            ? <ShieldAlert className={`msg-look-icon is-${due?.tone ?? 'neutral'}`} size={18} strokeWidth={2.2} aria-hidden="true" />
            : <CircleAlert className="msg-look-icon is-warning" size={18} strokeWidth={2.2} aria-hidden="true" />}
          <span className="ds-row-body">
            <span className="ds-row-title">
              {item.name}
              <span className="msg-look-what"> · {item.topic === 'privacy' ? PRIVACY_SHORT[item.privacyRequest ?? 'other'] : TOPIC_SHORT[item.topic]}</span>
            </span>
            <span className="ds-row-subtitle">{due?.brief}</span>
          </span>
          {due && due.tone !== 'neutral' ? <Badge tone={due.tone}>{due.short}</Badge> : null}
          <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </li>
    );
  };
  return (
    <section className="ds-section msg-look" aria-labelledby="msg-look-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="msg-look-title">Needs a look</h2>
        <span className="ds-section-aside">
          {[summary.newByTopic.privacy ? plural(summary.newByTopic.privacy, 'privacy request') : null, summary.overdue ? `${summary.overdue} overdue` : null].filter(Boolean).join(' · ')}
        </span>
      </div>
      <ul className="ds-list msg-look-list">
        {privacy.map(row)}
        {late.map(row)}
      </ul>
      {morePrivacy > 0 ? (
        <p className="ds-section-foot">
          <button className="msg-link" type="button" onClick={onAllPrivacy}>Show all {summary.newByTopic.privacy} privacy requests</button>
        </p>
      ) : null}
    </section>
  );
}

function MessageRow({ message, now, show, selected, onOpen }: Readonly<{
  message: ContactMessage;
  now: number;
  show: Show;
  selected: boolean;
  onOpen: () => void;
}>) {
  const due = dueState(message, now);
  const unread = message.status === 'new' && show !== 'new';
  return (
    <li>
      <button
        className={`ds-row msg-row${selected ? ' is-selected' : ''}${unread ? ' is-unread' : ''}`}
        type="button"
        aria-current={selected ? 'true' : undefined}
        onClick={onOpen}
      >
        <TopicGlyph topic={message.topic} />
        <span className="ds-row-body msg-row-body">
          <span className="msg-row-top">
            {unread ? <span className="msg-dot"><span className="sr-only">New: </span></span> : null}
            <span className="ds-row-title msg-ellipsis">{message.name}</span>
            <time className="msg-row-time" dateTime={message.createdAt}>{now ? listTime(message.createdAt, now) : ''}</time>
          </span>
          <span className="msg-row-meta">
            <span className="msg-ellipsis">{topicLine(message)}</span>
            {due && due.tone !== 'neutral' ? <Badge tone={due.tone}>{due.short}</Badge> : null}
            {message.status === 'handled' && show !== 'handled' ? (
              <span className="msg-row-done"><CheckCheck size={14} strokeWidth={2.4} aria-hidden="true" />Handled</span>
            ) : null}
          </span>
          <span className="msg-row-preview">{preview(message.message)}</span>
        </span>
      </button>
    </li>
  );
}

function ListEmpty({ view, filtered, onClear, onHandled }: Readonly<{ view: View; filtered: boolean; onClear: () => void; onHandled: () => void }>) {
  if (filtered) {
    const topic = view.topic ? CONTACT_TOPIC_LABELS[view.topic].toLowerCase() : null;
    return (
      <EmptyState
        icon={<SearchX size={26} strokeWidth={1.9} />}
        title={view.q.trim() ? `Nothing matches “${view.q.trim()}”` : `No ${view.show === 'all' ? '' : `${SHOW_LABEL[view.show].toLowerCase()} `}messages about this`}
        message={`Searching ${view.show === 'all' ? 'all' : SHOW_LABEL[view.show].toLowerCase()} messages${topic ? ` about “${topic}”` : ''}. Search finds a reference, or words in a name, email address or message.`}
        action={<Button variant="tinted" onClick={onClear}>Clear search and topic</Button>}
      />
    );
  }
  if (view.show === 'new') {
    return (
      <EmptyState
        icon={<CheckCheck size={26} strokeWidth={1.9} />}
        title="All caught up"
        message="New messages from the contact page land here, and every institution administrator is emailed about each one."
        action={<Button variant="tinted" onClick={onHandled}>See handled messages</Button>}
      />
    );
  }
  return <EmptyState icon={<Inbox size={26} strokeWidth={1.9} />} title={view.show === 'handled' ? 'Nothing handled yet' : 'No messages yet'} message="Messages sent from the contact page appear here." />;
}

function PanePlaceholder({ count }: Readonly<{ count: number }>) {
  return (
    <div className="msg-placeholder">
      <EmptyState
        icon={<Inbox size={26} strokeWidth={1.9} />}
        title={count ? 'Choose a message to read it' : 'Nothing to read here'}
        message={count ? 'Press J and K to move down and up the list.' : undefined}
      />
    </div>
  );
}

function PhoneSheet({ open, selected, fallback, render, onClose }: Readonly<{
  open: boolean;
  selected: ContactMessage | null;
  /** Shown while a linked message loads, or when it is gone. */
  fallback: ReactNode;
  render: (message: ContactMessage) => ReactNode;
  onClose: () => void;
}>) {
  // Keep the last message on screen while the sheet slides away.
  const [last, setLast] = useState(selected);
  if (selected && selected !== last) setLast(selected);
  const shown = open ? selected : last;
  return (
    <Sheet open={open} onClose={onClose} title={shown?.name ?? 'Message'} size="wide">
      {shown ? render(shown) : open ? fallback : null}
    </Sheet>
  );
}

function DetailSkeleton() {
  return (
    <div className="msg-detail-skeleton" role="status" aria-label="Loading the message">
      <span className="ds-skeleton" style={{ width: '30%', height: 20 }} />
      <span className="ds-skeleton" style={{ width: '55%', height: 28 }} />
      <span className="ds-skeleton" style={{ width: '70%', height: 16 }} />
      <span className="ds-skeleton" style={{ width: '100%', height: 120 }} />
    </div>
  );
}

function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading messages">
      <div className="ds-stats" aria-hidden="true">
        {[1, 2, 3, 4].map((item) => (
          <div className="ds-stat" key={item}>
            <span className="ds-skeleton" style={{ width: '60%', height: 14 }} />
            <span className="ds-skeleton" style={{ width: '40%', height: 28, marginTop: 8 }} />
          </div>
        ))}
      </div>
      <ul className="ds-list msg-list" aria-hidden="true" style={{ marginTop: 24 }}>
        {[62, 48, 70, 54, 40].map((width) => (
          <li key={width}>
            <div className="ds-row msg-row">
              <span className="msg-glyph ds-skeleton" />
              <span className="ds-row-body msg-row-body">
                <span className="ds-skeleton" style={{ width: `${width}%`, height: 16 }} />
                <span className="ds-skeleton" style={{ width: '88%', height: 13, marginTop: 6 }} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
