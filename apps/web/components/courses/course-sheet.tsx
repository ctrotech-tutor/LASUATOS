'use client';

import { type LectureCatalogCourse } from '@lasuatos/contracts';
import { ClipboardList, Eye, EyeOff, MoreHorizontal, Pencil, Trash2, TriangleAlert, Undo2 } from 'lucide-react';
import { useState } from 'react';
import { failureText, removeCatalogCourse, updateCatalogCourse } from '../../lib/lecture-api';
import { changeSummary } from '../course-picker';
import { Badge, Button, Menu, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { registerHref } from '../registers/href';
import { checkText, exactTime, kindOf, levelLabel, plural, semesterLabel, taughtLabel, unitsLabel, wasCode, type Check } from './format';

/** One course: what it is, where it comes from, how much it's used, and what can be done with it. */
export function CourseSheet({ course, checks, canManage, now, onClose, onEdit, onOpenCode, onChanged, onRemoved }: Readonly<{
  course: LectureCatalogCourse | null;
  checks: readonly Check[];
  canManage: boolean;
  now: number;
  onClose: () => void;
  onEdit: (course: LectureCatalogCourse) => void;
  onOpenCode: (code: string) => void;
  onChanged: (before: LectureCatalogCourse, after: LectureCatalogCourse) => void;
  onRemoved: (course: LectureCatalogCourse) => void;
}>) {
  // Keep the last course while the sheet animates closed.
  const [last, setLast] = useState(course);
  if (course && course !== last) setLast(course);
  const shown = course ?? last;
  return (
    <Sheet open={course !== null} onClose={onClose} title={shown?.code ?? ''}>
      {shown ? (
        <CourseDetail
          key={shown.code}
          course={shown}
          checks={course ? checks : []}
          canManage={canManage}
          now={now}
          onEdit={onEdit}
          onOpenCode={onOpenCode}
          onChanged={onChanged}
          onRemoved={onRemoved}
        />
      ) : null}
    </Sheet>
  );
}

function CourseDetail({ course, checks, canManage, now, onEdit, onOpenCode, onChanged, onRemoved }: Readonly<{
  course: LectureCatalogCourse;
  checks: readonly Check[];
  canManage: boolean;
  now: number;
  onEdit: (course: LectureCatalogCourse) => void;
  onOpenCode: (code: string) => void;
  onChanged: (before: LectureCatalogCourse, after: LectureCatalogCourse) => void;
  onRemoved: (course: LectureCatalogCourse) => void;
}>) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const kind = kindOf(course);
  const was = wasCode(course);
  const semester = semesterLabel(course.semester);
  // Built-in courses are changed by faculty and institution administrators; anything added here by any administrator.
  const canHide = course.canEdit && (canManage || course.id !== null);
  // Removing an added course that was never taught changes nothing else. Removing a change brings the
  // built-in course back; if the code changed, only while no session uses the new code.
  const canRemove = course.canEdit && course.id !== null && kind === 'added' && course.sessionCount === 0;
  const canUndo = course.canEdit && course.id !== null && kind === 'changed' && (course.sessionCount === 0 || !was);

  async function setHidden(hidden: boolean) {
    if (hidden && course.sessionCount > 0) {
      const sure = await feedback.confirm({
        title: `Hide ${course.code}?`,
        body: `Nobody can pick it for a new session. Its ${plural(course.sessionCount, 'session')} and register stay as they are, and you can show it again any time.`,
        confirmLabel: 'Hide course',
      });
      if (!sure) return;
    }
    setBusy(true);
    try {
      const result = await updateCatalogCourse({ id: course.id, code: course.code }, { hidden });
      feedback.toast(changeSummary(course, result));
      onChanged(course, result.course);
      // The button that was used is replaced (Hide becomes Show again); keep focus in the sheet.
      window.requestAnimationFrame(() => {
        if (document.activeElement === document.body) document.querySelector<HTMLElement>('.crs-actions button')?.focus();
      });
    } catch (caught) {
      feedback.toast(failureText(caught, hidden ? 'The course was not hidden. Try again.' : 'The course was not shown again. Try again.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!course.id) return;
    const undo = kind === 'changed';
    const sure = await feedback.confirm(undo
      ? {
        title: `Undo the changes to ${was ?? course.code}?`,
        body: was
          ? `${course.code} goes back to ${was} as on the built-in list, with the built-in title and units.`
          : 'It goes back to the built-in title and units. Sessions already taken keep theirs.',
        confirmLabel: 'Undo changes',
      }
      : {
        title: `Remove ${course.code} from the list?`,
        body: 'It was never taught, so nothing else changes. Anyone can add it again later.',
        confirmLabel: 'Remove course',
        tone: 'danger',
      });
    if (!sure) return;
    setBusy(true);
    try {
      await removeCatalogCourse(course.id);
      feedback.toast(undo ? `${was ?? course.code} is back to the built-in version.` : `${course.code} was removed from the list.`);
      onRemoved(course);
    } catch (caught) {
      feedback.toast(failureText(caught, 'The course was not removed. Try again.'), 'error');
      setBusy(false);
    }
  }

  return (
    <div className="crs-detail">
      <div className="crs-detail-head">
        <div className="crs-detail-badges">
          {course.hidden ? <Badge tone="neutral"><EyeOff size={12} strokeWidth={2.4} aria-hidden="true" /> Hidden</Badge> : null}
          {kind === 'added' ? <Badge tone="tint">Added here</Badge> : kind === 'changed' ? <Badge tone="accent">Changed here</Badge> : <Badge tone="neutral">Built-in</Badge>}
        </div>
        <h3 className="crs-detail-title">{course.title}</h3>
        <p className="crs-detail-facts">{[unitsLabel(course.units), semester, levelLabel(course.level), course.group].filter(Boolean).join(' · ')}</p>
      </div>

      {course.hidden ? (
        <p className="crs-callout">
          <EyeOff size={18} aria-hidden="true" />
          <span>Hidden: nobody can pick it for a new session. Sessions already taken keep it, and so does its register.</span>
        </p>
      ) : null}

      {checks.length ? (
        <ul className="crs-checks" aria-label="Needs a look">
          {checks.map((check) => {
            const text = checkText(check);
            return (
              <li key={check.kind} className="crs-check">
                <TriangleAlert className="crs-check-icon" size={18} strokeWidth={2.2} aria-hidden="true" />
                <div className="crs-check-body">
                  <strong>{text.title}</strong>
                  <p>{text.detail}</p>
                  {check.kind === 'same_title' ? (
                    <div className="crs-check-links">
                      {check.others.map((code) => (
                        <Button key={code} size="sm" variant="tinted" onClick={() => onOpenCode(code)}>Open {code}</Button>
                      ))}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="crs-actions">
        {course.canEdit ? (
          <Button variant="gray" onClick={() => onEdit(course)} icon={<Pencil size={18} aria-hidden="true" />}>Edit</Button>
        ) : null}
        {course.sessionCount > 0 ? (
          <Button variant="gray" href={registerHref(course.code)} icon={<ClipboardList size={18} aria-hidden="true" />}>Open register</Button>
        ) : null}
        {canHide && course.hidden ? (
          <Button variant="gray" busy={busy} onClick={() => void setHidden(false)} icon={<Eye size={18} aria-hidden="true" />}>Show again</Button>
        ) : null}
        {canHide && !course.hidden ? (
          <Menu
            label={`More actions for ${course.code}`}
            title={`${course.code} · ${course.title}`}
            icon={<MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" />}
            items={[
              { label: 'Hide from the list', icon: <EyeOff size={18} aria-hidden="true" />, onSelect: () => void setHidden(true) },
              canUndo ? { label: 'Undo changes here', icon: <Undo2 size={18} aria-hidden="true" />, onSelect: () => void remove() } : null,
              canRemove ? { label: 'Remove from the list', icon: <Trash2 size={18} aria-hidden="true" />, destructive: true, onSelect: () => void remove() } : null,
            ]}
          />
        ) : null}
      </div>
      {!course.canEdit ? (
        <p className="crs-fine">Built-in courses are changed by a faculty or institution administrator. You can correct courses added here.</p>
      ) : null}

      <div className="crs-figures">
        <div><strong>{course.sessionCount.toLocaleString('en-NG')}</strong><span>{course.sessionCount === 1 ? 'session taken' : 'sessions taken'}</span></div>
        <div><strong>{taughtLabel(course.lastSessionAt, now)}</strong><span>last taught</span></div>
        <div><strong>{course.units ?? '—'}</strong><span>{course.units === 1 ? 'unit' : 'units'}</span></div>
      </div>

      <section className="crs-block" aria-labelledby="crs-about">
        <h4 className="crs-block-title" id="crs-about">About</h4>
        <dl className="crs-facts">
          <div><dt>Comes from</dt><dd>{kind === 'added' ? 'Added here' : 'Built-in list (NUC CCMAS 2022)'}</dd></div>
          {was ? <div><dt>Built-in code</dt><dd>{was}, now {course.code} here</dd></div> : null}
          {kind === 'changed' && !was ? <div><dt>Changed</dt><dd>Title or units set here</dd></div> : null}
          {kind === 'added' ? <div><dt>Added by</dt><dd>{course.addedByName ?? 'Someone no longer here'}</dd></div> : null}
          <div><dt>Group</dt><dd>{course.group}</dd></div>
          <div><dt>Semester</dt><dd>{semester ?? 'Not set'}</dd></div>
          {course.lastSessionAt ? <div><dt>Last session</dt><dd>{exactTime(course.lastSessionAt)}</dd></div> : null}
        </dl>
      </section>
    </div>
  );
}
