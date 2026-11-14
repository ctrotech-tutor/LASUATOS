'use client';

import type { AuditCategory, AuditLogEntry, AuditLogPage } from '@lasuatos/contracts';
import { Building2, ClipboardCheck, FileClock, GraduationCap, Landmark, MapPinned, ScanFace, Trash2, UserCog, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { lookupAdministrator } from '../lib/current-account';
import { failureText } from '../lib/lecture-api';
import { loadAuditLog } from '../lib/student-api';
import { DatePicker } from './ui/date-picker';
import { SearchField } from './ui/search-field';
import { Select } from './ui/select';
import { ListSkeleton } from './ui/skeleton';

const CATEGORIES: ReadonlyArray<{ value: AuditCategory; label: string; description: string; icon: typeof ScanFace }> = [
  { value: 'students', label: 'Students and class lists', description: 'Uploads, corrections, accounts opened, emails confirmed', icon: GraduationCap },
  { value: 'faces', label: 'Faces', description: 'Registered, reset, new photos, failed checks, reviews', icon: ScanFace },
  { value: 'attendance', label: 'Attendance changes', description: 'Added by hand, removed, help requests', icon: ClipboardCheck },
  { value: 'staff', label: 'Staff', description: 'Invitations, suspensions, edits', icon: UserCog },
  { value: 'structure', label: 'Academic structure', description: 'Faculties, departments, sessions', icon: Landmark },
  { value: 'venues', label: 'Venues', description: 'Buildings, venues, locations', icon: MapPinned },
  { value: 'retention', label: 'Data retention', description: 'Face data deleted after graduation', icon: Trash2 },
];
const ICONS = Object.fromEntries(CATEGORIES.map((category) => [category.value, category.icon])) as Record<AuditCategory, typeof ScanFace>;

const timeFormat = new Intl.DateTimeFormat('en-NG', { hour: 'numeric', minute: '2-digit', timeZone: 'Africa/Lagos' });
const dayFormat = new Intl.DateTimeFormat('en-NG', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
const dayKey = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Africa/Lagos' });

type Load =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly page: AuditLogPage };

/**
 * Every audit trail in one list, newest first: who did what, to whom, when.
 * Department and faculty administrators see their own area's student events
 * and the staff and structure changes they made.
 */
export function AuditLogWorkspace() {
  const [category, setCategory] = useState<AuditCategory | ''>('');
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [moreBusy, setMoreBusy] = useState(false);
  const [moreError, setMoreError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearched(query.trim()), query.trim() ? 350 : 0);
    return () => window.clearTimeout(timer);
  }, [query]);

  const filters = useMemo(() => ({
    ...(category ? { category } : {}),
    ...(searched ? { q: searched } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  }), [category, searched, from, to]);

  useEffect(() => {
    const controller = new AbortController();
    void lookupAdministrator('read the audit log').then(async (session) => {
      if (session.kind === 'error') {
        if (!controller.signal.aborted) setLoad({ kind: 'error', message: session.message });
        return;
      }
      try {
        const page = await loadAuditLog(filters, controller.signal);
        if (!controller.signal.aborted) setLoad({ kind: 'ready', page });
      } catch (caught) {
        if (!controller.signal.aborted) setLoad({ kind: 'error', message: failureText(caught, 'The audit log could not be loaded.') });
      }
    });
    return () => controller.abort();
  }, [filters, attempt]);

  async function loadMore(page: AuditLogPage) {
    if (!page.nextCursor) return;
    setMoreBusy(true);
    setMoreError('');
    try {
      const next = await loadAuditLog({ ...filters, cursor: page.nextCursor });
      setLoad({ kind: 'ready', page: { ...next, entries: [...page.entries, ...next.entries] } });
    } catch (caught) {
      setMoreError(failureText(caught));
    } finally {
      setMoreBusy(false);
    }
  }

  const filtered = Boolean(category || searched || from || to);
  const groups = useMemo(() => {
    if (load.kind !== 'ready') return [];
    const byDay: Array<{ key: string; label: string; entries: AuditLogEntry[] }> = [];
    for (const entry of load.page.entries) {
      const at = new Date(entry.at);
      const key = dayKey.format(at);
      const last = byDay.at(-1);
      if (last?.key === key) last.entries.push(entry);
      else byDay.push({ key, label: dayFormat.format(at), entries: [entry] });
    }
    return byDay;
  }, [load]);

  return (
    <div className="page-stack au-page">
      <section className="page-heading">
        <div>
          <p className="page-eyebrow">ADMINISTRATION</p>
          <h1>Audit log</h1>
          <p className="page-lede">
            Who changed what, and when: class lists, accounts, faces, attendance changes, staff, structure, venues and data retention.
            Entries cannot be edited or deleted. Photos and face measurements are never shown here.
          </p>
        </div>
      </section>

      <section className="cl-card au-filters" aria-label="Filter the audit log">
        <label className="account-field au-search">
          <span>Search</span>
          <SearchField value={query} onValueChange={setQuery} placeholder="Matric number, name or venue" maxLength={120} aria-label="Search the audit log" />
        </label>
        <label className="account-field">
          <span>What</span>
          <Select
            value={category}
            onValueChange={(value) => setCategory(value as AuditCategory | '')}
            options={[{ value: '', label: 'Everything' }, ...CATEGORIES.map(({ value, label, description }) => ({ value, label, description }))]}
            searchable={false}
          />
        </label>
        <label className="account-field">
          <span>From</span>
          <DatePicker value={from} onChange={setFrom} max={to || undefined} placeholder="Any day" />
        </label>
        <label className="account-field">
          <span>To</span>
          <DatePicker value={to} onChange={setTo} min={from || undefined} placeholder="Today" />
        </label>
        {filtered ? (
          <button className="lx-link-button au-clear" type="button" onClick={() => { setCategory(''); setQuery(''); setFrom(''); setTo(''); }}>
            <X size={14} aria-hidden="true" /> Clear filters
          </button>
        ) : null}
      </section>

      {load.kind === 'ready' && load.page.limitedToScope ? (
        <p className="au-scope"><Building2 size={15} aria-hidden="true" /> Showing {load.page.scopeLabel}: its students, and the staff and structure changes you made.</p>
      ) : null}

      {load.kind === 'loading' ? <ListSkeleton label="Loading the audit log…" rows={6} /> : null}
      {load.kind === 'error' ? (
        <section className="workspace-message" role="alert">
          <span className="workspace-message-icon" aria-hidden="true">!</span>
          <div>
            <h2>The audit log is unavailable</h2>
            <p>{load.message}</p>
            <div className="workspace-message-actions">
              <button className="button button-primary" type="button" onClick={() => { setLoad({ kind: 'loading' }); setAttempt((value) => value + 1); }}>Try again</button>
              <Link className="button button-secondary" href="/admin">Back to administration</Link>
            </div>
          </div>
        </section>
      ) : null}

      {load.kind === 'ready' && load.page.entries.length === 0 ? (
        <div className="fr-empty">
          <FileClock size={30} aria-hidden="true" />
          <strong>{filtered ? 'Nothing matches these filters' : 'Nothing recorded yet'}</strong>
          <span>{filtered ? 'Try another search, category or dates.' : 'Changes appear here as soon as they are made.'}</span>
        </div>
      ) : null}

      {groups.map((group) => (
        <section className="au-day" key={group.key} aria-label={group.label}>
          <h2 className="au-day-head">{group.label}</h2>
          <ol className="au-list">
            {group.entries.map((entry) => {
              const Icon = ICONS[entry.category];
              return (
                <li key={entry.id} className={`au-entry is-${entry.category}`}>
                  <span className="au-icon" aria-hidden="true"><Icon size={16} /></span>
                  <div className="au-body">
                    <div className="au-line">
                      <strong>{entry.summary}</strong>
                      <time dateTime={entry.at}>{timeFormat.format(new Date(entry.at))}</time>
                    </div>
                    {entry.subject ? <span className="au-subject">{entry.subject}</span> : null}
                    <span className="au-actor">{entry.actorName ? `By ${entry.actorName}` : 'By the system'}</span>
                    {entry.details ? <span className="au-details">{entry.details}</span> : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      {moreError ? <p className="lx-error" role="alert">{moreError}</p> : null}
      {load.kind === 'ready' && load.page.nextCursor ? (
        <button className="button button-secondary lx-load-more" type="button" disabled={moreBusy} onClick={() => void loadMore(load.page)}>
          {moreBusy ? 'Loading…' : 'Show older entries'}
        </button>
      ) : null}
    </div>
  );
}
