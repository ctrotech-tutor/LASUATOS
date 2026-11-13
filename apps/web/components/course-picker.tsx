'use client';

import { courseCodeKey, type LectureCatalogCourse, type LectureCourseCatalog } from '@lasuatos/contracts';
import { BookOpen, Pencil, Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { addCatalogCourse, failureText, loadCourseCatalog, removeCatalogCourse, updateCatalogCourse } from '../lib/lecture-api';
import { useFeedback } from './feedback';
import { EditDialog, formText } from './ui/edit-dialog';
import { NumberField } from './ui/number-field';
import { Select, type SelectOption } from './ui/select';
import { Bone } from './ui/skeleton';

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
  const [dialog, setDialog] = useState<'add' | 'edit' | null>(null);

  const catalog = state.kind === 'ready' ? state.catalog : null;
  const selected = catalog && value ? findCourse(catalog, value) : null;

  const options = useMemo<SelectOption[]>(() => {
    if (!catalog) return [];
    const recentKeys = catalog.recent.map((item) => courseCodeKey(item.code));
    const rank = (course: LectureCatalogCourse) => {
      const index = recentKeys.indexOf(courseCodeKey(course.code));
      return index === -1 ? Number.POSITIVE_INFINITY : index;
    };
    const ordered = [...catalog.courses].sort((a, b) => rank(a) - rank(b));
    const list: SelectOption[] = ordered.map((course) => {
      const recent = rank(course) !== Number.POSITIVE_INFINITY;
      const facts = courseFacts(course);
      return {
        value: course.code,
        label: `${course.code} · ${course.title}`,
        description: [recent ? 'Recently used' : null, facts || null, course.source === 'institution' ? course.group : null]
          .filter(Boolean)
          .join(' · '),
      };
    });
    // Keep an older session's course choosable even if it is not on the list.
    if (current && !findCourse(catalog, current.code)) {
      list.unshift({ value: current.code, label: `${current.code} · ${current.title}`, description: 'Current course · not on the list' });
    }
    return list;
  }, [catalog, current]);

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
          searchable
          required
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
        <button className="lx-text-button" type="button" onClick={() => setDialog('add')}>
          <Plus size={15} aria-hidden="true" /> Course not on the list? Add it
        </button>
        {selected?.canEdit && selected.id ? (
          <button className="lx-text-button" type="button" onClick={() => setDialog('edit')}>
            <Pencil size={14} aria-hidden="true" /> Fix this course
          </button>
        ) : null}
      </div>
      <p className="lx-fine">{ready.standardSource}</p>

      {dialog === 'add' ? (
        <AddCourseDialog
          catalog={ready}
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
      {dialog === 'edit' && selected?.id ? (
        <EditCourseDialog
          course={selected}
          onClose={() => setDialog(null)}
          onSaved={(course) => {
            onCatalogChange({ ...ready, courses: ready.courses.map((item) => (item.id === course.id ? course : item)) });
            onPick(course);
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

function AddCourseDialog({
  catalog,
  onClose,
  onAdded,
  onPickExisting,
}: Readonly<{
  catalog: LectureCourseCatalog;
  onClose: () => void;
  onAdded: (course: LectureCatalogCourse) => void;
  onPickExisting: (course: LectureCatalogCourse) => void;
}>) {
  const [code, setCode] = useState('');
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

function EditCourseDialog({
  course,
  onClose,
  onSaved,
  onRemoved,
}: Readonly<{
  course: LectureCatalogCourse;
  onClose: () => void;
  onSaved: (course: LectureCatalogCourse) => void;
  onRemoved: () => void;
}>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const dialogs = useFeedback();
  const id = course.id ?? '';

  async function save(form: HTMLFormElement) {
    const title = formText(form, 'title').replace(/\s+/g, ' ');
    const units = Number(formText(form, 'units'));
    if (title.length < 2) {
      setError('Enter the course title.');
      return;
    }
    if (!Number.isInteger(units) || units < 0 || units > 30) {
      setError('Enter the number of units (0 to 30).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      onSaved(await updateCatalogCourse(id, { title, units }));
    } catch (caught) {
      setError(failureText(caught, 'The change was not saved. Try again.'));
      setBusy(false);
    }
  }

  async function remove() {
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
      await removeCatalogCourse(id);
      dialogs.toast(`${course.code} was removed from the list.`);
      onRemoved();
    } catch (caught) {
      setError(failureText(caught, 'The course was not removed. Try again.'));
      setBusy(false);
    }
  }

  return (
    <EditDialog
      title={`Fix ${course.code}`}
      description="Correct the title or units. Sessions taken from now on use the new title."
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={save}
    >
      <label className="account-field">
        <span>Course title</span>
        <input name="title" defaultValue={course.title} maxLength={200} required />
      </label>
      <label className="account-field">
        <span>Units</span>
        <NumberField name="units" min={0} max={30} defaultValue={course.units ?? 3} unit="units" required />
      </label>
      <button className="lx-text-button is-danger" type="button" onClick={() => void remove()} disabled={busy}>
        Remove this course from the list
      </button>
    </EditDialog>
  );
}
