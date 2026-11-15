'use client';

import type { LectureCapabilities, LectureSessionList, LectureSessionSummary } from '@lasuatos/contracts';
import { ChevronRight, Plus, QrCode, ScanFace } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { failureText, formatClock, loadFaceReviews, loadLectureSessions } from '../../lib/lecture-api';
import { useResource } from '../../lib/resource';
import { Button, EmptyState, PageHeader, SegmentedControl } from '../ds';
import { SearchField } from '../ui/search-field';
import { AccessMessage, useTakerAccess } from './access';
import { dayHeading, lagosDay, numberFormat, plural, remainingLabel, timeRange } from './format';
import { GuideButton } from './guide-button';
import { useClock, useToday } from './hooks';
import { NewSessionSheet } from './new-session';
import './take.css';

export const sessionsKey = (query: string) => `take:sessions:${query}`;
const takenBy = (session: LectureSessionSummary) => session.lecturerName || session.creatorName;

const loadPendingFaces = (signal: AbortSignal) => loadFaceReviews({ status: 'pending' }, signal).then((result) => result.pendingCount);

/** /sessions: what is live, starting a session, and every session taken before. */
export function TakeAttendanceHome() {
  const { access, retry } = useTakerAccess();
  if (access.kind === 'ready') return <Home capabilities={access.capabilities} />;
  if (access.kind === 'loading') return <HomeSkeleton />;
  return <div className="tk-page"><AccessMessage access={access} retry={retry} /></div>;
}

function HomeSkeleton() {
  return (
    <div className="tk-page" aria-busy="true">
      <PageHeader title="Take attendance" />
      <RowBones rows={5} label="Loading sessions" />
    </div>
  );
}

function Home({ capabilities }: Readonly<{ capabilities: LectureCapabilities }>) {
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [older, setOlder] = useState<{ query: string; sessions: LectureSessionSummary[]; hasMore: boolean } | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState('');
  const canReview = capabilities.role === 'lecturer' || capabilities.role === 'administrator';

  // /sessions?new=1 (from the Overview) opens straight onto a new session.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (new URLSearchParams(window.location.search).has('new')) setCreating(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  // Search on the server (it covers every session, not just the ones loaded), once typing stops.
  useEffect(() => {
    const timer = window.setTimeout(() => setSearched(query.trim()), query.trim() ? 300 : 0);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loader = useMemo(() => (signal: AbortSignal) => loadLectureSessions(signal, { q: searched }), [searched]);
  const list = useResource<LectureSessionList>(sessionsKey(searched), loader, { poll: 20_000 });
  const faces = useResource(canReview ? 'take:face-pending' : null, loadPendingFaces, { maxAge: 60_000 });

  const extra = older?.query === searched ? older : null;
  const sessions = useMemo(() => {
    const first = list.data?.sessions ?? [];
    const more = (extra?.sessions ?? []).filter((item) => !first.some((existing) => existing.id === item.id));
    return [...first, ...more];
  }, [list.data, extra]);
  const hasMore = extra ? extra.hasMore : list.data?.hasMore ?? false;
  const othersCount = sessions.filter((session) => !session.canManage).length;
  const shown = mineOnly ? sessions.filter((session) => session.canManage) : sessions;
  const live = shown.filter((session) => session.status === 'open');
  const past = shown.filter((session) => session.status !== 'open');
  const searching = query.trim() !== searched || (list.loading && Boolean(searched));
  const showSearch = sessions.length > 5 || hasMore || Boolean(query);

  function closeSheet() {
    setCreating(false);
    if (new URLSearchParams(window.location.search).has('new')) window.history.replaceState(null, '', '/sessions');
  }

  async function loadOlder() {
    const last = sessions.at(-1);
    if (!last) return;
    setLoadingOlder(true);
    setOlderError('');
    try {
      const result = await loadLectureSessions(undefined, { before: last.startsAt, q: searched });
      setOlder({ query: searched, sessions: [...(extra?.sessions ?? []), ...result.sessions], hasMore: result.hasMore });
    } catch (caught) {
      setOlderError(failureText(caught));
    } finally {
      setLoadingOlder(false);
    }
  }

  const firstRun = list.data !== undefined && sessions.length === 0 && !searched;

  return (
    <div className="tk-page">
      <PageHeader
        title="Take attendance"
        eyebrow={capabilities.roleLabel ?? undefined}
        actions={(
          <div className="tk-head-actions">
            <GuideButton />
            <Button className="tk-new-wide" icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />} onClick={() => setCreating(true)}>
              New session
            </Button>
            <button className="ds-icon-btn is-filled tk-new-compact" type="button" aria-label="New session" onClick={() => setCreating(true)}>
              <Plus size={20} strokeWidth={2.4} aria-hidden="true" />
            </button>
          </div>
        )}
      />

      {live.some((session) => session.canManage) ? (
        <section className="tk-live" aria-label="Taking attendance now">
          {live.filter((session) => session.canManage).map((session) => <LiveCard key={session.id} session={session} />)}
        </section>
      ) : null}

      {faces.data ? (
        <ul className="ds-list tk-attention">
          <li>
            <Link className="ds-row" href="/face-checks">
              <span className="ds-row-leading tk-attention-icon" aria-hidden="true"><ScanFace size={18} strokeWidth={2.1} /></span>
              <span className="ds-row-body"><span className="ds-row-title">Face checks to review</span></span>
              <span className="tk-pill is-warning">{numberFormat.format(faces.data)}</span>
              <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
            </Link>
          </li>
        </ul>
      ) : null}

      {showSearch || othersCount > 0 ? (
        <div className="tk-toolbar">
          {showSearch ? (
            <SearchField
              className="tk-search"
              value={query}
              onValueChange={setQuery}
              placeholder="Search courses"
              aria-label="Search sessions by course code or title"
            />
          ) : null}
          {othersCount > 0 ? (
            <SegmentedControl
              label="Whose sessions"
              value={mineOnly ? 'mine' : 'all'}
              onChange={(value) => setMineOnly(value === 'mine')}
              segments={[{ value: 'all', label: 'Everyone' }, { value: 'mine', label: 'Mine' }]}
            />
          ) : null}
          <span className="sr-only" role="status">
            {searched && !searching ? `${plural(shown.length, 'session')} found` : ''}
          </span>
        </div>
      ) : null}

      {list.data === undefined ? (
        list.error ? (
          <div className="ds-card">
            <EmptyState error title="Sessions didn’t load" message={list.error} action={<Button variant="gray" onClick={list.reload}>Try again</Button>} />
          </div>
        ) : <RowBones rows={5} label="Loading sessions" />
      ) : firstRun ? (
        <div className="ds-card tk-first">
          <EmptyState
            icon={<QrCode size={26} strokeWidth={1.9} aria-hidden="true" />}
            title="No sessions yet"
            message="Start one when class begins. Students scan the code with their phones."
            action={<Button icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />} onClick={() => setCreating(true)}>New session</Button>}
          />
        </div>
      ) : (
        <>
          {searched && shown.length === 0 && !searching ? (
            <div className="ds-card">
              <EmptyState title={`No sessions match “${searched}”`} message="Try the course code, or part of the title." />
            </div>
          ) : null}
          {mineOnly && shown.length === 0 && !searched ? (
            <div className="ds-card"><EmptyState title="You haven’t taken any sessions yet" /></div>
          ) : null}
          {live.some((session) => !session.canManage) ? (
            <DayGroup title="Open now" sessions={live.filter((session) => !session.canManage)} />
          ) : null}
          <History sessions={past} />
          {hasMore ? (
            <div className="tk-more">
              <Button variant="gray" block busy={loadingOlder} onClick={() => void loadOlder()}>Show earlier sessions</Button>
              {olderError ? <p className="tk-error" role="alert">{olderError}</p> : null}
            </div>
          ) : null}
        </>
      )}

      <NewSessionSheet open={creating} onClose={closeSheet} capabilities={capabilities} />
    </div>
  );
}

function LiveCard({ session }: Readonly<{ session: LectureSessionSummary }>) {
  const now = useClock('fifteen');
  const left = now ? remainingLabel(session.endsAt, new Date(now)) : null;
  return (
    <Link className="tk-live-card" href={`/sessions/${session.id}`}>
      <span className="tk-live-top">
        <span className="tk-pulse" aria-hidden="true" />
        <span>Live{left ? ` · ${left}` : ''}</span>
      </span>
      <span className="tk-live-main">
        <span className="tk-live-text">
          <span className="tk-live-code">{session.courseCode}</span>
          <strong className="tk-live-title">{session.courseTitle}</strong>
          <span className="tk-live-meta">
            {session.venueName ? `${session.venueName} · ` : ''}until {formatClock(session.endsAt)}
          </span>
        </span>
        <span className="tk-live-count">
          <strong>{numberFormat.format(session.presentCount)}</strong>
          <small>present</small>
        </span>
      </span>
      <span className="tk-live-cta">
        <QrCode size={18} strokeWidth={2.1} aria-hidden="true" />
        Show QR code
        <ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" />
      </span>
    </Link>
  );
}

/** Closed sessions, a group per day. */
function History({ sessions }: Readonly<{ sessions: readonly LectureSessionSummary[] }>) {
  const today = useToday();
  const groups = useMemo(() => {
    const byDay = new Map<string, LectureSessionSummary[]>();
    for (const session of sessions) {
      const day = lagosDay(session.startsAt);
      const group = byDay.get(day);
      if (group) group.push(session);
      else byDay.set(day, [session]);
    }
    return [...byDay];
  }, [sessions]);
  return (
    <>
      {groups.map(([day, items]) => <DayGroup key={day} title={dayHeading(day, today)} sessions={items} />)}
    </>
  );
}

function DayGroup({ title, sessions }: Readonly<{ title: string; sessions: readonly LectureSessionSummary[] }>) {
  const present = sessions.reduce((sum, session) => sum + session.presentCount, 0);
  return (
    <section className="tk-day" aria-label={title}>
      <div className="tk-day-head">
        <h2 className="tk-day-title">{title}</h2>
        {sessions.length > 1 ? <span className="tk-day-aside">{plural(present, 'check-in')}</span> : null}
      </div>
      <ul className="ds-list tk-rows">
        {sessions.map((session) => <SessionRow key={session.id} session={session} />)}
      </ul>
    </section>
  );
}

function SessionRow({ session }: Readonly<{ session: LectureSessionSummary }>) {
  const live = session.status === 'open';
  const details = [timeRange(session.startsAt, session.endsAt), session.venueName, session.canManage ? null : takenBy(session)].filter(Boolean).join(' · ');
  return (
    <li>
      <Link className="ds-row tk-row" href={`/sessions/${session.id}`}>
        <span className="tk-code">{session.courseCode}</span>
        <span className="ds-row-body">
          <span className="tk-code-inline">{session.courseCode}</span>
          <span className="ds-row-title">{session.courseTitle}</span>
          <span className="ds-row-subtitle">{details}</span>
        </span>
        <span className={`tk-count${live ? ' is-live' : ''}`}>
          <strong>{numberFormat.format(session.presentCount)}</strong>
          <small>{live ? 'live' : 'present'}</small>
        </span>
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </Link>
    </li>
  );
}

export function RowBones({ rows, label }: Readonly<{ rows: number; label: string }>) {
  return (
    <ul className="ds-list tk-rows tk-bones" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <li key={index}>
          <div className="ds-row tk-row">
            <span className="ds-skeleton tk-code tk-bone-tile" />
            <span className="ds-row-body">
              <span className="ds-skeleton" style={{ width: `${70 - index * 8}%` }} />
              <span className="ds-skeleton tk-bone-small" style={{ width: `${44 - index * 4}%` }} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
