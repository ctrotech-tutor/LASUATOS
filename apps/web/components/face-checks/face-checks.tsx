'use client';

import type { FaceReviewItem, FaceReviewList } from '@lasuatos/contracts';
import { ScanFace, ShieldCheck, UserRound } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { decideFaceReview, FACE_REVIEWS_CHANGED_EVENT, failureText, faceReviewPhotoUrl, formatClock, formatShortDay, loadFaceReviews } from '../../lib/lecture-api';
import { useResource, staleResources } from '../../lib/resource';
import { Badge, Button, EmptyState, PageHeader, SegmentedControl, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { GuideButton } from '../shell/guide-button';
import { AccessMessage, useTakerAccess } from '../take-attendance/access';
import { useClock } from '../take-attendance/hooks';
import { Compare, type Decide } from './compare';
import { groupBySession, isWeak, sessionLine, STATUS_LABEL } from './format';
import './face-checks.css';

type Show = 'pending' | 'reviewed';
const loadPending = (signal: AbortSignal) => loadFaceReviews({ status: 'pending' }, signal);
const loadReviewed = (signal: AbortSignal) => loadFaceReviews({ status: 'reviewed' }, signal);

/* Wide screens (sidebar plus room for a list and a pane) review side by side, like Mail. */
const WIDE = '(min-width: 1080px)';
const subscribeWide = (listener: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
};
const wideSnapshot = () => window.matchMedia(WIDE).matches;
const wideServer = () => true;

/** Face checks: check-ins whose face matched, but not clearly, for a person to compare. */
export function FaceChecks() {
  const { access, retry } = useTakerAccess();
  if (access.kind === 'loading') return <div className="fc"><PageHeader title="Face checks" /><ListSkeleton /></div>;
  if (access.kind !== 'ready') return <div className="fc"><AccessMessage access={access} retry={retry} /></div>;
  const role = access.capabilities.role;
  if (role !== 'lecturer' && role !== 'administrator') {
    return (
      <div className="fc">
        <PageHeader title="Face checks" />
        <div className="ds-card">
          <EmptyState
            icon={<ScanFace size={26} strokeWidth={1.9} />}
            title="Lecturers review face checks"
            message="You see the flag on the session’s list; the lecturer compares the photos."
            action={<Button variant="tinted" href="/sessions">Take attendance</Button>}
          />
        </div>
      </div>
    );
  }
  return <Reviews admin={role === 'administrator'} />;
}

type Extra = { readonly items: readonly FaceReviewItem[]; readonly cursor: string | null };

function Reviews({ admin }: Readonly<{ admin: boolean }>) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const show: Show = params?.get('show') === 'reviewed' ? 'reviewed' : 'pending';
  const wide = useSyncExternalStore(subscribeWide, wideSnapshot, wideServer);
  const now = useClock('fifteen');
  const dialogs = useFeedback();

  // New close matches arrive while a class checks in: the queue refreshes every 20 s.
  const pending = useResource('face-reviews:pending', loadPending, { maxAge: 10_000, poll: 20_000 });
  const reviewed = useResource(show === 'reviewed' ? 'face-reviews:reviewed' : null, loadReviewed, { maxAge: 30_000 });
  const source: FaceReviewList | undefined = show === 'pending' ? pending.data : reviewed.data;
  const failure = show === 'pending' ? pending.error : reviewed.error;

  // Decisions show at once; a failed one comes back with a message.
  const [decided, setDecided] = useState<ReadonlyMap<string, FaceReviewItem>>(new Map());
  const [extra, setExtra] = useState<Partial<Record<Show, Extra>>>({});
  const [loadingMore, setLoadingMore] = useState(false);

  const items = useMemo(() => {
    if (!source) return [];
    const more = extra[show];
    const seen = new Set<string>();
    const all = [...source.items, ...(more?.items ?? [])].filter((item) => !seen.has(item.id) && seen.add(item.id));
    // In the order they are shown, grouped by session, so next and previous follow the screen.
    if (show === 'pending') return groupBySession(all.filter((item) => !decided.has(item.id))).flatMap((group) => group.items);
    // Decided here but not yet in the reviewed answer: show them first, as they now stand.
    const fresh = [...decided.values()].filter((item) => !seen.has(item.id));
    return [...fresh, ...all.map((item) => decided.get(item.id) ?? item)];
  }, [source, extra, show, decided]);
  const nextCursor = extra[show] ? extra[show].cursor : source?.nextCursor ?? null;
  const pendingCount = Math.max(0, (pending.data?.pendingCount ?? 0) - [...decided.keys()].filter((id) => pending.data?.items.some((item) => item.id === id)).length);

  // The selection: chosen, or a session and matric from the session page, or the first.
  const [chosen, setChosen] = useState<string | null>(null);
  const linked = useMemo(() => {
    const session = params?.get('session');
    const matric = params?.get('matric');
    if (!session) return null;
    return items.find((item) => item.sessionId === session && (!matric || item.matricNumber === matric))?.id ?? null;
  }, [items, params]);
  const selectedId = (chosen && items.some((item) => item.id === chosen) ? chosen : null) ?? linked ?? (wide ? items[0]?.id ?? null : null);
  const index = items.findIndex((item) => item.id === selectedId);
  const selected = index >= 0 ? items[index]! : null;
  const [sheetOpen, setSheetOpen] = useState(false);
  const linkedOpened = useRef(false);
  useEffect(() => {
    if (wide || !linked || linkedOpened.current) return;
    linkedOpened.current = true;
    const timer = window.setTimeout(() => setSheetOpen(true));
    return () => window.clearTimeout(timer);
  }, [wide, linked]);

  // The next photos load while this one is looked at.
  useEffect(() => {
    const next = items[index + 1];
    if (!next) return;
    for (const kind of ['check', 'registered'] as const) {
      if (kind === 'check' ? next.hasCheckPhoto : next.hasRegisteredPhoto) new Image().src = faceReviewPhotoUrl(next.id, kind);
    }
  }, [items, index]);

  const listRef = useRef<HTMLDivElement>(null);
  const select = useCallback((id: string) => {
    setChosen(id);
    if (!wide) setSheetOpen(true);
  }, [wide]);
  const move = useCallback((step: 1 | -1) => {
    const next = items[index + step];
    if (!next) return;
    setChosen(next.id);
    listRef.current?.querySelector(`[data-id="${next.id}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [items, index]);

  const decide: Decide = useCallback((item, decision, note) => {
    // Move on first: the next check is on screen before the answer comes back.
    const after = items[index + 1] ?? items[index - 1] ?? null;
    const optimistic: FaceReviewItem = { ...item, status: decision === 'approve' ? 'approved' : 'rejected', reviewNote: note ?? null, reviewedAt: new Date().toISOString(), reviewedByName: 'You' };
    setDecided((current) => new Map(current).set(item.id, optimistic));
    setChosen(after?.id ?? null);
    if (!after) setSheetOpen(false);
    void decideFaceReview(item.id, { decision, ...(note ? { note } : {}) })
      .then((updated) => {
        setDecided((current) => new Map(current).set(item.id, updated));
        dialogs.toast(decision === 'approve' ? `${item.studentName}: same person.` : `${item.studentName} was removed from ${item.courseCode}.`);
        if (!after) dialogs.toast('All face checks reviewed.');
      })
      .catch((caught: unknown) => {
        setDecided((current) => {
          const next = new Map(current);
          next.delete(item.id);
          return next;
        });
        dialogs.toast(failureText(caught), 'error');
        pending.reload();
      })
      .finally(() => {
        staleResources('face-reviews:reviewed');
        window.dispatchEvent(new Event(FACE_REVIEWS_CHANGED_EVENT));
      });
  }, [items, index, dialogs, pending]);

  function switchTo(next: Show) {
    setChosen(null);
    const query = new URLSearchParams(params?.toString());
    if (next === 'reviewed') query.set('show', 'reviewed');
    else query.delete('show');
    query.delete('session');
    query.delete('matric');
    const rest = query.toString();
    router.replace(rest ? `${pathname}?${rest}` : pathname, { scroll: false });
  }

  async function loadMore() {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await loadFaceReviews({ status: show, cursor: nextCursor });
      setExtra((current) => ({ ...current, [show]: { items: [...(current[show]?.items ?? []), ...page.items], cursor: page.nextCursor } }));
    } catch (caught) {
      dialogs.toast(failureText(caught), 'error');
    } finally {
      setLoadingMore(false);
    }
  }

  const header = (
    <PageHeader title="Face checks" actions={<GuideButton page="/face-checks" label="Face checks" />} />
  );
  const control = (
    <div className="fc-toolbar">
      <SegmentedControl
        label="Show"
        value={show}
        onChange={switchTo}
        segments={[
          { value: 'pending', label: pending.data ? `To review ${pendingCount}` : 'To review' },
          { value: 'reviewed', label: 'Reviewed' },
        ]}
      />
    </div>
  );

  if (!source) {
    return (
      <div className="fc">
        {header}
        {control}
        {failure ? (
          <div className="ds-card">
            <EmptyState error title="Face checks did not load" message={failure} action={<Button variant="tinted" onClick={show === 'pending' ? pending.reload : reviewed.reload}>Try again</Button>} />
          </div>
        ) : <ListSkeleton />}
      </div>
    );
  }

  if (items.length === 0 && !nextCursor) {
    return (
      <div className="fc">
        {header}
        {control}
        <div className="ds-card">
          {show === 'pending' ? (
            <EmptyState icon={<ShieldCheck size={26} strokeWidth={1.9} />} title="All clear" message="Close face matches from your sessions appear here." />
          ) : (
            <EmptyState icon={<ScanFace size={26} strokeWidth={1.9} />} title="Nothing reviewed yet" message="Checks you decide on are kept here." />
          )}
        </div>
      </div>
    );
  }

  const position = selected ? { index, total: items.length } : null;
  const groups = groupBySession(items);

  return (
    <div className={`fc${wide ? ' is-split' : ''}`}>
      {header}
      {control}
      <div className="fc-layout">
        <div className="fc-list" ref={listRef}>
          {show === 'pending' ? groups.map((group) => {
            const first = group.items[0]!;
            return (
              <section className="ds-section" key={`${group.sessionId}-${first.id}`} aria-label={sessionLine(first, now)}>
                <div className="ds-section-head">
                  <h2 className="ds-section-title fc-group-title">{sessionLine(first, now)}</h2>
                  {admin ? <span className="ds-section-aside">{first.takenBy}</span> : null}
                </div>
                <ul className="ds-list">
                  {group.items.map((item) => <Row key={item.id} item={item} selected={wide && item.id === selectedId} onSelect={select} trailing={<MatchBadge score={item.score} />} subtitle={<><span className="ds-mono">{item.matricNumber}</span> · {formatClock(item.checkedInAt)}</>} />)}
                </ul>
              </section>
            );
          }) : (
            <ul className="ds-list">
              {items.map((item) => (
                <Row
                  key={item.id}
                  item={item}
                  selected={wide && item.id === selectedId}
                  onSelect={select}
                  subtitle={`${item.courseCode} · ${formatShortDay(item.sessionStartsAt)}`}
                  trailing={<Badge tone={item.status === 'approved' ? 'success' : item.status === 'rejected' ? 'danger' : 'neutral'}>{STATUS_LABEL[item.status]}</Badge>}
                />
              ))}
            </ul>
          )}
          {nextCursor ? (
            <div className="fc-more">
              <Button variant="gray" busy={loadingMore} onClick={() => void loadMore()}>Show more</Button>
            </div>
          ) : null}
        </div>

        {wide ? (
          <div className="fc-pane">
            {selected ? (
              <Compare item={selected} now={now} position={position} onMove={move} onDecide={decide} keys variant="pane" />
            ) : (
              <div className="fc-pane-empty"><ScanFace size={30} strokeWidth={1.6} aria-hidden="true" /><span>Choose a check to compare</span></div>
            )}
          </div>
        ) : (
          <Sheet open={sheetOpen && selected !== null} onClose={() => setSheetOpen(false)} title={selected?.studentName ?? ''}>
            {selected ? <Compare item={selected} now={now} position={position} onMove={move} onDecide={decide} keys={sheetOpen} variant="sheet" /> : null}
          </Sheet>
        )}
      </div>
    </div>
  );
}

function MatchBadge({ score }: Readonly<{ score: number }>) {
  return isWeak(score) ? <Badge tone="warning">Weak</Badge> : null;
}

function Row({ item, selected, onSelect, subtitle, trailing }: Readonly<{
  item: FaceReviewItem;
  selected: boolean;
  onSelect: (id: string) => void;
  subtitle: React.ReactNode;
  trailing: React.ReactNode;
}>) {
  return (
    <li>
      <button className="ds-row fc-row" type="button" data-id={item.id} aria-current={selected ? 'true' : undefined} onClick={() => onSelect(item.id)}>
        <span className="fc-thumb" aria-hidden="true">
          {item.hasCheckPhoto ? (
            <img src={faceReviewPhotoUrl(item.id, 'check')} alt="" width={40} height={50} loading="lazy" decoding="async" />
          ) : <UserRound size={20} strokeWidth={1.8} />}
        </span>
        <span className="ds-row-body">
          <span className="ds-row-title">{item.studentName}</span>
          <span className="ds-row-subtitle">{subtitle}</span>
        </span>
        {trailing}
      </button>
    </li>
  );
}

function ListSkeleton() {
  return (
    <div className="ds-section" role="status" aria-label="Loading face checks">
      <div className="ds-section-head"><span className="ds-skeleton" style={{ width: 160, height: 18 }} /></div>
      <ul className="ds-list" aria-hidden="true">
        {[58, 44, 52].map((width) => (
          <li key={width}>
            <div className="ds-row">
              <span className="ds-skeleton fc-thumb" />
              <span className="ds-row-body">
                <span className="ds-skeleton" style={{ width: `${width}%`, height: 15 }} />
                <span className="ds-skeleton" style={{ width: '30%', height: 12 }} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
