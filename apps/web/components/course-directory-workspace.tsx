'use client';

import {
  courseCodeKey,
  type LectureCatalogCourse,
  type LectureCourseCatalog,
  type RenameCoursePrefixResult,
} from '@lasuatos/contracts';
import { ArrowLeft, ArrowRight, BookMarked, EyeOff, Plus, Replace, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { lookupAdministrator, type AdministratorAccount } from '../lib/current-account';
import { failureText, loadCourseCatalog, renameCoursePrefix } from '../lib/lecture-api';
import { AddCourseDialog, EditCourseDialog, replaceCourse } from './course-picker';
import { useFeedback } from './feedback';
import { EditButton } from './ui/edit-dialog';
import { SearchField } from './ui/search-field';
import { Select } from './ui/select';
import { ManagementSkeleton } from './ui/skeleton';
import { SwitchField } from './ui/switch';

/* ------------------------------------------------------------------ */
/* Course directory: the list every session's course is picked from.   */
/* Administrators correct titles, units and codes here, hide courses   */
/* that are no longer taught, and rename a whole prefix when a         */
/* department's codes change (e.g. GET → MEE) in one step.             */
/* ------------------------------------------------------------------ */

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready'; readonly account: AdministratorAccount; readonly catalog: LectureCourseCatalog };

type Filter = 'all' | 'built_in' | 'changed' | 'added' | 'hidden';

const FILTERS: ReadonlyArray<{ value: Filter; label: string; description: string }> = [
  { value: 'all', label: 'All courses', description: 'Everything that can be picked, and hidden ones' },
  { value: 'built_in', label: 'Built-in, unchanged', description: 'As on the NUC CCMAS list' },
  { value: 'changed', label: 'Changed here', description: 'Built-in courses given a new code, title or units' },
  { value: 'added', label: 'Added here', description: 'Departmental courses added by staff' },
  { value: 'hidden', label: 'Hidden', description: 'Not offered when opening a session' },
];

function kindOf(course: LectureCatalogCourse): Exclude<Filter, 'all' | 'hidden'> {
  if (course.id === null) return 'built_in';
  return course.builtInCode ? 'changed' : 'added';
}

const prefixOf = (code: string) => code.split(' ')[0] ?? code;

export function CourseDirectoryWorkspace() {
  const dialogs = useFeedback();
  const [state, setState] = useState<LoadState>({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<LectureCatalogCourse | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    void lookupAdministrator('manage the course list')
      .then(async (session) => {
        if (session.kind === 'error') {
          if (!signal.aborted) setState({ kind: 'error', message: session.message });
          return;
        }
        const catalog = await loadCourseCatalog(signal, { includeHidden: true });
        if (!signal.aborted) setState({ kind: 'ready', account: session.account, catalog });
      })
      .catch((caught: unknown) => {
        if (!signal.aborted) setState({ kind: 'error', message: failureText(caught, 'The course list could not be loaded.') });
      });
    return () => controller.abort();
  }, [reloadKey]);

  const refresh = () => setReloadKey((key) => key + 1);
  const catalog = state.kind === 'ready' ? state.catalog : null;

  const shown = useMemo(() => {
    if (!catalog) return [];
    const words = query.toLocaleLowerCase('en-NG').split(/\s+/).filter(Boolean);
    const squashed = words.join('');
    return catalog.courses.filter((course) => {
      if (filter === 'hidden' ? !course.hidden : filter !== 'all' && (course.hidden || kindOf(course) !== filter)) return false;
      if (!words.length) return true;
      const haystack = `${course.code} ${course.title} ${course.group} ${course.builtInCode ?? ''} ${course.addedByName ?? ''}`.toLocaleLowerCase('en-NG');
      return words.every((word) => haystack.includes(word)) || course.code.replace(/\s+/g, '').toLocaleLowerCase('en-NG').includes(squashed);
    });
  }, [catalog, query, filter]);

  const groups = useMemo(() => {
    const map = new Map<string, LectureCatalogCourse[]>();
    for (const course of shown) {
      const key = course.level ? `${course.level} level` : 'Other courses';
      map.set(key, [...(map.get(key) ?? []), course]);
    }
    return [...map.entries()];
  }, [shown]);

  if (state.kind === 'loading') return <ManagementSkeleton label="Loading the course list…" />;
  if (state.kind === 'error') {
    return (
      <section className="workspace-message" role="alert">
        <span className="workspace-message-icon" aria-hidden="true">!</span>
        <div>
          <h2>The course list is unavailable</h2>
          <p>{state.message}</p>
          <div className="workspace-message-actions">
            <button className="button button-primary" type="button" onClick={() => { setState({ kind: 'loading' }); refresh(); }}>Try again</button>
            <Link className="button button-secondary" href="/admin">Back to administration overview</Link>
          </div>
        </div>
      </section>
    );
  }

  const { account } = state;
  const ready = state.catalog;
  const counts = {
    total: ready.courses.filter((course) => !course.hidden).length,
    changed: ready.courses.filter((course) => kindOf(course) === 'changed').length,
    added: ready.courses.filter((course) => kindOf(course) === 'added').length,
    hidden: ready.courses.filter((course) => course.hidden).length,
  };
  const prefixes = [...new Set(ready.courses.filter((course) => !course.hidden).map((course) => prefixOf(course.code)))].sort();

  return (
    <div className="venue-workspace cd-workspace">
      <div className="venue-workspace-heading">
        <Link className="text-link" href="/admin"><ArrowLeft size={14} aria-hidden="true" /> Administration overview</Link>
        <div className="admin-overview-heading venue-heading-row">
          <div>
            <p className="section-kicker">COURSES · DIRECTORY</p>
            <h1>Course list</h1>
            <p>
              Lecturers and class reps pick every session’s course from this list, so codes and titles stay the same on
              every register and export. When a code changes, change it here once.
            </p>
          </div>
        </div>
        <div className="admin-scope-card venue-scope-card" aria-label="Course list scope">
          <div className="admin-scope-symbol"><ShieldCheck size={23} strokeWidth={1.7} aria-hidden="true" /></div>
          <div className="admin-scope-copy">
            <p className="section-kicker">WHAT YOU CAN CHANGE</p>
            <h2>{ready.canManage ? 'The whole list' : 'Courses added at your institution'}</h2>
            <p>
              {ready.canManage
                ? 'You can change built-in courses, hide courses and rename a code prefix for everyone.'
                : 'Built-in courses and bulk renames are handled by a faculty or institution administrator.'}
            </p>
          </div>
          <span className="admin-role-tag">{account.displayName}</span>
        </div>
      </div>

      <dl className="cd-stats" aria-label="Course list summary">
        <div><dt>Can be picked</dt><dd>{counts.total}</dd></div>
        <div><dt>Changed here</dt><dd>{counts.changed}</dd></div>
        <div><dt>Added here</dt><dd>{counts.added}</dd></div>
        <div><dt>Hidden</dt><dd>{counts.hidden}</dd></div>
      </dl>

      {ready.canManage ? (
        <PrefixRenamePanel
          prefixes={prefixes}
          onApplied={(message) => {
            dialogs.toast(message);
            refresh();
          }}
        />
      ) : null}

      <section className="venue-panel" aria-labelledby="cd-list-heading">
        <div className="venue-panel-heading cd-list-heading">
          <BookMarked size={16} aria-hidden="true" />
          <div>
            <h3 id="cd-list-heading">Courses ({shown.length})</h3>
            <p>Tap Edit to correct a code, title or units, or to hide a course. {ready.standardSource}</p>
          </div>
          <button className="button button-secondary cd-add" type="button" onClick={() => setAdding(true)}>
            <Plus size={15} aria-hidden="true" /> Add a course
          </button>
        </div>
        <div className="cd-toolbar">
          <SearchField value={query} onValueChange={setQuery} placeholder="Search code, title or who added it" aria-label="Search courses" />
          <Select
            value={filter}
            onValueChange={(next) => setFilter(next as Filter)}
            options={FILTERS.map((item) => ({ ...item }))}
            aria-label="Show"
            panelMinWidth={280}
          />
        </div>
        {groups.length ? (
          groups.map(([group, courses]) => (
            <div key={group} className="cd-group">
              <h4 className="cd-group-heading">{group} <span>{courses.length}</span></h4>
              <ul className="cd-list">
                {courses.map((course) => (
                  <CourseRow key={`${course.id ?? 'std'}-${course.code}`} course={course} onEdit={() => setEditing(course)} />
                ))}
              </ul>
            </div>
          ))
        ) : (
          <p className="venue-empty">{query ? `No course matches “${query}”.` : 'No courses here.'}</p>
        )}
      </section>

      {editing ? (
        <EditCourseDialog
          course={editing}
          canManage={ready.canManage}
          onClose={() => setEditing(null)}
          onSaved={({ course }) => {
            setState({ kind: 'ready', account, catalog: replaceCourse(ready, editing, course) });
            setEditing(null);
            // A built-in course shown again unchanged goes back to being built-in; reload for the exact state.
            refresh();
          }}
          onRemoved={() => {
            setEditing(null);
            refresh();
          }}
        />
      ) : null}
      {adding ? (
        <AddCourseDialog
          catalog={ready}
          onClose={() => setAdding(false)}
          onAdded={(course) => {
            setAdding(false);
            dialogs.toast(`${course.code} was added to the list.`);
            refresh();
          }}
          onPickExisting={(course) => {
            setAdding(false);
            setQuery(course.code);
            setFilter('all');
          }}
        />
      ) : null}
    </div>
  );
}

function CourseRow({ course, onEdit }: Readonly<{ course: LectureCatalogCourse; onEdit: () => void }>) {
  const kind = kindOf(course);
  const recoded = course.builtInCode && courseCodeKey(course.builtInCode) !== courseCodeKey(course.code);
  return (
    <li className={`cd-row${course.hidden ? ' is-hidden' : ''}`}>
      <span className="ui-tag cd-code">{course.code}</span>
      <div className="cd-row-main">
        <strong>{course.title}</strong>
        <span className="cd-row-facts">
          {[
            course.semester === 1 ? '1st semester' : course.semester === 2 ? '2nd semester' : null,
            course.units != null ? `${course.units} unit${course.units === 1 ? '' : 's'}` : 'Units not set',
            course.group,
          ].filter(Boolean).join(' · ')}
        </span>
        <span className="cd-badges">
          {kind === 'built_in' ? <span className="cd-badge">Built-in</span> : null}
          {kind === 'changed' ? <span className="cd-badge is-changed">{recoded ? `Was ${course.builtInCode}` : 'Changed here'}</span> : null}
          {kind === 'added' ? <span className="cd-badge is-added">Added{course.addedByName ? ` by ${course.addedByName}` : ' here'}</span> : null}
          {course.hidden ? <span className="cd-badge is-hidden"><EyeOff size={12} aria-hidden="true" /> Hidden</span> : null}
          {course.sessionCount ? <span className="cd-badge is-count">{course.sessionCount} session{course.sessionCount === 1 ? '' : 's'}</span> : null}
        </span>
      </div>
      {course.canEdit ? <EditButton label={`Edit ${course.code}`} onClick={onEdit} /> : null}
    </li>
  );
}

/**
 * Renames every course that starts with one prefix. A preview comes first: it
 * lists each change, how many sessions each has, and anything that would be
 * skipped (a code already in use, or a built-in course whose units are unknown).
 */
function PrefixRenamePanel({ prefixes, onApplied }: Readonly<{ prefixes: readonly string[]; onApplied: (message: string) => void }>) {
  const dialogs = useFeedback();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [moveSessions, setMoveSessions] = useState(true);
  const [preview, setPreview] = useState<RenameCoursePrefixResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const cleanTo = to.trim().toUpperCase();
  const valid = /^[A-Z]{2,5}$/.test(from) && /^[A-Z]{2,5}$/.test(cleanTo) && from !== cleanTo;
  const sessionsInPreview = preview?.changes.reduce((sum, change) => sum + change.sessionCount, 0) ?? 0;

  async function runPreview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid) {
      setError(from === cleanTo ? 'The new prefix is the same as the old one.' : 'Choose the current prefix and type the new one (2 to 5 letters).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      setPreview(await renameCoursePrefix({ from, to: cleanTo, moveSessions, apply: false }));
    } catch (caught) {
      setPreview(null);
      setError(failureText(caught, 'The preview could not be made. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!preview?.changes.length) return;
    const sure = await dialogs.confirm({
      title: `Rename ${preview.changes.length} course${preview.changes.length === 1 ? '' : 's'} from ${from} to ${cleanTo}?`,
      body: moveSessions && sessionsInPreview
        ? `${sessionsInPreview} session${sessionsInPreview === 1 ? '' : 's'} already taken will move to the new codes, so their registers continue. Everything changes together or not at all.`
        : 'Sessions already taken keep their old codes. New sessions use the new codes. Everything changes together or not at all.',
      confirmLabel: 'Rename courses',
    });
    if (!sure) return;
    setBusy(true);
    setError('');
    try {
      const result = await renameCoursePrefix({ from, to: cleanTo, moveSessions, apply: true });
      setPreview(null);
      setFrom('');
      setTo('');
      onApplied(`${result.changes.length} course${result.changes.length === 1 ? '' : 's'} renamed to ${cleanTo}`
        + `${result.sessionsMoved ? `, ${result.sessionsMoved} session${result.sessionsMoved === 1 ? '' : 's'} moved` : ''}.`);
    } catch (caught) {
      setError(failureText(caught, 'The rename was not applied. Nothing was changed.'));
    } finally {
      setBusy(false);
    }
  }

  const reset = () => setPreview(null);

  return (
    <section className="venue-panel" aria-labelledby="cd-rename-heading">
      <div className="venue-panel-heading">
        <Replace size={16} aria-hidden="true" />
        <div>
          <h3 id="cd-rename-heading">Rename a code prefix</h3>
          <p>
            When a department’s codes change, for example the GET courses taught as MEE, rename them all at once.
            You see exactly what changes before anything is saved.
          </p>
        </div>
      </div>
      <form className="cd-rename" onSubmit={(event) => void runPreview(event)}>
        <div className="cd-rename-fields">
          <label className="account-field">
            <span>Current prefix</span>
            <Select
              value={from}
              onValueChange={(next) => { setFrom(next); reset(); }}
              placeholder="Choose"
              options={prefixes.map((prefix) => ({ value: prefix, label: prefix }))}
            />
          </label>
          <ArrowRight className="cd-rename-arrow" size={18} aria-hidden="true" />
          <label className="account-field">
            <span>New prefix</span>
            <input
              value={to}
              onChange={(event) => { setTo(event.target.value.toUpperCase().replace(/[^A-Z]/g, '')); reset(); }}
              placeholder="e.g. MEE"
              maxLength={5}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
            />
          </label>
        </div>
        <SwitchField
          checked={moveSessions}
          onCheckedChange={(next) => { setMoveSessions(next); reset(); }}
          label="Move sessions already taken to the new codes"
          hint="Keeps each course’s attendance history together. Turn off to leave past sessions under the old codes."
        />
        {error ? <p className="account-error" role="alert">{error}</p> : null}
        <div className="venue-form-actions">
          <button className="button button-secondary" type="submit" disabled={busy || !from || !to}>
            {busy && !preview ? 'Checking' : 'Preview changes'}
          </button>
        </div>
      </form>

      {preview ? (
        <div className="cd-preview" aria-live="polite">
          {preview.changes.length ? (
            <>
              <h4>{preview.changes.length} course{preview.changes.length === 1 ? '' : 's'} will change</h4>
              <ul className="cd-preview-list">
                {preview.changes.map((change) => (
                  <li key={change.fromCode}>
                    <span className="ui-tag cd-old">{change.fromCode}</span>
                    <ArrowRight size={14} aria-hidden="true" />
                    <span className="ui-tag">{change.toCode}</span>
                    <span className="cd-preview-title">{change.title}</span>
                    {change.sessionCount ? (
                      <small>{change.sessionCount} session{change.sessionCount === 1 ? '' : 's'}{moveSessions ? ' move' : ' stay'}</small>
                    ) : null}
                  </li>
                ))}
              </ul>
            </>
          ) : <h4>Nothing can be renamed.</h4>}
          {preview.conflicts.length ? (
            <div className="cd-conflicts">
              <h4>{preview.conflicts.length} skipped</h4>
              <ul>
                {preview.conflicts.map((conflict) => (
                  <li key={conflict.fromCode}>
                    <strong>{conflict.fromCode}<ArrowRight size={13} aria-label="to" />{conflict.toCode}:</strong> {conflict.reason}
                  </li>
                ))}
              </ul>
              <p>Fix these one at a time with Edit in the list below.</p>
            </div>
          ) : null}
          {preview.changes.length ? (
            <div className="venue-form-actions">
              <button className="button button-primary" type="button" disabled={busy} onClick={() => void apply()}>
                {busy ? 'Renaming' : `Rename ${preview.changes.length} course${preview.changes.length === 1 ? '' : 's'}`}
              </button>
              <button className="button button-secondary" type="button" disabled={busy} onClick={reset}>Cancel</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
