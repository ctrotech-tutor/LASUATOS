'use client';

import { courseCodeKey, type LectureCatalogCourse, type LecturerSemester } from '@lasuatos/contracts';
import { CircleCheck, KeyRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { createCourseOffering, issueCourseJoinCode } from '../../lib/course-api';
import type { Resource } from '../../lib/resource';
import { haptic } from '../../lib/use-live';
import { CoursePicker, useCourseCatalog } from '../course-picker';
import { Button, Sheet } from '../ds';
import type { IssuedCode } from './course-sheet';
import { NumberField } from '../ui/number-field';
import { Select } from '../ui/select';
import { defaultSemester, LEVELS, levelLabel, phaseOf, plural, problemText, shortDate, suggestedLevel, type Offering } from './model';

type Done = { readonly offering: Offering; readonly status: 'created' | 'already_assigned' };

/**
 * Adding a course: pick it from the course list sessions use (so registers, reports and the
 * course list agree on its code and title), its level and its semester. Then, straight away,
 * a join code for its students.
 */
export function AddCourseSheet({ open, semesters, offerings, now, onClose, onAdded, onIssued, onOpen }: Readonly<{
  open: boolean;
  semesters: Resource<readonly LecturerSemester[]> & { readonly reload: () => void };
  offerings: readonly Offering[];
  now: number;
  onClose: () => void;
  onAdded: (offering: Offering, firstCourse: boolean) => void;
  onIssued: (offering: Offering, code: IssuedCode) => void;
  onOpen: (courseOfferingId: string) => void;
}>) {
  // The form (and the course list it loads) mounts the first time the sheet opens, and starts
  // afresh each time it opens again.
  const [round, setRound] = useState(0);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setRound((value) => value + 1);
  }
  return (
    <Sheet open={open} onClose={onClose} title="Add a course">
      {round > 0 ? (
        <AddCourseForm key={round} semesters={semesters} offerings={offerings} now={now} onClose={onClose} onAdded={onAdded} onIssued={onIssued} onOpen={onOpen} />
      ) : null}
    </Sheet>
  );
}

function AddCourseForm({ semesters, offerings, now, onClose, onAdded, onIssued, onOpen }: Readonly<{
  semesters: Resource<readonly LecturerSemester[]> & { readonly reload: () => void };
  offerings: readonly Offering[];
  now: number;
  onClose: () => void;
  onAdded: (offering: Offering, firstCourse: boolean) => void;
  onIssued: (offering: Offering, code: IssuedCode) => void;
  onOpen: (courseOfferingId: string) => void;
}>) {
  const catalog = useCourseCatalog();
  const [course, setCourse] = useState<LectureCatalogCourse | null>(null);
  const [level, setLevel] = useState('');
  const [semesterId, setSemesterId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<Done | null>(null);
  const [issuing, setIssuing] = useState(false);

  const available = semesters.data ?? [];
  const chosenSemester = available.find((item) => item.id === semesterId) ?? defaultSemester(available, now);
  const levelValue = level || (course ? suggestedLevel(course.code, course.level) ?? '' : '');
  const needsUnits = course !== null && !(course.units && course.units > 0);
  const clash = course && chosenSemester && levelValue
    ? offerings.find((item) => courseCodeKey(item.courseCode) === courseCodeKey(course.code) && item.level === levelValue
      && item.semesterName === chosenSemester.name && Date.parse(item.semesterEndsAt) === Date.parse(chosenSemester.endsAt))
    : undefined;

  function pick(next: LectureCatalogCourse) {
    setCourse(next);
    setLevel('');
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!course) {
      setError('Choose the course from the list.');
      return;
    }
    if (clash) {
      onOpen(clash.courseOfferingId);
      return;
    }
    if (!levelValue) {
      setError('Choose the level it is taught at.');
      return;
    }
    if (!chosenSemester) {
      setError('Choose the semester.');
      return;
    }
    const units = needsUnits ? Number(new FormData(event.currentTarget).get('creditUnits')) : course.units ?? 0;
    if (!Number.isInteger(units) || units < 1 || units > 30) {
      setError('Units are a whole number from 1 to 30.');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await createCourseOffering({
        courseCode: course.code,
        courseTitle: course.title,
        creditUnits: units,
        semesterId: chosenSemester.id,
        level: levelValue,
      });
      const known = offerings.find((item) => item.courseOfferingId === result.course.courseOfferingId);
      const offering: Offering = known ?? {
        ...result.course,
        joinCodeActive: false,
        joinCodeIssuedAt: null,
        creditUnits: units,
        semesterStartsAt: chosenSemester.startsAt,
        students: 0,
        sessions: 0,
        openDisputes: 0,
        // The list reloads with the server's answer; until then, go by the course list.
        canEditCourse: course.canEdit && course.source === 'institution',
      };
      haptic(18);
      onAdded(offering, offerings.length === 0);
      setDone({ offering, status: result.status });
    } catch (caught) {
      setError(problemText(caught, 'The course was not added. Check your connection and try again.'));
    } finally {
      setBusy(false);
    }
  }

  /** Makes the course's first code here, then opens the course with it showing. */
  async function getCode(offering: Offering) {
    if (issuing) return;
    setIssuing(true);
    setError('');
    try {
      const result = await issueCourseJoinCode(offering.courseOfferingId);
      haptic(18);
      onIssued(offering, { code: result.code, issuedAt: new Date().toISOString(), expiresAt: result.expiresAt });
      onOpen(offering.courseOfferingId);
    } catch (caught) {
      setError(problemText(caught, 'No code was made. Check your connection and try again.'));
      setIssuing(false);
    }
  }

  if (done) {
    const ended = phaseOf(done.offering, now) === 'ended';
    const hasCode = done.offering.joinCodeActive;
    return (
      <div className="lct-done" role="status">
        <CircleCheck className="lct-done-icon" size={40} strokeWidth={2} aria-hidden="true" />
        <p className="lct-done-title">
          {done.status === 'created' ? `${done.offering.courseCode} is on your list` : `You already have ${done.offering.courseCode}`}
        </p>
        <p className="lct-done-text">
          {done.offering.courseTitle} · {levelLabel(done.offering.level)} · {done.offering.semesterName}.{' '}
          {hasCode || ended ? '' : 'Next, give its students a join code: they type it in My courses.'}
        </p>
        {error ? <p className="lct-error" role="alert">{error}</p> : null}
        <div className="lct-done-actions">
          {hasCode || ended ? (
            <Button block onClick={() => onOpen(done.offering.courseOfferingId)}>Open {done.offering.courseCode}</Button>
          ) : (
            <Button block busy={issuing} onClick={() => void getCode(done.offering)} icon={<KeyRound size={18} aria-hidden="true" />}>
              {issuing ? 'Making a code…' : 'Get a join code'}
            </Button>
          )}
          <Button block variant="gray" onClick={onClose}>Done</Button>
        </div>
      </div>
    );
  }

  if (semesters.error && !semesters.data) {
    return (
      <div className="lct-add">
        <p className="lct-error" role="alert">{semesters.error}</p>
        <Button variant="tinted" onClick={semesters.reload}>Try again</Button>
      </div>
    );
  }

  return (
    <form className="lct-add" onSubmit={(event) => void submit(event)} noValidate>
      <CoursePicker state={catalog.state} value={course?.code ?? ''} onPick={pick} onCatalogChange={catalog.replace} onRetry={catalog.retry} />

      {needsUnits ? (
        <label className="account-field">
          <span>Units</span>
          <NumberField name="creditUnits" min={1} max={30} step={1} required defaultValue={3} />
        </label>
      ) : null}

      <div className="lct-add-row">
        <label className="account-field">
          <span>Level</span>
          <Select
            value={levelValue}
            onValueChange={(next) => { setLevel(next); setError(''); }}
            placeholder="Choose"
            options={LEVELS.map((value) => ({ value, label: levelLabel(value) }))}
            aria-label="Level"
          />
        </label>
        {available.length > 1 ? (
          <label className="account-field">
            <span>Semester</span>
            <Select
              value={chosenSemester?.id ?? ''}
              onValueChange={(next) => { setSemesterId(next); setError(''); }}
              options={available.map((item) => ({ value: item.id, label: item.name, description: `${shortDate(item.startsAt, now)} to ${shortDate(item.endsAt, now)}` }))}
              aria-label="Semester"
            />
          </label>
        ) : (
          <div className="account-field">
            <span>Semester</span>
            {chosenSemester ? (
              <p className="lct-static">{chosenSemester.name}<small>until {shortDate(chosenSemester.endsAt, now)}</small></p>
            ) : <span className="ds-skeleton" style={{ height: 44, borderRadius: 12 }} />}
          </div>
        )}
      </div>

      {clash ? (
        <p className="lct-callout">
          You already have {clash.courseCode} at {levelLabel(clash.level)} this semester, with {plural(clash.students, 'student')}.
        </p>
      ) : null}
      {error ? <p className="lct-error" role="alert">{error}</p> : null}

      <Button type="submit" block busy={busy}>{clash ? `Open ${clash.courseCode}` : busy ? 'Adding…' : 'Add course'}</Button>
      <p className="lct-fine">It is offered by your department. Students only see it once they join with its code.</p>
    </form>
  );
}
