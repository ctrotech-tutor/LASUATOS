'use client';

import type { AuditCategory, AuditCategoryCounts, AuditLogEntry, AuditLogPage, AuditSummary } from '@lasuatos/contracts';
import { ChevronRight, Download, FileClock, Link2, RefreshCw, SearchX, ShieldCheck, TriangleAlert, UserRound, X } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { auditExportHref, loadAuditEntry, loadAuditLog, loadAuditSummary } from '../../lib/audit-api';
import { lookupAdministrator, type AdministratorAccount } from '../../lib/current-account';
import { failureText } from '../../lib/lecture-api';
import { primeResource, staleResources, useResource } from '../../lib/resource';
import { Badge, Button, buttonClassName, EmptyState, Menu, PageHeader, SegmentedControl, Sheet, Stat, Stats } from '../ds';
import { useFeedback } from '../feedback';
import { GuideButton } from '../shell/guide-button';
import { useClock } from '../take-attendance/hooks';
import { DatePicker } from '../ui/date-picker';
import { SearchField } from '../ui/search-field';
import { Select } from '../ui/select';
import { useWide } from '../venues/hooks';
import {
  actorLabel, addDays, CATEGORIES, CATEGORY_HINT, CATEGORY_LABEL, CATEGORY_SHORT, clock, copyText, ENTRY_PREFIX, entryKey, firstChange, groupByDay,
  isFiltered, LIST_PREFIX, listKey, lagosToday, PATH, PERIOD_LABEL, PERIODS, plural, queryOf, readView, resultLine, rowTime, shortName, SUMMARY_KEY,
  trendLabel, viewHref, type Period, type Show, type View,
} from './format';
import { CategoryGlyph, EntryDetail, type Nav } from './entry-detail';
import './audit.css';

type Answer = { readonly kind: 'ok'; readonly account: AdministratorAccount } | { readonly kind: 'denied'; readonly message: string };

const WHO_KEY = 'admin:audit-who';

async function loadWho(): Promise<Answer> {
  const session = await lookupAdministrator('read the audit log');
  if (session.kind === 'error') return { kind: 'denied', message: session.message };
  return { kind: 'ok', account: session.account };
}

type Loader = (signal: AbortSignal) => Promise<AuditLogPage>;
const loaders = new Map<string, Loader>();

/** One stable loader per query (useResource needs a stable loader). */
function listLoader(queryJson: string): Loader {
  let loader = loaders.get(queryJson);
  if (!loader) {
    if (loaders.size > 60) loaders.clear();
    const query = (queryJson ? JSON.parse(queryJson) : {}) as ReturnType<typeof queryOf>;
    loader = (signal) => loadAuditLog(query, signal);
    loaders.set(queryJson, loader);
  }
  return loader;
}

/** Polling replaces the list with its first page, so it stops once older entries are loaded. */
const firstPageOnly = (page: AuditLogPage) => page.entries.length <= 50;

/**
 * The audit log: every change made in LASUATOS, who made it and when. Opens on the last week
 * at a glance and the changes worth a second look; below, every entry, newest first, by day.
 * Filter by kind, period, person or search; each entry opens beside the list on wide screens
 * and in a sheet on phones, with what changed (before → after), the reason given, links to
 * the pages it touched and the stored record. The same filters download as a CSV.
 */
export function AuditLog() {
  const who = useResource(WHO_KEY, loadWho, { maxAge: 60_000 });
  const answer = who.data;
  if (answer?.kind === 'denied') {
    return (
      <div className="au">
        <PageHeader title="Audit log" />
        <div className="ds-card">
          <EmptyState icon={<FileClock size={26} strokeWidth={1.9} />} title="The audit log is for administrators" message={answer.message} action={<Button href="/" variant="tinted">Go home</Button>} />
        </div>
      </div>
    );
  }
  if (!answer) {
    return (
      <div className="au">
        <PageHeader title="Audit log" />
        {who.error ? (
          <div className="ds-card">
            <EmptyState error title="The audit log did not load" message={who.error} action={<Button variant="tinted" onClick={who.reload}>Try again</Button>} />
          </div>
        ) : <PageSkeleton />}
      </div>
    );
  }
  return <Workspace />;
}

const SHOW_LABEL: Readonly<Record<Show, string>> = { all: 'Everything', notable: 'Worth a look' };

function Workspace() {
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
  const open = useCallback((id: string | null) => go({ entry: id }), [go]);

  useEffect(() => {
    if (query.trim() === view.q.trim()) return undefined;
    const timer = window.setTimeout(() => go({ q: query, entry: null }), 350);
    return () => window.clearTimeout(timer);
  }, [query, view.q, go]);

  // Presets ("last 7 days") need today's date, which the server render does not have.
  const apiQuery = now ? queryOf(view, now) : null;
  const queryJson = apiQuery ? JSON.stringify(apiQuery) : '';
  const key = now ? listKey(view, now) : null;
  const loadList = listLoader(queryJson);
  const list = useResource(key, loadList, { maxAge: 30_000, poll: 60_000, pollWhile: firstPageOnly });
  const summary = useResource(SUMMARY_KEY, loadAuditSummary, { maxAge: 60_000, poll: 120_000 });

  // Keep the last answer on screen while another filter loads.
  const [lastList, setLastList] = useState<AuditLogPage | null>(list.data ?? null);
  if (list.data && list.data !== lastList) setLastList(list.data);
  const data = list.data ?? lastList;
  const switching = !list.data && lastList !== null;

  const entries = data?.entries ?? [];
  const reference = view.entry;
  const fromList = reference ? entries.find((item) => item.id === reference) ?? null : null;
  const fromSummary = reference && !fromList ? summary.data?.notable.find((item) => item.id === reference) ?? null : null;
  const loadDetail = useCallback((signal: AbortSignal) => loadAuditEntry(reference ?? '', signal), [reference]);
  const detail = useResource(reference && !fromList && !fromSummary ? entryKey(reference) : null, loadDetail, { maxAge: 60_000 });
  const selected = fromList ?? fromSummary ?? (detail.data?.id === reference ? detail.data : null);

  // After moving to another entry from inside one, focus follows to the new entry's top.
  const pendingFocus = useRef(false);
  const focusDetail = () => { pendingFocus.current = true; };
  const shownId = selected?.id ?? null;
  useEffect(() => {
    if (!pendingFocus.current || !shownId) return undefined;
    pendingFocus.current = false;
    const frame = window.requestAnimationFrame(() => {
      const host = document.querySelector<HTMLElement>('.au-pane-card') ?? [...document.querySelectorAll<HTMLElement>('dialog[open] .ds-sheet-body')].pop();
      host?.scrollTo({ top: 0 });
      host?.querySelector<HTMLElement>('.au-detail')?.focus({ preventScroll: true });
      document.querySelector<HTMLElement>('.au-row.is-selected')?.scrollIntoView({ block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [shownId]);

  const index = selected ? entries.findIndex((item) => item.id === selected.id) : -1;
  const nav: Nav = {
    previous: index > 0 ? () => { focusDetail(); open(entries[index - 1]!.id); } : null,
    next: index >= 0 && index < entries.length - 1 ? () => { focusDetail(); open(entries[index + 1]!.id); } : null,
    position: index >= 0 ? `${index + 1} of ${data?.nextCursor ? `${entries.length}+` : entries.length}` : null,
  };

  // J and K move through the list, Escape closes the entry (wide screens; phones have the sheet).
  const keys = useRef({ nav, close: () => open(null), active: false, open: reference !== null });
  useEffect(() => {
    keys.current = { nav, close: () => open(null), active: wide, open: reference !== null };
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const { nav: current, close, active, open: isOpen } = keys.current;
      if (!active || event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"], [role="listbox"], [role="radiogroup"]') || document.querySelector('dialog[open]')) return;
      if (event.key === 'j' && current.next) { event.preventDefault(); current.next(); }
      else if (event.key === 'k' && current.previous) { event.preventDefault(); current.previous(); }
      else if (event.key === 'Escape' && isOpen) { event.preventDefault(); close(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const [moreBusy, setMoreBusy] = useState(false);
  async function loadMore() {
    const current = list.data;
    if (!current?.nextCursor || !apiQuery || !key) return;
    setMoreBusy(true);
    try {
      const next = await loadAuditLog({ ...apiQuery, cursor: current.nextCursor });
      primeResource(key, { ...next, counts: current.counts, actor: current.actor, entries: [...current.entries, ...next.entries] });
    } catch (caught) {
      feedback.toast(failureText(caught, 'Older entries did not load. Try again.'), 'error');
    } finally {
      setMoreBusy(false);
    }
  }

  const reloadAll = () => {
    staleResources(LIST_PREFIX);
    staleResources(ENTRY_PREFIX);
    staleResources(SUMMARY_KEY);
    list.reload();
    summary.reload();
    detail.reload();
  };

  const copyLink = () => {
    void copyText(window.location.href).then((done) => feedback.toast(done ? 'Link copied' : 'The link could not be copied.', done ? undefined : 'error'));
  };
  const exportHref = apiQuery ? auditExportHref(apiQuery) : null;

  if (!data) {
    return (
      <div className="au">
        <Header />
        {list.error ? (
          <div className="ds-card">
            <EmptyState error title="The audit log did not load" message={list.error} action={<Button variant="tinted" onClick={list.reload}>Try again</Button>} />
          </div>
        ) : <PageSkeleton />}
      </div>
    );
  }

  const filtered = isFiltered(view);
  const counts = data.counts;
  const total = counts ? Object.values(counts).reduce((sum, count) => sum + count, 0) : null;
  const actorName = data.actor?.name ?? (view.actor ? entries.find((item) => item.actorId === view.actor)?.actorName ?? null : null);
  const categories = data.limitedToScope ? CATEGORIES.filter((item) => item !== 'retention') : CATEGORIES;
  const showActor = (entry: AuditLogEntry) => { if (entry.actorId) go({ actor: entry.actorId, entry: null }); };
  const showSubject = (entry: AuditLogEntry) => {
    if (!entry.subjectSearch) return;
    setQuery(entry.subjectSearch);
    go({ q: entry.subjectSearch, actor: null, category: null, show: 'all', entry: null });
  };
  const clearAll = () => { setQuery(''); go({ show: 'all', category: null, period: 'all', from: '', to: '', q: '', actor: null, entry: null }); };

  const renderDetail = (entry: AuditLogEntry, inSheet: boolean) => (
    <EntryDetail
      key={entry.id}
      entry={entry}
      now={now}
      inSheet={inSheet}
      nav={nav}
      onClose={inSheet ? undefined : () => open(null)}
      onActor={view.actor && view.actor === entry.actorId ? null : showActor}
      onSubject={view.q.trim().toLowerCase() === entry.subjectSearch?.toLowerCase() ? null : showSubject}
    />
  );

  const missing = reference && !selected ? (
    detail.error ? (
      <EmptyState
        error
        icon={<SearchX size={26} strokeWidth={1.9} />}
        title="That entry isn’t here"
        message={detail.error}
        action={<Button variant="tinted" onClick={() => open(null)}>Back to the audit log</Button>}
      />
    ) : <DetailSkeleton />
  ) : null;

  return (
    <div className="au">
      <Header subtitle={data.scopeLabel} limited={data.limitedToScope} exportHref={exportHref} onRefresh={reloadAll} onCopyLink={copyLink} />

      {summary.data ? <AuditStats summary={summary.data} onNotable={() => go({ show: 'notable', period: '7d', from: '', to: '', entry: null })} /> : <StatsSkeleton />}

      {summary.data && !filtered ? (
        <WorthALook
          summary={summary.data}
          now={now}
          selectedId={wide ? selected?.id ?? null : null}
          onOpen={open}
          onAll={() => go({ show: 'notable', period: '7d', from: '', to: '', entry: null })}
        />
      ) : null}

      <div className="au-tools" id="au-tools">
        <div className="au-tools-row">
          <SegmentedControl
            label="Show"
            value={view.show}
            onChange={(value) => go({ show: value, entry: null })}
            segments={(['all', 'notable'] as const).map((value) => ({
              value,
              label: value === 'notable' ? (
                <>
                  <TriangleAlert size={15} strokeWidth={2.3} aria-hidden="true" />
                  {SHOW_LABEL[value]}
                </>
              ) : SHOW_LABEL[value],
            }))}
          />
          <PeriodPicker view={view} now={now} onChange={(next) => go({ ...next, entry: null })} />
          <SearchField className="au-find" value={query} onValueChange={setQuery} placeholder={wide ? 'Matric number, name, course or venue' : 'Search'} aria-label="Search the audit log" />
        </div>
        <CategoryChips
          categories={categories}
          value={view.category}
          counts={counts}
          total={total}
          onChange={(category) => go({ category, entry: null })}
        />
      </div>

      {view.actor ? (
        <div className="au-actor" role="group" aria-label="Person filter">
          <span className="au-avatar is-small" aria-hidden="true"><UserRound size={14} strokeWidth={2.3} /></span>
          <span className="au-actor-text">Only changes by <strong>{actorName ?? 'this person'}</strong></span>
          <button className="ds-icon-btn au-actor-clear" type="button" aria-label="Show changes by everyone" data-tip="Everyone" onClick={() => go({ actor: null, entry: null })}>
            <X size={16} strokeWidth={2.4} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      <div className={`au-split${wide ? ' is-wide' : ''}`}>
        <section className="au-list-col" aria-label="Entries" aria-busy={switching || undefined}>
          {entries.length === 0 ? (
            <div className="ds-card">
              <ListEmpty view={view} filtered={filtered} onClear={clearAll} />
            </div>
          ) : (
            <>
              <div className="au-result">
                <p role="status">{resultLine(view, entries.length, Boolean(data.nextCursor), actorName)}</p>
                {filtered ? <button className="au-link" type="button" onClick={clearAll}>Clear filters</button> : null}
              </div>
              <div className={`au-days${switching ? ' is-switching' : ''}`}>
                {groupByDay(entries, now || Date.parse(entries[0]!.at)).map((group) => (
                  <section className="au-day" key={group.key} aria-labelledby={`au-day-${group.key}`}>
                    <h2 className="au-day-title" id={`au-day-${group.key}`}>
                      {group.label}
                      <span className="au-day-count" aria-hidden="true">{group.entries.length}</span>
                      <span className="sr-only">, {plural(group.entries.length, 'entry', 'entries')}</span>
                    </h2>
                    <ul className="ds-list au-list">
                      {group.entries.map((entry) => (
                        <EntryRow
                          key={entry.id}
                          entry={entry}
                          showCategory={!view.category}
                          selected={wide && entry.id === selected?.id}
                          onOpen={() => open(entry.id)}
                        />
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
              {data.nextCursor ? (
                <div className="au-more">
                  <Button variant="gray" busy={moreBusy} disabled={moreBusy} onClick={() => void loadMore()}>Show older entries</Button>
                </div>
              ) : entries.length > 8 ? <p className="au-end">That’s every entry{filtered ? ' that matches' : ''}.</p> : null}
            </>
          )}
        </section>

        {wide ? (
          <aside className="au-pane" aria-label={selected ? selected.summary : 'Entry'}>
            <div className="au-pane-card">
              {selected ? renderDetail(selected, false) : missing ?? <PanePlaceholder count={entries.length} />}
            </div>
          </aside>
        ) : null}
      </div>

      {!wide ? (
        <PhoneSheet open={reference !== null} selected={selected} fallback={missing} render={(entry) => renderDetail(entry, true)} onClose={() => open(null)} />
      ) : null}
    </div>
  );
}

function Header({ subtitle, limited = false, exportHref, onRefresh, onCopyLink }: Readonly<{
  subtitle?: string;
  limited?: boolean;
  exportHref?: string | null;
  onRefresh?: () => void;
  onCopyLink?: () => void;
}>) {
  return (
    <PageHeader
      title="Audit log"
      subtitle={subtitle ? (
        <span className="au-scope">
          {limited ? null : <ShieldCheck size={15} strokeWidth={2.3} aria-hidden="true" />}
          {subtitle}
        </span>
      ) : undefined}
      actions={(
        <div className="au-head-actions">
          <GuideButton page={PATH} label="Audit log" />
          {exportHref ? (
            <a className={buttonClassName({ variant: 'gray', size: 'sm', className: 'au-download' })} href={exportHref} download>
              <Download size={16} strokeWidth={2.3} aria-hidden="true" />
              Download CSV
            </a>
          ) : null}
          {onRefresh ? (
            <Menu
              label="More actions"
              items={[
                exportHref ? { label: 'Download these entries (CSV)', icon: <Download size={17} />, onSelect: () => window.location.assign(exportHref) } : null,
                onCopyLink ? { label: 'Copy link to this view', icon: <Link2 size={17} />, onSelect: onCopyLink } : null,
                { label: 'Check for new entries', icon: <RefreshCw size={17} />, onSelect: onRefresh },
              ]}
            />
          ) : null}
        </div>
      )}
    />
  );
}

function AuditStats({ summary, onNotable }: Readonly<{ summary: AuditSummary; onNotable: () => void }>) {
  const busiest = (Object.entries(summary.byCategory) as [AuditCategory, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])[0];
  return (
    <Stats label="The last 7 days">
      <Stat label="Changes, 7 days" value={summary.total.toLocaleString('en-NG')} hint={trendLabel(summary.total, summary.previousTotal)} />
      <Stat
        label="Worth a look"
        value={summary.notableCount ? (
          <button className="au-stat-link" type="button" onClick={onNotable} aria-label={`${summary.notableCount}, show the entries worth a look`}>
            {summary.notableCount.toLocaleString('en-NG')}
          </button>
        ) : '0'}
        hint={summary.notableCount ? 'removals, resets, suspensions' : 'nothing taken away'}
        tone={summary.notableCount ? 'warning' : undefined}
      />
      <Stat label="People" value={summary.people.toLocaleString('en-NG')} hint={summary.people === 1 ? 'made a change' : 'made changes'} />
      <Stat label="Most changed" value={busiest ? CATEGORY_SHORT[busiest[0]] : '—'} hint={busiest ? plural(busiest[1], 'change') : 'a quiet week'} />
    </Stats>
  );
}

/** The newest entries worth a second look this week, up to five. */
function WorthALook({ summary, now, selectedId, onOpen, onAll }: Readonly<{
  summary: AuditSummary;
  now: number;
  selectedId: string | null;
  onOpen: (id: string) => void;
  onAll: () => void;
}>) {
  if (!summary.notable.length) return null;
  return (
    <section className="ds-section au-look" aria-labelledby="au-look-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="au-look-title">Worth a look</h2>
        <span className="ds-section-aside">{plural(summary.notableCount, 'this week', 'this week')}</span>
      </div>
      <ul className="ds-list au-look-list">
        {summary.notable.map((entry) => (
          <li key={entry.id}>
            <button className={`ds-row au-look-row${entry.id === selectedId ? ' is-selected' : ''}`} type="button" onClick={() => onOpen(entry.id)}>
              <CategoryGlyph category={entry.category} notable size={16} />
              <span className="ds-row-body">
                <span className="ds-row-title">{entry.summary}</span>
                <span className="ds-row-subtitle">
                  {[entry.subject, `by ${actorLabel(entry)}`].filter(Boolean).join(' · ')}
                  {now ? <span className="au-look-when"> · {rowTime(entry.at, now)}</span> : null}
                </span>
              </span>
              <time className="au-look-time" dateTime={entry.at}>{now ? rowTime(entry.at, now) : ''}</time>
              <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {summary.notableCount > summary.notable.length ? (
        <p className="ds-section-foot">
          <button className="au-link" type="button" onClick={onAll}>Show all {summary.notableCount} from this week</button>
        </p>
      ) : null}
    </section>
  );
}

function PeriodPicker({ view, now, onChange }: Readonly<{ view: View; now: number; onChange: (next: Pick<View, 'period' | 'from' | 'to'>) => void }>) {
  const today = now ? lagosToday(now) : undefined;
  return (
    <div className={`au-period${view.period === 'custom' ? ' is-custom' : ''}`}>
      <div className="au-period-select">
        <Select
          value={view.period}
          aria-label="When"
          onValueChange={(value) => {
            const period = value as Period;
            onChange(period === 'custom'
              ? { period, from: view.from || (today ? addDays(today, -6) : ''), to: view.to || (today ?? '') }
              : { period, from: '', to: '' });
          }}
          options={PERIODS.map((value) => ({ value, label: PERIOD_LABEL[value] }))}
        />
      </div>
      {view.period === 'custom' ? (
        <div className="au-dates" role="group" aria-label="Dates">
          <label className="au-date">
            <span className="sr-only">From</span>
            <DatePicker value={view.from} onChange={(from) => onChange({ period: 'custom', from, to: view.to && from > view.to ? from : view.to })} max={today} placeholder="From" />
          </label>
          <span className="au-dates-dash" aria-hidden="true">–</span>
          <label className="au-date">
            <span className="sr-only">To</span>
            <DatePicker value={view.to} onChange={(to) => onChange({ period: 'custom', from: view.from && to < view.from ? to : view.from, to })} min={view.from || undefined} max={today} placeholder="To" />
          </label>
        </div>
      ) : null}
    </div>
  );
}

/** Kinds of change, each with how many entries it has under the other filters. */
function CategoryChips({ categories, value, counts, total, onChange }: Readonly<{
  categories: readonly AuditCategory[];
  value: AuditCategory | null;
  counts: AuditCategoryCounts | null;
  total: number | null;
  onChange: (category: AuditCategory | null) => void;
}>) {
  const chip = (category: AuditCategory | null, label: string, count: number | null, hint: string) => {
    const pressed = value === category;
    return (
      <button
        key={category ?? 'all'}
        className={`au-chip${pressed ? ' is-on' : ''}${count === 0 && !pressed ? ' is-empty' : ''}`}
        type="button"
        aria-pressed={pressed}
        title={hint}
        onClick={() => onChange(category)}
      >
        {category ? <CategoryGlyph category={category} size={14} /> : null}
        <span>{label}</span>
        {count !== null ? <span className="au-chip-count">{count.toLocaleString('en-NG')}</span> : null}
      </button>
    );
  };
  return (
    <div className="au-chips" role="group" aria-label="Kind of change">
      {chip(null, 'All kinds', total, 'Every kind of change')}
      {categories.map((category) => chip(category, CATEGORY_SHORT[category], counts ? counts[category] : null, `${CATEGORY_LABEL[category]}: ${CATEGORY_HINT[category]}`))}
    </div>
  );
}

function EntryRow({ entry, showCategory, selected, onOpen }: Readonly<{
  entry: AuditLogEntry;
  showCategory: boolean;
  selected: boolean;
  onOpen: () => void;
}>) {
  const change = firstChange(entry);
  return (
    <li>
      <button className={`ds-row au-row${selected ? ' is-selected' : ''}`} type="button" aria-current={selected ? 'true' : undefined} onClick={onOpen}>
        <CategoryGlyph category={entry.category} notable={entry.notable} />
        <span className="ds-row-body au-row-body">
          <span className="au-row-top">
            <span className="ds-row-title au-row-title">{entry.summary}</span>
            <time className="au-row-time" dateTime={entry.at}>{clock(entry.at)}</time>
          </span>
          {entry.subject ? <span className="au-row-subject">{entry.subject}</span> : null}
          {change ? (
            <span className="au-row-change">
              {change.label}: <span className="au-before">{change.previous}</span> to <span className="au-after">{change.value}</span>
            </span>
          ) : null}
          <span className="au-row-meta">
            <span className="au-ellipsis">by {shortName(actorLabel(entry))}</span>
            {showCategory ? <span className="au-row-kind">{CATEGORY_SHORT[entry.category]}</span> : null}
            {entry.notable ? <Badge tone="warning">Worth a look</Badge> : null}
          </span>
        </span>
      </button>
    </li>
  );
}

function ListEmpty({ view, filtered, onClear }: Readonly<{ view: View; filtered: boolean; onClear: () => void }>) {
  if (filtered) {
    return (
      <EmptyState
        icon={<SearchX size={26} strokeWidth={1.9} />}
        title={view.q.trim() ? `Nothing matches “${view.q.trim()}”` : view.show === 'notable' ? 'Nothing worth a look here' : 'No entries like that'}
        message="Search finds a matric number, a name or email address, a course code, a venue or a department. Try a longer period or fewer filters."
        action={<Button variant="tinted" onClick={onClear}>Clear filters</Button>}
      />
    );
  }
  return <EmptyState icon={<FileClock size={26} strokeWidth={1.9} />} title="Nothing recorded yet" message="Changes appear here as people use LASUATOS: class lists, faces, attendance, staff, structure and venues." />;
}

function PanePlaceholder({ count }: Readonly<{ count: number }>) {
  return (
    <div className="au-placeholder">
      <EmptyState
        icon={<FileClock size={26} strokeWidth={1.9} />}
        title={count ? 'Choose an entry to see it in full' : 'Nothing to show here'}
        message={count ? 'What changed, the reason given, and links to the pages it touched. Press J and K to move down and up.' : undefined}
      />
    </div>
  );
}

function PhoneSheet({ open, selected, fallback, render, onClose }: Readonly<{
  open: boolean;
  selected: AuditLogEntry | null;
  fallback: ReactNode;
  render: (entry: AuditLogEntry) => ReactNode;
  onClose: () => void;
}>) {
  // Keep the last entry on screen while the sheet slides away.
  const [last, setLast] = useState(selected);
  if (selected && selected !== last) setLast(selected);
  const shown = open ? selected : last;
  return (
    <Sheet open={open} onClose={onClose} title={shown?.summary ?? 'Entry'} size="wide">
      {shown ? render(shown) : open ? fallback : null}
    </Sheet>
  );
}

function DetailSkeleton() {
  return (
    <div className="au-detail-skeleton" role="status" aria-label="Loading the entry">
      <span className="ds-skeleton" style={{ width: '30%', height: 20 }} />
      <span className="ds-skeleton" style={{ width: '70%', height: 28 }} />
      <span className="ds-skeleton" style={{ width: '45%', height: 16 }} />
      <span className="ds-skeleton" style={{ width: '100%', height: 140 }} />
    </div>
  );
}

function StatsSkeleton() {
  return (
    <div className="ds-stats" aria-hidden="true">
      {[1, 2, 3, 4].map((item) => (
        <div className="ds-stat" key={item}>
          <span className="ds-skeleton" style={{ width: '60%', height: 14 }} />
          <span className="ds-skeleton" style={{ width: '40%', height: 28, marginTop: 8 }} />
        </div>
      ))}
    </div>
  );
}

function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading the audit log">
      <StatsSkeleton />
      <ul className="ds-list au-list" aria-hidden="true" style={{ marginTop: 24 }}>
        {[62, 48, 70, 54, 40].map((width) => (
          <li key={width}>
            <div className="ds-row au-row">
              <span className="au-glyph ds-skeleton" />
              <span className="ds-row-body au-row-body">
                <span className="ds-skeleton" style={{ width: `${width}%`, height: 16 }} />
                <span className="ds-skeleton" style={{ width: '80%', height: 13, marginTop: 6 }} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
