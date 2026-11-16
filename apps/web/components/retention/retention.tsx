'use client';

import type { RetentionPreview, RetentionSet, RetentionSetDetail } from '@lasuatos/contracts';
import { CalendarClock, CheckCircle2, ChevronRight, History, Link2, MoonStar, RefreshCw, ScanFace, SearchX, ShieldCheck, Trash2, TriangleAlert, UserRound } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { lookupAdministrator } from '../../lib/current-account';
import { failureText } from '../../lib/lecture-api';
import { staleResources, useResource } from '../../lib/resource';
import { loadRetention, loadRetentionSet, runRetention } from '../../lib/student-api';
import { Button, EmptyState, Menu, PageHeader, Sheet, Stat, Stats } from '../ds';
import { useFeedback } from '../feedback';
import { GuideButton } from '../shell/guide-button';
import { useClock } from '../take-attendance/hooks';
import { SearchField } from '../ui/search-field';
import { useWide } from '../venues/hooks';
import {
  ago, copyText, countByStatus, dayOf, findSet, foldRuns, formatClock, formatDay, formatStamp, groupSets, nextRun, PATH, plural, PREVIEW_KEY, readView,
  relativeDay, runResult, runSpan, SET_PREFIX, setKey, setSlug, setStatus, setTitle, SHOW_LABEL, SHOWS, STATUS_LABEL, viewHref, type Show, type View,
} from './format';
import { SetDetailView } from './set-detail';
import './retention.css';

type Answer = { readonly kind: 'ok' } | { readonly kind: 'denied'; readonly message: string };

const WHO_KEY = 'admin:retention-who';

async function loadWho(): Promise<Answer> {
  const session = await lookupAdministrator('manage data retention');
  return session.kind === 'error' ? { kind: 'denied', message: session.message } : { kind: 'ok' };
}

const loadPreview = (signal: AbortSignal) => loadRetention(signal);

type SetLoader = (signal: AbortSignal) => Promise<RetentionSetDetail>;
const setLoaders = new Map<string, SetLoader>();

/** One stable loader per set (useResource needs a stable loader). */
function setLoader(departmentId: string, entryYear: number): SetLoader {
  const key = `${departmentId}:${entryYear}`;
  let loader = setLoaders.get(key);
  if (!loader) {
    if (setLoaders.size > 40) setLoaders.clear();
    loader = (signal) => loadRetentionSet(departmentId, entryYear, signal);
    setLoaders.set(key, loader);
  }
  return loader;
}

/**
 * Data retention: registered faces are deleted a grace period after a set finishes its
 * programme (unless the student still checks in), and check-in photos after a few months.
 * The page shows what is due now and when the nightly clean-up takes it, what is stored,
 * every set in the window grouped by where it stands, and the recent runs. A set opens beside
 * the list on wide screens and in a sheet on phones, student by student.
 */
export function Retention() {
  const who = useResource(WHO_KEY, loadWho, { maxAge: 60_000 });
  const answer = who.data;
  if (answer?.kind === 'denied') {
    return (
      <div className="rt">
        <PageHeader title="Data retention" />
        <div className="ds-card">
          <EmptyState icon={<ShieldCheck size={26} strokeWidth={1.9} />} title="Data retention is for administrators" message={answer.message} action={<Button href="/" variant="tinted">Go home</Button>} />
        </div>
      </div>
    );
  }
  if (!answer) {
    return (
      <div className="rt">
        <PageHeader title="Data retention" />
        {who.error ? (
          <div className="ds-card">
            <EmptyState error title="Data retention did not load" message={who.error} action={<Button variant="tinted" onClick={who.reload}>Try again</Button>} />
          </div>
        ) : <PageSkeleton />}
      </div>
    );
  }
  return <Workspace />;
}

function Workspace() {
  const router = useRouter();
  const pathname = usePathname() ?? PATH;
  const params = useSearchParams();
  const view = readView(params);
  const wide = useWide();
  const now = useClock('fifteen');
  const feedback = useFeedback();
  const preview = useResource(PREVIEW_KEY, loadPreview, { maxAge: 30_000, poll: 180_000 });
  const data = preview.data;

  // The search box answers at once; the address follows after a pause.
  const [query, setQuery] = useState(view.q);
  const [lastQ, setLastQ] = useState(view.q);
  if (view.q !== lastQ) {
    setLastQ(view.q);
    setQuery(view.q);
  }

  const go = useCallback((next: Partial<View>) => {
    router.replace(viewHref(pathname, { ...view, ...next }), { scroll: false });
  }, [router, pathname, view]);
  const open = useCallback((slug: string | null) => go({ set: slug }), [go]);

  useEffect(() => {
    if (query.trim() === view.q.trim()) return undefined;
    const timer = window.setTimeout(() => go({ q: query }), 300);
    return () => window.clearTimeout(timer);
  }, [query, view.q, go]);

  const selected = data ? findSet(data.sets, view.set) : null;
  const loadDetail = setLoader(selected?.departmentId ?? '', selected?.entryYear ?? 0);
  const detail = useResource(selected ? setKey(selected.departmentId, selected.entryYear) : null, loadDetail, { maxAge: 60_000 });

  // Escape closes the open set on wide screens (phones have the sheet).
  const keys = useRef({ close: () => open(null), active: false });
  useEffect(() => {
    keys.current = { close: () => open(null), active: wide && view.set !== null };
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !keys.current.active || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [role="listbox"]')) return;
      event.preventDefault();
      keys.current.close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [running, setRunning] = useState(false);
  const reloadAll = () => {
    staleResources(PREVIEW_KEY);
    staleResources(SET_PREFIX);
    preview.reload();
    detail.reload();
  };

  async function run(current: RetentionPreview) {
    const { faces, checkPhotos } = current.due;
    const today = dayOf(current.generatedAt);
    const dueSets = current.sets.filter((set) => setStatus(set, today) === 'due');
    const confirmed = await feedback.confirm({
      title: 'Delete what is due now?',
      body: (
        <>
          {faces || checkPhotos ? (
            <>
              {[faces ? plural(faces, 'registered face') : '', checkPhotos ? plural(checkPhotos, 'check-in photo') : ''].filter(Boolean).join(' and ')} will be deleted for good
              {dueSets.length ? <> (from {dueSets.slice(0, 3).map(setTitle).join(', ')}{dueSets.length > 3 ? ` and ${dueSets.length - 3} more` : ''})</> : null}.
            </>
          ) : 'Nothing is due, so nothing will be deleted.'}{' '}
          Accounts, class lists and attendance records stay. Students who come back can register their face again.
        </>
      ),
      confirmLabel: 'Delete now',
      tone: 'danger',
    });
    if (!confirmed) return;
    setRunning(true);
    try {
      const result = await runRetention();
      feedback.toast(result.facesDeleted || result.checkPhotosDeleted ? `${runResult(result)}.` : 'Nothing was due, so nothing was deleted.');
      reloadAll();
    } catch (caught) {
      feedback.toast(failureText(caught, 'The clean-up did not run. Try again.'), 'error');
    } finally {
      setRunning(false);
    }
  }

  const copyLink = () => {
    void copyText(window.location.href).then((done) => feedback.toast(done ? 'Link copied' : 'The link could not be copied.', done ? undefined : 'error'));
  };

  if (!data) {
    return (
      <div className="rt">
        <Header />
        {preview.error ? (
          <div className="ds-card">
            <EmptyState error title="Data retention did not load" message={preview.error} action={<Button variant="tinted" onClick={preview.reload}>Try again</Button>} />
          </div>
        ) : <PageSkeleton />}
      </div>
    );
  }

  const today = dayOf(data.generatedAt);
  const counts = countByStatus(data.sets, today);
  const groups = groupSets(data.sets, today, { show: view.show, q: view.q });
  const shown = groups.reduce((total, group) => total + group.sets.length, 0);
  const filtered = view.show !== 'all' || view.q.trim() !== '';
  const clear = () => { setQuery(''); go({ show: 'all', q: '' }); };
  const canDelete = data.due.faces + data.due.checkPhotos > 0;
  const onRun = data.canRun ? () => void run(data) : null;

  const renderDetail = (set: RetentionSet, inSheet: boolean) => (
    <SetDetailView
      key={setSlug(set)}
      set={set}
      detail={detail.data && setSlug(detail.data.set) === setSlug(set) ? detail.data : null}
      error={detail.error ?? null}
      onRetry={detail.reload}
      policy={data.policy}
      today={today}
      now={now}
      scheduled={data.scheduled}
      inSheet={inSheet}
      onClose={inSheet ? undefined : () => open(null)}
      onCopyLink={copyLink}
    />
  );

  const missing = view.set && !selected ? (
    <EmptyState
      icon={<SearchX size={26} strokeWidth={1.9} />}
      title="That set isn’t here"
      message={`Sets show here from their last year until their face data is cleared${data.limitedToScope ? ', and only those in your area' : ''}.`}
      action={<Button variant="tinted" onClick={() => open(null)}>Back to all sets</Button>}
    />
  ) : null;

  const side = (
    <>
      <RunHistory preview={data} now={now} />
      <Rules preview={data} />
    </>
  );

  return (
    <div className="rt">
      <Header
        subtitle={data.scopeLabel}
        limited={data.limitedToScope}
        onRun={onRun && canDelete ? onRun : null}
        onRefresh={reloadAll}
        onCopyLink={copyLink}
      />

      <CleanUp preview={data} now={now} running={running} onRun={onRun} onOpen={open} />

      <RetentionStats preview={data} today={today} onShow={(show) => go({ show, set: null })} />

      <div className={`rt-split${wide ? ' is-wide' : ''}`}>
        <section className="rt-list-col" aria-labelledby="rt-sets-title">
          <div className="rt-list-head">
            <h2 className="rt-list-title" id="rt-sets-title">Sets</h2>
            {data.sets.length > 5 ? (
              <SearchField className="rt-find" value={query} onValueChange={setQuery} placeholder="Department or year" aria-label="Search sets" />
            ) : null}
          </div>
          {data.sets.length ? (
            <div className="rt-chips" role="group" aria-label="Show">
              {SHOWS.filter((show) => show === 'all' || counts[show] > 0 || view.show === show).map((show) => (
                <button key={show} className={`rt-chip${view.show === show ? ' is-on' : ''}`} type="button" aria-pressed={view.show === show} onClick={() => go({ show })}>
                  {show !== 'all' ? <span className={`rt-dot is-${show}`} aria-hidden="true" /> : null}
                  <span>{SHOW_LABEL[show]}</span>
                  <span className="rt-chip-count">{counts[show]}</span>
                </button>
              ))}
            </div>
          ) : null}

          {shown === 0 ? (
            <div className="ds-card">
              {data.sets.length === 0 ? (
                <EmptyState
                  icon={<CalendarClock size={26} strokeWidth={1.9} />}
                  title="No set is near the end yet"
                  message={`A set shows here ${data.policy.graceMonths > 0 ? 'once it is in its last year' : 'when it finishes'}, two years before its face data is due. Sets come from class lists, so add those first.`}
                  action={<Button href="/class-list" variant="tinted">Open class lists</Button>}
                />
              ) : (
                <EmptyState
                  icon={<SearchX size={26} strokeWidth={1.9} />}
                  title={view.q.trim() ? `No set matches “${view.q.trim()}”` : `No set is ${SHOW_LABEL[view.show].toLowerCase()}`}
                  message="Search by department code or name, or by entry year."
                  action={filtered ? <Button variant="tinted" onClick={clear}>Show all sets</Button> : undefined}
                />
              )}
            </div>
          ) : (
            <div className="rt-groups">
              {groups.map((group) => (
                <section key={group.status} className="rt-group" aria-labelledby={`rt-group-${group.status}`}>
                  <h3 className="rt-group-title" id={`rt-group-${group.status}`}>
                    <span className={`rt-dot is-${group.status}`} aria-hidden="true" />
                    {STATUS_LABEL[group.status]}
                    <span className="rt-group-count" aria-hidden="true">{group.sets.length}</span>
                    <span className="sr-only">, {plural(group.sets.length, 'set')}</span>
                  </h3>
                  <ul className="ds-list rt-list">
                    {group.sets.map((set) => (
                      <SetRow key={setSlug(set)} set={set} today={today} selected={wide && selected !== null && setSlug(selected) === setSlug(set)} onOpen={() => open(setSlug(set))} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </section>

        {wide ? (
          <aside className="rt-pane" aria-label={selected ? setTitle(selected) : 'Clean-ups and rules'}>
            {selected || missing ? (
              <div className="rt-pane-card">{selected ? renderDetail(selected, false) : missing}</div>
            ) : (
              <div className="rt-pane-stack">{side}</div>
            )}
          </aside>
        ) : null}
      </div>

      {!wide ? <div className="rt-below">{side}</div> : null}

      {!wide ? (
        <PhoneSheet open={view.set !== null} selected={selected} fallback={missing} render={(set) => renderDetail(set, true)} onClose={() => open(null)} />
      ) : null}
    </div>
  );
}

function Header({ subtitle, limited = false, onRun, onRefresh, onCopyLink }: Readonly<{
  subtitle?: string;
  limited?: boolean;
  onRun?: (() => void) | null;
  onRefresh?: () => void;
  onCopyLink?: () => void;
}>) {
  return (
    <PageHeader
      title="Data retention"
      subtitle={subtitle ? (
        <span className="rt-scope">
          {limited ? null : <ShieldCheck size={15} strokeWidth={2.3} aria-hidden="true" />}
          {subtitle}
        </span>
      ) : undefined}
      actions={(
        <div className="rt-head-actions">
          <GuideButton page={PATH} label="Data retention" />
          {onRefresh ? (
            <Menu
              label="More actions"
              items={[
                onRun ? { label: 'Delete what is due now', icon: <Trash2 size={17} />, onSelect: onRun, destructive: true } : null,
                onCopyLink ? { label: 'Copy link to this view', icon: <Link2 size={17} />, onSelect: onCopyLink } : null,
                { label: 'Check again', icon: <RefreshCw size={17} />, onSelect: onRefresh },
              ]}
            />
          ) : null}
        </div>
      )}
    />
  );
}

/** What is due now, when the nightly run takes it, and the button to do it now. */
function CleanUp({ preview, now, running, onRun, onOpen }: Readonly<{
  preview: RetentionPreview;
  now: number;
  running: boolean;
  onRun: (() => void) | null;
  onOpen: (slug: string) => void;
}>) {
  const { due, lastRun } = preview;
  const today = dayOf(preview.generatedAt);
  const dueSets = preview.sets.filter((set) => setStatus(set, today) === 'due');
  const nextSet = preview.sets
    .filter((set) => set.dueOn > today && set.faces > 0)
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn))[0];
  const hasDue = due.faces + due.checkPhotos > 0;
  const next = nextRun(now || Date.parse(preview.generatedAt));
  const what = [due.faces ? plural(due.faces, 'registered face') : '', due.checkPhotos ? plural(due.checkPhotos, 'check-in photo') : ''].filter(Boolean).join(' and ');

  return (
    <section className={`rt-cleanup${hasDue ? ' is-due' : ' is-clear'}${preview.scheduled ? '' : ' is-manual'}`} aria-labelledby="rt-cleanup-title">
      <span className="rt-cleanup-icon" aria-hidden="true">
        {hasDue ? <Trash2 size={22} strokeWidth={2.1} /> : <CheckCircle2 size={22} strokeWidth={2.1} />}
      </span>
      <div className="rt-cleanup-body">
        <h2 className="rt-cleanup-title" id="rt-cleanup-title">
          {hasDue ? `${what} ${due.faces + due.checkPhotos === 1 ? 'is' : 'are'} due` : 'Nothing is due'}
        </h2>
        <p className="rt-cleanup-line">
          {hasDue
            ? preview.scheduled
              ? `The nightly clean-up deletes ${due.faces + due.checkPhotos === 1 ? 'it' : 'them'} ${next.phrase}.`
              : 'The nightly clean-up is not set up, so this stays until someone deletes it here.'
            : nextSet
              ? <>Next: <button className="rt-link" type="button" onClick={() => onOpen(setSlug(nextSet))}>{setTitle(nextSet)}</button>, {plural(nextSet.faces, 'face')} on {formatDay(nextSet.dueOn)} ({relativeDay(nextSet.dueOn, today)}).</>
              : 'Every face and photo stored is within the rules.'}
        </p>
        {hasDue && dueSets.length ? (
          <p className="rt-cleanup-sets">
            From{' '}
            {dueSets.slice(0, 4).map((set, index) => (
              <span key={setSlug(set)}>
                {index ? (index === Math.min(dueSets.length, 4) - 1 && dueSets.length <= 4 ? ' and ' : ', ') : null}
                <button className="rt-link" type="button" onClick={() => onOpen(setSlug(set))}>{setTitle(set)}</button>
              </span>
            ))}
            {dueSets.length > 4 ? ` and ${dueSets.length - 4} more` : null}
            {due.checkPhotos ? <>{dueSets.length ? ', plus' : ''} check-in photos older than {preview.policy.checkPhotoDays} days</> : null}.
          </p>
        ) : null}
        <ul className="rt-cleanup-facts">
          <li>
            {preview.scheduled ? <MoonStar size={15} strokeWidth={2.2} aria-hidden="true" /> : <TriangleAlert size={15} strokeWidth={2.2} aria-hidden="true" />}
            {preview.scheduled ? `Runs every night at ${formatClock(next.at)}` : 'Nightly run not set up'}
          </li>
          <li>
            <History size={15} strokeWidth={2.2} aria-hidden="true" />
            {lastRun ? `Last run ${formatStamp(lastRun.at)}: ${runResult(lastRun).toLowerCase()}` : 'Has not run yet'}
          </li>
        </ul>
      </div>
      <div className="rt-cleanup-action">
        {onRun ? (
          <Button variant={hasDue ? 'destructive' : 'gray'} busy={running} disabled={running || !hasDue} onClick={onRun} icon={<Trash2 size={18} strokeWidth={2.2} aria-hidden="true" />}>
            {running ? 'Deleting…' : 'Delete now'}
          </Button>
        ) : (
          <p className="rt-cleanup-note">Only institution administrators can delete by hand.</p>
        )}
      </div>
    </section>
  );
}

function RetentionStats({ preview, today, onShow }: Readonly<{ preview: RetentionPreview; today: string; onShow: (show: Show) => void }>) {
  const { holding, due } = preview;
  const kept = preview.sets.filter((set) => set.dueOn <= today).reduce((total, set) => total + set.keptActive, 0);
  return (
    <Stats label="Face data">
      <Stat
        label="Faces stored"
        value={holding.faces.toLocaleString('en-NG')}
        hint={holding.facesUnlisted ? `${holding.facesUnlisted.toLocaleString('en-NG')} on no class list` : preview.limitedToScope ? 'in your area' : 'registered'}
      />
      <Stat
        label="Due now"
        value={due.faces ? (
          <button className="rt-stat-link" type="button" onClick={() => onShow('due')} aria-label={`${due.faces}, show the sets due now`}>{due.faces.toLocaleString('en-NG')}</button>
        ) : '0'}
        hint="faces past their date"
        tone={due.faces ? 'warning' : undefined}
      />
      <Stat label="Kept, checking in" value={kept.toLocaleString('en-NG')} hint={`checked in, last ${preview.policy.activeWithinDays} days`} />
      <Stat
        label="Check-in photos"
        value={holding.checkPhotos.toLocaleString('en-NG')}
        hint={due.checkPhotos ? `${due.checkPhotos.toLocaleString('en-NG')} older than ${preview.policy.checkPhotoDays} days` : holding.oldestCheckPhotoAt ? `oldest ${formatStamp(holding.oldestCheckPhotoAt)}` : 'none stored'}
        tone={due.checkPhotos ? 'warning' : undefined}
      />
    </Stats>
  );
}

/** How a set's students split: faces going, kept while checking in, waiting, no face. */
function SetBar({ set, status }: Readonly<{ set: RetentionSet; status: ReturnType<typeof setStatus> }>) {
  const total = Math.max(1, set.students);
  const waiting = status === 'coming' ? set.faces : Math.max(0, set.faces - set.dueFaces - set.keptActive);
  const parts = [
    { key: 'due', value: set.dueFaces },
    { key: 'kept', value: set.keptActive },
    { key: 'waiting', value: waiting },
  ].filter((part) => part.value > 0);
  return (
    <span className="rt-bar" aria-hidden="true">
      {parts.map((part) => <span key={part.key} className={`rt-bar-part is-${part.key}`} style={{ width: `${(part.value / total) * 100}%` }} />)}
    </span>
  );
}

function setLine(set: RetentionSet, status: ReturnType<typeof setStatus>, today: string): ReactNode {
  switch (status) {
    case 'due':
      return (
        <>
          <span className="rt-strong is-due">{plural(set.dueFaces, 'face')} due</span>
          {set.keptActive ? <span> · {set.keptActive} kept, checking in</span> : null}
        </>
      );
    case 'kept':
      return <>{plural(set.keptActive, 'face')} kept, checking in</>;
    case 'coming':
      return (
        <>
          <span className="rt-strong">Due {formatDay(set.dueOn)}</span>
          <span> · {relativeDay(set.dueOn, today)}</span>
          <span> · {set.faces ? plural(set.faces, 'face') : 'no faces'}</span>
        </>
      );
    default:
      return <>No face data left · {plural(set.students, 'student')}</>;
  }
}

function SetRow({ set, today, selected, onOpen }: Readonly<{ set: RetentionSet; today: string; selected: boolean; onOpen: () => void }>) {
  const status = setStatus(set, today);
  return (
    <li>
      <button className={`ds-row rt-row${selected ? ' is-selected' : ''}`} type="button" aria-current={selected ? 'true' : undefined} onClick={onOpen}>
        <span className={`rt-year is-${status}`} aria-hidden="true">
          <span className="rt-year-from">{String(set.entryYear).slice(0, 2)}</span>
          <span className="rt-year-to">{String(set.entryYear).slice(2)}</span>
        </span>
        <span className="ds-row-body rt-row-body">
          <span className="rt-row-top">
            <span className="ds-row-title rt-row-title">{setTitle(set)}</span>
            <span className="rt-row-count">{plural(set.students, 'student')}</span>
          </span>
          <span className="rt-row-dept">{set.departmentName}<span className="rt-row-years"> · {set.programmeYears}-year programme</span></span>
          <span className="rt-row-line">{setLine(set, status, today)}</span>
          {set.faces ? <SetBar set={set} status={status} /> : null}
        </span>
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </li>
  );
}

/** The newest clean-ups (whole institution), nightly runs that deleted nothing folded together. */
function RunHistory({ preview, now }: Readonly<{ preview: RetentionPreview; now: number }>) {
  const rows = foldRuns(preview.runs);
  return (
    <section className="ds-section rt-history" id="rt-history" aria-labelledby="rt-history-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="rt-history-title">Recent clean-ups</h2>
        {preview.limitedToScope ? <span className="ds-section-aside">Whole institution</span> : null}
      </div>
      {rows.length ? (
        <ul className="ds-list rt-runs">
          {rows.map((row) => row.kind === 'quiet' ? (
            <li key={`quiet-${row.to}`}>
              <div className="ds-row rt-run">
                <span className="rt-run-icon is-quiet" aria-hidden="true"><MoonStar size={16} strokeWidth={2.2} /></span>
                <span className="ds-row-body">
                  <span className="ds-row-title">Nothing was due</span>
                  <span className="ds-row-subtitle">{row.count} nightly runs, {runSpan(row.from, row.to)}</span>
                </span>
              </div>
            </li>
          ) : (
            <li key={row.run.at}>
              <div className="ds-row rt-run">
                <span className={`rt-run-icon${row.run.facesDeleted || row.run.checkPhotosDeleted ? ' is-deleted' : ' is-quiet'}`} aria-hidden="true">
                  {row.run.scheduled ? <MoonStar size={16} strokeWidth={2.2} /> : <UserRound size={16} strokeWidth={2.2} />}
                </span>
                <span className="ds-row-body">
                  <span className="ds-row-title">{runResult(row.run)}</span>
                  <span className="ds-row-subtitle">
                    {formatStamp(row.run.at)}, {formatClock(row.run.at)} · {row.run.scheduled ? 'nightly' : `by ${row.run.actorName ?? 'an administrator'}`}
                  </span>
                </span>
                {now ? <span className="rt-run-ago">{ago(row.run.at, now)}</span> : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="ds-card">
          <EmptyState icon={<History size={26} strokeWidth={1.9} />} title="No clean-up has run yet" message={preview.scheduled ? 'The first nightly run will show here.' : 'Runs show here once someone deletes what is due.'} />
        </div>
      )}
      {!preview.limitedToScope && rows.length ? (
        <p className="ds-section-foot">
          <Link className="rt-link" href="/admin/audit?category=retention">Every clean-up in the audit log</Link>
        </p>
      ) : null}
    </section>
  );
}

function Rules({ preview }: Readonly<{ preview: RetentionPreview }>) {
  const { policy } = preview;
  return (
    <section className="ds-section rt-rules" aria-labelledby="rt-rules-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="rt-rules-title">The rules</h2>
      </div>
      <dl className="rt-facts">
        <div>
          <dt><ScanFace size={16} strokeWidth={2.2} aria-hidden="true" />Registered faces</dt>
          <dd>{plural(policy.graceMonths, 'month')} after the set finishes</dd>
        </div>
        <div>
          <dt><CalendarClock size={16} strokeWidth={2.2} aria-hidden="true" />Unless still checking in</dt>
          <dd>within the last {plural(policy.activeWithinDays, 'day')}</dd>
        </div>
        <div>
          <dt><Trash2 size={16} strokeWidth={2.2} aria-hidden="true" />Check-in photos</dt>
          <dd>after {plural(policy.checkPhotoDays, 'day')}</dd>
        </div>
        <div>
          <dt><ShieldCheck size={16} strokeWidth={2.2} aria-hidden="true" />Always kept</dt>
          <dd>accounts, class lists, attendance</dd>
        </div>
      </dl>
    </section>
  );
}

function PhoneSheet({ open, selected, fallback, render, onClose }: Readonly<{
  open: boolean;
  selected: RetentionSet | null;
  fallback: ReactNode;
  render: (set: RetentionSet) => ReactNode;
  onClose: () => void;
}>) {
  // Keep the last set on screen while the sheet slides away.
  const [last, setLast] = useState(selected);
  if (selected && selected !== last) setLast(selected);
  const shown = open ? selected : last;
  return (
    <Sheet open={open} onClose={onClose} title={shown ? `${setTitle(shown)} set` : 'Set'} size="wide">
      {shown ? render(shown) : open ? fallback : null}
    </Sheet>
  );
}

function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading data retention">
      <div className="rt-cleanup is-skeleton" aria-hidden="true">
        <span className="rt-cleanup-icon ds-skeleton" />
        <span className="rt-cleanup-body">
          <span className="ds-skeleton" style={{ width: '55%', height: 22 }} />
          <span className="ds-skeleton" style={{ width: '80%', height: 15, marginTop: 8 }} />
        </span>
      </div>
      <div className="ds-stats" aria-hidden="true">
        {[1, 2, 3, 4].map((item) => (
          <div className="ds-stat" key={item}>
            <span className="ds-skeleton" style={{ width: '60%', height: 14 }} />
            <span className="ds-skeleton" style={{ width: '40%', height: 28, marginTop: 8 }} />
          </div>
        ))}
      </div>
      <ul className="ds-list rt-list" aria-hidden="true" style={{ marginTop: 24 }}>
        {[52, 40, 60, 46].map((width) => (
          <li key={width}>
            <div className="ds-row rt-row">
              <span className="rt-year ds-skeleton" />
              <span className="ds-row-body rt-row-body">
                <span className="ds-skeleton" style={{ width: `${width}%`, height: 16 }} />
                <span className="ds-skeleton" style={{ width: '75%', height: 13, marginTop: 6 }} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
