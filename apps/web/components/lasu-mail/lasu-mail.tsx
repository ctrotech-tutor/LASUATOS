'use client';

import { ExternalLink, EyeOff, Inbox, LockKeyhole, LogOut, Mail, RefreshCw, Search, ShieldCheck, Star, Unplug } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useCurrentAccount } from '../../lib/current-account';
import {
  connect, connectedMailbox, currentToken, disconnect, dropToken, inDomains, loadLasuMailConfig, maySilentlyReconnect, onMailChanged, PROBLEM_TEXT,
  readyConfig, rememberMailbox, reportMailProblem, takeMailResult, type MailResult, type MailToken, type ReadyMailConfig,
} from '../../lib/lasu-mail/connect';
import { forgetSummaries, GmailError, loadInboxCounts, loadPage, loadProfile } from '../../lib/lasu-mail/gmail';
import { initials, type MailSummary } from '../../lib/lasu-mail/message';
import { useResource } from '../../lib/resource';
import { Badge, Button, EmptyState, Menu, PageHeader, SegmentedControl } from '../ds';
import { GuideButton } from '../shell/guide-button';
import { SearchField } from '../ui/search-field';
import { useClock } from '../take-attendance/hooks';
import { EMPTY_TEXT, FOLDER_LABEL, FOLDER_QUERY, gmailLink, listDate, type Folder } from './format';
import { MailReader } from './reader';
import './lasu-mail.css';

const CONFIG_KEY = 'mail:config';
const loadConfig = (signal: AbortSignal) => loadLasuMailConfig(signal);
/** The first page refreshes on its own while the page is open and visible. */
const REFRESH_MS = 90_000;
const FOLDERS: readonly Folder[] = ['inbox', 'unread', 'lasu', 'starred'];

/**
 * LASU mail (ADR 030): the student's LASU inbox, read-only, inside the app. The
 * page asks the server only whether it is switched on; everything after that is
 * between this browser and Google.
 */
export function LasuMail() {
  const account = useCurrentAccount();
  const config = useResource(CONFIG_KEY, loadConfig, { maxAge: 60_000 });
  const owner = account?.email.toLowerCase() ?? null;

  if (!config.data || !owner) {
    return (
      <div className="ml">
        <PageHeader title="LASU mail" />
        {config.error ? (
          <div className="ds-card">
            <EmptyState error title="LASU mail didn’t load" message={config.error} action={<Button variant="tinted" onClick={config.reload}>Try again</Button>} />
          </div>
        ) : <ListSkeleton />}
      </div>
    );
  }
  const ready = readyConfig(config.data, window.location.origin);
  if (!ready) {
    return (
      <div className="ml">
        <PageHeader title="LASU mail" />
        <div className="ds-card">
          <EmptyState
            icon={<Mail size={26} strokeWidth={1.9} />}
            title="LASU mail isn’t open yet"
            message="Reading your LASU student email here isn’t switched on yet. You can read it in the Gmail app or at mail.google.com, signed in with your LASU account."
            action={<Button href="https://mail.google.com/" variant="tinted" icon={<ExternalLink size={18} />}>Open Gmail</Button>}
          />
        </div>
      </div>
    );
  }
  return <Connected config={ready} owner={owner} />;
}

/** Holds the token for this tab, reconnects quietly when it runs out, or offers to connect. */
function Connected({ config, owner }: Readonly<{ config: ReadyMailConfig; owner: string }>) {
  const [token, setToken] = useState<MailToken | null>(null);
  const [checked, setChecked] = useState(false);
  const [problem, setProblem] = useState<MailResult | null>(null);
  const [reconnecting, setReconnecting] = useState(false);

  useEffect(() => {
    let first = true;
    const sync = () => {
      // What went wrong (on the way back from Google, or a mailbox that isn't LASU's) is read once.
      const result = takeMailResult();
      if (first || result) setProblem(result);
      first = false;
      setToken(currentToken(owner));
      setChecked(true);
    };
    sync();
    // The token lasts an hour: look again when it would expire and whenever the tab comes back.
    const timer = window.setInterval(sync, 30_000);
    const onVisible = () => { if (document.visibilityState === 'visible') sync(); };
    document.addEventListener('visibilitychange', onVisible);
    const stop = onMailChanged(sync);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      stop();
    };
  }, [owner]);

  // Connected here before: go back to Google quietly (no screens) for a fresh token.
  useEffect(() => {
    if (!checked || token || problem || reconnecting) return;
    if (!connectedMailbox(owner) || !maySilentlyReconnect()) return;
    window.setTimeout(() => setReconnecting(true), 0);
    connect(config, { owner, returnTo: window.location.pathname + window.location.search, silent: true });
  }, [checked, token, problem, reconnecting, owner, config]);

  if (!checked || reconnecting) {
    return (
      <div className="ml">
        <PageHeader title="LASU mail" subtitle={reconnecting ? 'Reconnecting to your LASU mail…' : undefined} />
        <ListSkeleton label={reconnecting ? 'Reconnecting to your LASU mail' : 'Loading'} />
      </div>
    );
  }
  if (!token) return <ConnectScreen config={config} owner={owner} problem={problem} />;
  return <Mailbox key={token.accessToken} config={config} owner={owner} token={token} />;
}

function ConnectScreen({ config, owner, problem }: Readonly<{ config: ReadyMailConfig; owner: string; problem: MailResult | null }>) {
  const [busy, setBusy] = useState(false);
  const text = problem ? PROBLEM_TEXT[problem.problem] : null;
  const start = () => {
    setBusy(true);
    connect(config, { owner, returnTo: window.location.pathname + window.location.search });
  };
  return (
    <div className="ml">
      <PageHeader title="LASU mail" subtitle="Your LASU student email, right here." />
      {text ? (
        <div className={`ml-notice${problem?.problem === 'not_allowed_by_lasu' ? ' is-info' : ''}`} role="alert">
          <strong>{text.title}</strong>
          <span>{text.body}</span>
        </div>
      ) : null}
      <section className="ml-connect ds-card" aria-labelledby="ml-connect-title">
        <span className="ml-connect-art" aria-hidden="true"><Mail size={30} strokeWidth={1.9} /></span>
        <h2 className="ml-connect-title" id="ml-connect-title">Read your LASU email without leaving LASUATOS</h2>
        <p className="ml-connect-lede">
          Lecturers, your department and the university write to your LASU address. Connect it once and check it here, next to your attendance.
        </p>
        <ul className="ml-points">
          <li>
            <span className="ml-point-icon" aria-hidden="true"><EyeOff size={18} /></span>
            <span><strong>Read only.</strong> LASUATOS can’t send, delete or change anything in your mailbox.</span>
          </li>
          <li>
            <span className="ml-point-icon" aria-hidden="true"><LockKeyhole size={18} /></span>
            <span><strong>Private.</strong> Your emails go straight from Google to this device. LASUATOS never receives or stores them.</span>
          </li>
          <li>
            <span className="ml-point-icon" aria-hidden="true"><Unplug size={18} /></span>
            <span><strong>Yours to stop.</strong> Disconnect any time here, or in your Google account.</span>
          </li>
        </ul>
        <Button size="lg" block busy={busy} onClick={start} icon={<GoogleMark />}>
          {problem ? 'Connect again' : 'Connect LASU mail'}
        </Button>
        <p className="ml-connect-foot">
          {config.mailbox
            ? <>Google will ask <strong>{config.mailbox}</strong> to allow “View your email messages and settings”.</>
            : <>On Google’s page, choose your LASU account (it ends in @{config.hostedDomain}) and allow “View your email messages and settings”.</>}
        </p>
      </section>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg className="ml-google" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

type ListState = {
  readonly query: string;
  readonly messages: readonly MailSummary[];
  readonly next: string | null;
  readonly status: 'loading' | 'ready' | 'more' | 'error';
  readonly error: string | null;
};

const EMPTY_LIST: ListState = { query: '', messages: [], next: null, status: 'loading', error: null };

/** Keeps newly arrived emails on top without losing the pages already loaded below. */
function merge(fresh: readonly MailSummary[], loaded: readonly MailSummary[]): MailSummary[] {
  const ids = new Set(fresh.map((message) => message.id));
  return [...fresh, ...loaded.filter((message) => !ids.has(message.id))];
}

function useSearchDebounce(value: string, ms = 450): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value.trim()), value.trim() ? ms : 0);
    return () => window.clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

function Mailbox({ config, owner, token }: Readonly<{ config: ReadyMailConfig; owner: string; token: MailToken }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const openId = params.get('m');
  const now = useClock('fifteen');
  const [mailbox, setMailbox] = useState<string | null>(null);
  const [unread, setUnread] = useState<number | null>(null);
  const [folder, setFolder] = useState<Folder>('inbox');
  const [search, setSearch] = useState('');
  const query = useSearchDebounce(search);
  const effectiveQuery = query || FOLDER_QUERY[folder];
  const [list, setList] = useState<ListState>(EMPTY_LIST);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef(list);
  useEffect(() => { listRef.current = list; }, [list]);

  const failed = useCallback((error: unknown): string | null => {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    if (error instanceof GmailError && error.expired) {
      dropToken();
      return null;
    }
    return error instanceof GmailError ? error.message : 'Something went wrong reading your mail. Try again.';
  }, []);

  // Which mailbox Google gave us: it must be a LASU one.
  useEffect(() => {
    const controller = new AbortController();
    void loadProfile(token.accessToken, controller.signal).then((profile) => {
      const address = profile.emailAddress.toLowerCase();
      if (!inDomains(address, config.domains)) {
        reportMailProblem('not_lasu_mailbox');
        void disconnect();
        return;
      }
      rememberMailbox(owner, address);
      setMailbox(address);
    }).catch((error: unknown) => { failed(error); });
    return () => controller.abort();
  }, [token.accessToken, config.domains, owner, failed]);

  const loadCounts = useCallback((signal?: AbortSignal) => {
    void loadInboxCounts(token.accessToken, signal).then((counts) => setUnread(counts.messagesUnread)).catch((error: unknown) => { failed(error); });
  }, [token.accessToken, failed]);

  // The list for the folder or search.
  useEffect(() => {
    if (!mailbox) return undefined;
    const controller = new AbortController();
    window.setTimeout(() => setList((current) => ({ ...EMPTY_LIST, messages: current.query === effectiveQuery ? current.messages : [], query: effectiveQuery })), 0);
    void loadPage(token.accessToken, effectiveQuery, null, controller.signal).then((page) => {
      setList({ query: effectiveQuery, messages: page.messages, next: page.nextPageToken, status: 'ready', error: null });
    }).catch((error: unknown) => {
      const message = failed(error);
      if (message) setList((current) => ({ ...current, status: 'error', error: message }));
    });
    loadCounts(controller.signal);
    return () => controller.abort();
  }, [mailbox, effectiveQuery, token.accessToken, failed, loadCounts]);

  const refresh = useCallback(() => {
    const current = listRef.current;
    if (!mailbox || current.status === 'loading') return;
    void loadPage(token.accessToken, current.query, null).then((page) => {
      setList((latest) => (latest.query === current.query
        ? { ...latest, messages: merge(page.messages, latest.messages), next: latest.next ?? page.nextPageToken, status: 'ready', error: null }
        : latest));
    }).catch((error: unknown) => {
      const message = failed(error);
      if (message) setList((latest) => ({ ...latest, error: message }));
    });
    loadCounts();
  }, [mailbox, token.accessToken, failed, loadCounts]);

  // New mail arrives on its own while the page is open (and on coming back to the tab).
  useEffect(() => {
    if (!mailbox) return undefined;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [mailbox, refresh]);

  const loadMore = () => {
    const current = listRef.current;
    if (!current.next || current.status !== 'ready') return;
    setList({ ...current, status: 'more' });
    void loadPage(token.accessToken, current.query, current.next).then((page) => {
      setList((latest) => (latest.query === current.query
        ? { ...latest, messages: merge(latest.messages, page.messages), next: page.nextPageToken, status: 'ready' }
        : latest));
    }).catch((error: unknown) => {
      const message = failed(error);
      setList((latest) => ({ ...latest, status: 'ready', error: message }));
    });
  };

  // Opening an email adds a history entry, so Back (and the phone's back gesture) returns to the list.
  const pushed = useRef(false);
  const open = (id: string) => {
    setOpened((current) => new Set(current).add(id));
    const href = `${pathname}?m=${encodeURIComponent(id)}`;
    if (openId && pushed.current) router.replace(href, { scroll: false });
    else router.push(href, { scroll: false });
    pushed.current = true;
  };
  const close = () => {
    if (pushed.current) router.back();
    else router.replace(pathname, { scroll: false });
    pushed.current = false;
  };

  const leave = async () => {
    forgetSummaries();
    await disconnect();
    router.replace(pathname);
  };

  const segments = useMemo(() => FOLDERS.map((value) => ({
    value,
    label: value === 'unread' && unread ? <>{FOLDER_LABEL[value]} <span className="ml-count">{unread > 99 ? '99+' : unread}</span></> : FOLDER_LABEL[value],
  })), [unread]);

  const subtitle = mailbox ?? config.mailbox ?? undefined;
  const header = (
    <PageHeader
      title="LASU mail"
      subtitle={subtitle}
      actions={(
        <div className="ml-head-actions">
          <GuideButton page="/mail" label="LASU mail" />
          <Button variant="gray" size="sm" onClick={refresh} icon={<RefreshCw size={16} />}><span className="ml-refresh-label">Refresh</span></Button>
          <Menu
            label="Mail actions"
            items={[
              { label: 'Open in Gmail', icon: <ExternalLink size={17} />, onSelect: () => window.open(gmailLink(mailbox), '_blank', 'noopener,noreferrer') },
              { label: 'Disconnect LASU mail', icon: <LogOut size={17} />, destructive: true, onSelect: () => { void leave(); } },
            ]}
          />
        </div>
      )}
    />
  );

  const searching = Boolean(query);
  const empty = searching ? { title: 'No emails match', body: `Nothing in your LASU mail matches “${query}”. Gmail searches words, names and addresses (try from:, subject: or has:attachment).` } : EMPTY_TEXT[folder];

  return (
    <div className={`ml ml-box${openId ? ' is-reading' : ''}`}>
      {header}
      <div className="ml-split">
        <section className="ml-list-pane" aria-label="Emails">
          <div className="ml-tools">
            <SearchField value={search} onValueChange={setSearch} placeholder="Search your LASU mail" aria-label="Search your LASU mail" />
            {!searching ? <SegmentedControl segments={segments} value={folder} onChange={setFolder} label="Folders" block /> : null}
          </div>
          {list.error && list.messages.length ? <p className="ml-inline-error" role="alert">{list.error}</p> : null}
          {list.status === 'loading' && !list.messages.length ? <ListSkeleton /> : list.status === 'error' && !list.messages.length ? (
            <div className="ds-card">
              <EmptyState error title="Your mail didn’t load" message={list.error} action={<Button variant="tinted" onClick={refresh}>Try again</Button>} />
            </div>
          ) : !list.messages.length ? (
            <div className="ds-card">
              <EmptyState icon={searching ? <Search size={26} strokeWidth={1.9} /> : <Inbox size={26} strokeWidth={1.9} />} title={empty.title} message={empty.body} />
            </div>
          ) : (
            <>
              <ul className="ml-list" aria-label={searching ? `Results for ${query}` : FOLDER_LABEL[folder]} aria-busy={list.status === 'loading'}>
                {list.messages.map((message) => (
                  <MessageRow key={message.id} message={message} now={now} active={message.id === openId} unread={message.unread && !opened.has(message.id)} onOpen={open} />
                ))}
              </ul>
              {list.next ? (
                <div className="ml-more">
                  <Button variant="gray" busy={list.status === 'more'} onClick={loadMore}>Show older emails</Button>
                </div>
              ) : null}
            </>
          )}
          <p className="ml-privacy"><ShieldCheck size={15} aria-hidden="true" /> Read only. Your mail goes straight from Google to this device.</p>
        </section>
        <section className="ml-read-pane" aria-label="Email">
          {openId ? (
            <MailReader key={openId} id={openId} token={token.accessToken} mailbox={mailbox} onClose={close} onError={failed} />
          ) : (
            <div className="ml-read-empty">
              <Mail size={30} strokeWidth={1.7} aria-hidden="true" />
              <p>Choose an email to read it.</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function MessageRow({ message, now, active, unread, onOpen }: Readonly<{ message: MailSummary; now: number; active: boolean; unread: boolean; onOpen: (id: string) => void }>) {
  return (
    <li className={`ml-row${unread ? ' is-unread' : ''}${active ? ' is-active' : ''}`}>
      <button type="button" className="ml-row-button" onClick={() => onOpen(message.id)} aria-current={active ? 'true' : undefined}>
        {/* Neutral for everyone: anyone can put a LASU address in From, so only an open email (with Google's check) is marked as LASU's. */}
        <span className="ml-avatar" aria-hidden="true">{initials(message.from.name)}</span>
        <span className="ml-row-body">
          <span className="ml-row-top">
            <span className="ml-from">{unread ? <span className="sr-only">Unread. </span> : null}{message.from.name}</span>
            <span className="ml-date">{listDate(message.date, now)}</span>
          </span>
          <span className="ml-subject">
            {message.subject}
            {message.starred ? <Star className="ml-star" size={14} aria-label="Starred" /> : null}
          </span>
          <span className="ml-snippet">{message.snippet}</span>
          {message.category !== 'primary' && message.category !== 'updates' ? <span className="ml-row-tags"><Badge>{message.category === 'promotions' ? 'Promotions' : message.category === 'social' ? 'Social' : 'Forums'}</Badge></span> : null}
        </span>
      </button>
    </li>
  );
}

function ListSkeleton({ label = 'Loading your mail' }: Readonly<{ label?: string }>): ReactNode {
  return (
    <ul className="ml-list ml-skeleton" role="status" aria-label={label}>
      {Array.from({ length: 6 }, (_, index) => (
        <li key={index} className="ml-row">
          <span className="ml-row-button">
            <span className="ml-avatar ds-skeleton" />
            <span className="ml-row-body">
              <span className="ds-skeleton" style={{ width: '42%' }} />
              <span className="ds-skeleton" style={{ width: `${86 - index * 6}%` }} />
              <span className="ds-skeleton" style={{ width: `${70 - index * 4}%` }} />
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
