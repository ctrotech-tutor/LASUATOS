'use client';

import {
  courseCodeKey,
  type LectureCatalogCourse,
  type LectureCourseCatalog,
  type LectureCourseChangeResult,
  type UpdateLectureCourseRequest,
} from '@lasuatos/contracts';
import { BookOpen, Pencil, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addCatalogCourse, failureText, loadCourseCatalog, removeCatalogCourse, updateCatalogCourse } from '../lib/lecture-api';
import { useFeedback } from './feedback';
import { EditDialog, formText } from './ui/edit-dialog';
import { NumberField } from './ui/number-field';
import { Select, type SelectOption } from './ui/select';
import { Bone } from './ui/skeleton';
import { SwitchField } from './ui/switch';

/* ------------------------------------------------------------------ */
/* Course picker: sessions are opened by picking a course from the     */
/* institution's list, so codes and titles are spelt the same way in   */
/* every session, register and export. Missing departmental courses    */
/* are added once, by any lecturer or class rep, for everyone.         */
/* ------------------------------------------------------------------ */

export type CatalogState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly catalog: LectureCourseCatalog }
  | { readonly kind: 'failed'; readonly message: string };

export function useCourseCatalog(): { state: CatalogState; replace: (catalog: LectureCourseCatalog) => void; retry: () => void } {
  const [state, setState] = useState<CatalogState>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    loadCourseCatalog(controller.signal)
      .then((catalog) => setState({ kind: 'ready', catalog }))
      .catch((caught: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'failed', message: failureText(caught, 'The course list could not be loaded.') });
      });
    return () => controller.abort();
  }, [attempt]);
  return {
    state,
    replace: (catalog) => setState({ kind: 'ready', catalog }),
    retry: () => {
      setState({ kind: 'loading' });
      setAttempt((value) => value + 1);
    },
  };
}

/** "ece305" or "Ece-305" → "ECE 305": the form the catalog stores. */
export function tidyCourseCode(value: string): string {
  const compact = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const match = /^([A-Z]{2,5})(\d{3}[A-Z]?)$/.exec(compact);
  return match ? `${match[1]} ${match[2]}` : value.trim().toUpperCase().replace(/\s+/g, ' ');
}

function ordinal(semester: 1 | 2 | null): string | null {
  return semester === 1 ? '1st semester' : semester === 2 ? '2nd semester' : null;
}

/** "200 level · 1st semester · 3 units". */
export function courseFacts(course: LectureCatalogCourse): string {
  return [
    course.level ? `${course.level} level` : null,
    ordinal(course.semester),
    course.units != null ? `${course.units} unit${course.units === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
}

export function findCourse(catalog: LectureCourseCatalog, code: string): LectureCatalogCourse | null {
  const key = courseCodeKey(code);
  return catalog.courses.find((course) => courseCodeKey(course.code) === key) ?? null;
}

/** The lecturer named the last time this person opened the course, if any. */
export function recentLecturerFor(catalog: LectureCourseCatalog, code: string): string | null {
  const key = courseCodeKey(code);
  return catalog.recent.find((item) => courseCodeKey(item.code) === key)?.lecturerName ?? null;
}

/** Typed text that is a course code rather than words from a title ("mee 305", "GET201"). */
function looksLikeCode(text: string): boolean {
  return /^[A-Za-z]{2,5}[\s-]?\d{3}[A-Za-z]?$/.test(text.trim());
}

/** Puts a changed course in place of the one it was (its code may have changed). */
export function replaceCourse(catalog: LectureCourseCatalog, before: LectureCatalogCourse, after: LectureCatalogCourse): LectureCourseCatalog {
  const beforeKey = courseCodeKey(before.code);
  const afterKey = courseCodeKey(after.code);
  const courses = catalog.courses.filter((item) => {
    const key = courseCodeKey(item.code);
    return key !== beforeKey && key !== afterKey;
  });
  return { ...catalog, courses: [...courses, after].sort((a, b) => (a.level ?? 999) - (b.level ?? 999) || a.code.localeCompare(b.code)) };
}

function levelGroup(course: LectureCatalogCourse): string {
  return course.level ? `${course.level} level` : 'Other courses';
}

/** "1st semester · 3 units · General studies (GST)", without repeating the level heading. */
function optionFacts(course: LectureCatalogCourse): string {
  return [
    ordinal(course.semester),
    course.units != null ? `${course.units} unit${course.units === 1 ? '' : 's'}` : null,
    course.source === 'institution' && course.builtInCode === null ? 'Added here' : course.group,
  ].filter(Boolean).join(' · ');
}

/**
 * The picker's options: the courses this person used lately first, then the rest
 * under level headings, each row showing the code as a chip, the title, and the
 * semester, units and group underneath.
 */
export function courseOptions(catalog: LectureCourseCatalog, current: { readonly code: string; readonly title: string } | null): SelectOption[] {
  const recentKeys = catalog.recent.slice(0, 5).map((item) => courseCodeKey(item.code));
  const recent: SelectOption[] = [];
  const rest: SelectOption[] = [];
  for (const course of catalog.courses) {
    if (course.hidden) continue;
    const isRecent = recentKeys.includes(courseCodeKey(course.code));
    const option: SelectOption = {
      value: course.code,
      tag: course.code,
      label: course.title,
      description: optionFacts(course),
      group: isRecent ? 'Recently used' : levelGroup(course),
      keywords: [course.group, course.builtInCode ?? ''].join(' '),
    };
    (isRecent ? recent : rest).push(option);
  }
  recent.sort((a, b) => recentKeys.indexOf(courseCodeKey(a.value)) - recentKeys.indexOf(courseCodeKey(b.value)));
  const list = [...recent, ...rest];
  // Keep an older session's course choosable even if it is not on the list.
  if (current && !findCourse(catalog, current.code)) {
    list.unshift({ value: current.code, tag: current.code, label: current.title, description: 'Not on the course list', group: 'This session' });
  }
  return list;
}

export function CoursePicker({
  state,
  value,
  onPick,
  onCatalogChange,
  onRetry,
  current,
}: Readonly<{
  state: CatalogState;
  /** The chosen course code, or ''. */
  value: string;
  onPick: (course: LectureCatalogCourse) => void;
  onCatalogChange: (catalog: LectureCourseCatalog) => void;
  onRetry: () => void;
  /** A session's existing course that may predate the list (edit dialog). */
  current?: { readonly code: string; readonly title: string } | undefined;
}>) {
  const [dialog, setDialog] = useState<{ kind: 'add'; code: string } | { kind: 'edit' } | null>(null);

  const catalog = state.kind === 'ready' ? state.catalog : null;
  const selected = catalog && value ? findCourse(catalog, value) : null;
  // Compared by value: the edit dialog passes a fresh object on every render.
  const currentCode = current?.code;
  const currentTitle = current?.title;

  const options = useMemo<SelectOption[]>(
    () => (catalog ? courseOptions(catalog, currentCode && currentTitle ? { code: currentCode, title: currentTitle } : null) : []),
    [catalog, currentCode, currentTitle],
  );

  if (state.kind === 'loading') {
    return (
      <div className="account-field" aria-busy="true">
        <span>Course</span>
        <Bone height={48} style={{ borderRadius: 12 }} />
        <Bone width="60%" height={12} />
      </div>
    );
  }

  if (state.kind === 'failed') {
    return (
      <div className="account-field">
        <span>Course</span>
        <p className="lx-error" role="alert">{state.message}</p>
        <button className="button button-secondary" type="button" onClick={onRetry}>Try again</button>
      </div>
    );
  }

  const ready = state.catalog;
  const shownTitle = selected?.title ?? (current && courseCodeKey(current.code) === courseCodeKey(value) ? current.title : null);

  return (
    <div className="lx-course-picker">
      <label className="account-field">
        <span>Course</span>
        <Select
          value={value}
          onValueChange={(next) => {
            const course = findCourse(ready, next);
            if (course) onPick(course);
          }}
          options={options}
          placeholder="Choose the course"
          searchPlaceholder="Search by code or title, e.g. GET 201"
          panelMinWidth={340}
          panelMaxHeight={420}
          searchable
          required
          footer={({ close, query }) => (
            <>
              <button
                className="ui-select-footer-button"
                type="button"
                onClick={() => {
                  close();
                  setDialog({ kind: 'add', code: looksLikeCode(query) ? tidyCourseCode(query) : '' });
                }}
              >
                <Plus size={15} aria-hidden="true" />
                {looksLikeCode(query) && !findCourse(ready, query) ? `Add ${tidyCourseCode(query)} to the list` : 'Course not on the list? Add it'}
              </button>
              <span className="ui-select-footer-note">{ready.courses.length} courses</span>
            </>
          )}
        />
      </label>

      {value && shownTitle ? (
        <div className="lx-course-chosen" aria-live="polite">
          <BookOpen size={18} aria-hidden="true" />
          <div>
            <strong>{shownTitle}</strong>
            <span>{selected ? courseFacts(selected) || 'From the course list' : 'Not on the course list'}</span>
          </div>
        </div>
      ) : null}

      <div className="lx-course-actions">
        <button className="lx-text-button" type="button" onClick={() => setDialog({ kind: 'add', code: '' })}>
          <Plus size={15} aria-hidden="true" /> Course not on the list? Add it
        </button>
        {selected?.canEdit ? (
          <button className="lx-text-button" type="button" onClick={() => setDialog({ kind: 'edit' })}>
            <Pencil size={14} aria-hidden="true" /> Fix this course
          </button>
        ) : null}
      </div>
      <p className="lx-fine">{ready.standardSource}</p>

      {dialog?.kind === 'add' ? (
        <AddCourseDialog
          catalog={ready}
          initialCode={dialog.code}
          onClose={() => setDialog(null)}
          onAdded={(course) => {
            onCatalogChange({ ...ready, courses: [...ready.courses, course] });
            onPick(course);
            setDialog(null);
          }}
          onPickExisting={(course) => {
            onPick(course);
            setDialog(null);
          }}
        />
      ) : null}
      {dialog?.kind === 'edit' && selected ? (
        <EditCourseDialog
          course={selected}
          canManage={ready.canManage}
          onClose={() => setDialog(null)}
          onSaved={({ course }) => {
            onCatalogChange(replaceCourse(ready, selected, course));
            if (!course.hidden) onPick(course);
            setDialog(null);
          }}
          onRemoved={() => {
            onCatalogChange({ ...ready, courses: ready.courses.filter((item) => item.id !== selected.id) });
            setDialog(null);
          }}
        />
      ) : null}
    </div>
  );
}

export function AddCourseDialog({
  catalog,
  onClose,
  onAdded,
  onPickExisting,
  initialCode = '',
}: Readonly<{
  catalog: LectureCourseCatalog;
  onClose: () => void;
  onAdded: (course: LectureCatalogCourse) => void;
  onPickExisting: (course: LectureCatalogCourse) => void;
  initialCode?: string;
}>) {
  const [code, setCode] = useState(initialCode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tidy = tidyCourseCode(code);
  const existing = /^[A-Z]{2,5} \d{3}[A-Z]?$/.test(tidy) ? findCourse(catalog, tidy) : null;

  async function save(form: HTMLFormElement) {
    const title = formText(form, 'title').replace(/\s+/g, ' ');
    const units = Number(formText(form, 'units'));
    if (!/^[A-Z]{2,5} \d{3}[A-Z]?$/.test(tidy)) {
      setError('Write the course code as letters then numbers, e.g. ECE 305.');
      return;
    }
    if (existing) {
      onPickExisting(existing);
      return;
    }
    if (title.length < 2) {
      setError('Enter the course title as it appears on the timetable.');
      return;
    }
    if (!Number.isInteger(units) || units < 0 || units > 30) {
      setError('Enter the number of units (0 to 30).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      onAdded(await addCatalogCourse({ code: tidy, title, units }));
    } catch (caught) {
      setError(failureText(caught, 'The course was not added. Try again.'));
      setBusy(false);
    }
  }

  return (
    <EditDialog
      title="Add a course to the list"
      description="Add it once and every lecturer and class rep here can pick it. Check the code and title against the department’s course list or timetable."
      submitLabel={existing ? `Use ${existing.code}` : 'Add course'}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={save}
    >
      <label className="account-field">
        <span>Course code</span>
        <input
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          onBlur={() => setCode(tidy)}
          placeholder="e.g. ECE 305"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          maxLength={12}
          required
        />
        {existing ? <small>Already on the list: {existing.title}</small> : null}
      </label>
      {existing ? null : (
        <>
          <label className="account-field">
            <span>Course title</span>
            <input name="title" placeholder="e.g. Digital Electronics" maxLength={200} required />
          </label>
          <label className="account-field">
            <span>Units</span>
            <NumberField name="units" min={0} max={30} defaultValue={3} unit="units" required />
          </label>
        </>
      )}
    </EditDialog>
  );
}

/**
 * Corrects a course in the list. Administrators can also change a built-in
 * course, change any code (e.g. when a department renames GET 201 to MEE 201),
 * move the sessions already taken to the new code, and hide a course nobody
 * should pick any more.
 */
export function EditCourseDialog({
  course,
  canManage,
  onClose,
  onSaved,
  onRemoved,
}: Readonly<{
  course: LectureCatalogCourse;
  canManage: boolean;
  onClose: () => void;
  onSaved: (result: LectureCourseChangeResult) => void;
  onRemoved?: (() => void) | undefined;
}>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [code, setCode] = useState(course.code);
  const [hidden, setHidden] = useState(course.hidden);
  const [moveSessions, setMoveSessions] = useState(true);
  const dialogs = useFeedback();
  const tidy = tidyCourseCode(code);
  const codeChanged = courseCodeKey(tidy) !== courseCodeKey(course.code);
  // Built-in courses are changed by administrators only; the person who added a course can recode it too.
  const canRecode = course.id !== null || canManage;

  async function save(form: HTMLFormElement) {
    const title = formText(form, 'title').replace(/\s+/g, ' ');
    const units = Number(formText(form, 'units'));
    if (codeChanged && !/^[A-Z]{2,5} \d{3}[A-Z]?$/.test(tidy)) {
      setError('Write the course code as letters then numbers, e.g. MEE 201.');
      return;
    }
    if (title.length < 2) {
      setError('Enter the course title.');
      return;
    }
    if (!Number.isInteger(units) || units < 0 || units > 30) {
      setError('Enter the number of units (0 to 30).');
      return;
    }
    const input: UpdateLectureCourseRequest = {
      ...(codeChanged ? { code: tidy, moveSessions: moveSessions && course.sessionCount > 0 } : {}),
      ...(title !== course.title ? { title } : {}),
      ...(units !== course.units ? { units } : {}),
      ...(hidden !== course.hidden ? { hidden } : {}),
    };
    if (!Object.keys(input).length) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await updateCatalogCourse({ id: course.id, code: course.code }, input);
      dialogs.toast(changeSummary(course, result));
      onSaved(result);
    } catch (caught) {
      setError(failureText(caught, 'The change was not saved. Try again.'));
      setBusy(false);
    }
  }

  async function remove() {
    if (!course.id || !onRemoved) return;
    const sure = await dialogs.confirm({
      title: `Remove ${course.code} from the list?`,
      body: 'Sessions already taken for it keep their course. Nobody can pick it for a new session until it is added again.',
      confirmLabel: 'Remove course',
      tone: 'danger',
    });
    if (!sure) return;
    setBusy(true);
    setError('');
    try {
      await removeCatalogCourse(course.id);
      dialogs.toast(`${course.code} was removed from the list.`);
      onRemoved();
    } catch (caught) {
      setError(failureText(caught, 'The course was not removed. Try again.'));
      setBusy(false);
    }
  }

  const sessionsLabel = `${course.sessionCount} session${course.sessionCount === 1 ? '' : 's'}`;

  return (
    <EditDialog
      title={`Change ${course.code}`}
      description={course.builtInCode && course.id === null
        ? 'This course comes from the built-in list. Your change applies to everyone here; the built-in version can be brought back by setting it back.'
        : 'Your change applies to everyone here. Sessions taken from now on use the new details.'}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={save}
    >
      {canRecode ? (
        <label className="account-field">
          <span>Course code</span>
          <input
            name="code"
            value={code}
            onChange={(event) => setCode(event.target.value.toUpperCase())}
            onBlur={() => setCode(tidy)}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={12}
            required
          />
          <small>
            {course.builtInCode && courseCodeKey(course.builtInCode) !== courseCodeKey(course.code)
              ? `Was ${course.builtInCode} on the built-in list.`
              : 'Change it when the department renames the course, e.g. GET 201 → MEE 201.'}
          </small>
        </label>
      ) : null}
      {codeChanged && course.sessionCount > 0 ? (
        <SwitchField
          checked={moveSessions}
          onCheckedChange={setMoveSessions}
          label={`Move the ${sessionsLabel} already taken to ${tidy}`}
          hint={`Their registers then continue under the new code. Turn off to keep them under ${course.code}.`}
        />
      ) : null}
      <label className="account-field">
        <span>Course title</span>
        <input name="title" defaultValue={course.title} maxLength={200} required />
      </label>
      <label className="account-field">
        <span>Units</span>
        <NumberField name="units" min={0} max={30} defaultValue={course.units ?? 3} unit="units" required />
      </label>
      {canManage || course.id !== null ? (
        <SwitchField
          checked={hidden}
          onCheckedChange={setHidden}
          label="Hide from the course list"
          hint="Nobody can pick it for a new session. Sessions already taken keep it. You can show it again later."
        />
      ) : null}
      {course.id && onRemoved && course.sessionCount === 0 ? (
        <button className="lx-text-button is-danger" type="button" onClick={() => void remove()} disabled={busy}>
          Remove this course from the list
        </button>
      ) : null}
    </EditDialog>
  );
}

/** A toast that says what actually happened. */
export function changeSummary(before: LectureCatalogCourse, result: LectureCourseChangeResult): string {
  const after = result.course;
  const parts = [courseCodeKey(before.code) !== courseCodeKey(after.code) ? `${before.code} is now ${after.code}` : `${after.code} was updated`];
  if (result.sessionsMoved) parts.push(`${result.sessionsMoved} session${result.sessionsMoved === 1 ? '' : 's'} moved`);
  if (after.hidden !== before.hidden) parts.push(after.hidden ? 'hidden from the list' : 'shown in the list again');
  return `${parts.join(', ')}.`;
}
