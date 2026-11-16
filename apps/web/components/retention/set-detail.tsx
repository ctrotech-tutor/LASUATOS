'use client';

import type { RetentionPolicy, RetentionSet, RetentionSetDetail, RetentionStudent, RetentionStudentState } from '@lasuatos/contracts';
import { ChevronRight, Link2, ListChecks, X } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, buttonClassName, EmptyState } from '../ds';
import { SearchField } from '../ui/search-field';
import {
  classListHref, countStates, filterStudents, formatDay, formatMonth, nextRun, plural, relativeDay, setStatus, setTimeline, setTitle, STATE_LABEL, STATE_ORDER,
  STATE_SHORT, STATE_TONE, STATUS_LABEL, STATUS_TONE, studentLine, type SetStatus,
} from './format';

type Filter = RetentionStudentState | 'all';

/** One set: where it is between starting and its deadline, what happens next, and every student. */
export function SetDetailView({ set, detail, error, onRetry, policy, today, now, scheduled, inSheet, onClose, onCopyLink }: Readonly<{
  set: RetentionSet;
  detail: RetentionSetDetail | null;
  error: string | null;
  onRetry: () => void;
  policy: RetentionPolicy;
  today: string;
  now: number;
  scheduled: boolean;
  inSheet: boolean;
  onClose?: (() => void) | undefined;
  onCopyLink: () => void;
}>) {
  const status = setStatus(set, today);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const students = detail?.students ?? [];
  const counts = countStates(students);
  const shown = filterStudents(students, filter, query);
  const filters: Filter[] = ['all', ...STATE_ORDER.filter((state) => counts[state] > 0)];

  return (
    <article className="rt-detail" tabIndex={-1} aria-labelledby={inSheet ? undefined : 'rt-detail-title'}>
      {!inSheet ? (
        <div className="rt-detail-bar">
          <Badge tone={STATUS_TONE[status]} dot>{STATUS_LABEL[status]}</Badge>
          <div className="rt-detail-tools">
            <button className="ds-icon-btn" type="button" aria-label="Copy link to this set" data-tip="Copy link" onClick={onCopyLink}>
              <Link2 size={17} strokeWidth={2.3} aria-hidden="true" />
            </button>
            {onClose ? (
              <button className="ds-icon-btn" type="button" aria-label="Close the set" data-tip="Close (Esc)" onClick={onClose}>
                <X size={18} strokeWidth={2.4} aria-hidden="true" />
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <header className="rt-detail-head">
        {inSheet ? <div><Badge tone={STATUS_TONE[status]} dot>{STATUS_LABEL[status]}</Badge></div> : null}
        {!inSheet ? <h2 className="rt-detail-title" id="rt-detail-title">{setTitle(set)} set</h2> : null}
        <p className="rt-detail-sub">{set.departmentName} · {set.programmeYears}-year programme</p>
      </header>

      <Timeline set={set} today={today} status={status} />

      <p className={`rt-callout is-${status}`}>{statusSentence(set, status, policy, today, now, scheduled)}</p>

      {status === 'due' || status === 'kept' ? (
        <dl className="rt-figures">
          <div><dt>Students</dt><dd>{set.students.toLocaleString('en-NG')}</dd></div>
          <div><dt>Faces stored</dt><dd>{set.faces.toLocaleString('en-NG')}</dd></div>
          <div className={set.dueFaces ? 'is-due' : undefined}><dt>Due now</dt><dd>{set.dueFaces.toLocaleString('en-NG')}</dd></div>
          <div><dt>Kept, checking in</dt><dd>{set.keptActive.toLocaleString('en-NG')}</dd></div>
        </dl>
      ) : (
        <dl className="rt-figures is-three">
          <div><dt>Students</dt><dd>{set.students.toLocaleString('en-NG')}</dd></div>
          <div><dt>Faces stored</dt><dd>{set.faces.toLocaleString('en-NG')}</dd></div>
          <div><dt>No face</dt><dd>{Math.max(0, set.students - set.faces).toLocaleString('en-NG')}</dd></div>
        </dl>
      )}

      <section className="rt-block" aria-labelledby="rt-students-title">
        <div className="rt-block-head">
          <h3 className="rt-block-title" id="rt-students-title">Students</h3>
          <Link className={buttonClassName({ variant: 'gray', size: 'sm' })} href={classListHref(set)}>
            <ListChecks size={16} strokeWidth={2.3} aria-hidden="true" />
            Class list
          </Link>
        </div>

        {detail ? (
          <>
            {filters.length > 2 ? (
              <div className="rt-chips is-small" role="group" aria-label="Show students">
                {filters.map((value) => (
                  <button key={value} className={`rt-chip${filter === value ? ' is-on' : ''}`} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
                    {value !== 'all' ? <span className={`rt-dot is-${value}`} aria-hidden="true" /> : null}
                    <span>{value === 'all' ? 'All' : STATE_SHORT[value]}</span>
                    <span className="rt-chip-count">{value === 'all' ? students.length : counts[value]}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {students.length > 10 ? (
              <SearchField className="rt-student-find" value={query} onValueChange={setQuery} placeholder="Name or matric number" aria-label="Search this set" />
            ) : null}
            {shown.length ? (
              <ul className="ds-list rt-students">
                {shown.map((student) => <StudentRow key={student.matricNumber} student={student} set={set} policy={policy} now={now} />)}
              </ul>
            ) : (
              <p className="rt-none">{query.trim() ? `No student matches “${query.trim()}”.` : 'No student here.'}</p>
            )}
            {detail.truncated ? <p className="rt-none">The first {students.length.toLocaleString('en-NG')} students are shown. Search the class list for the rest.</p> : null}
          </>
        ) : error ? (
          <EmptyState error title="The students did not load" message={error} action={<Button variant="tinted" onClick={onRetry}>Try again</Button>} />
        ) : (
          <div className="rt-students-skeleton" role="status" aria-label="Loading the students">
            {[70, 55, 64, 48].map((width) => <span key={width} className="ds-skeleton" style={{ width: `${width}%` }} />)}
          </div>
        )}
      </section>
    </article>
  );
}

function statusSentence(set: RetentionSet, status: SetStatus, policy: RetentionPolicy, today: string, now: number, scheduled: boolean): string {
  const when = scheduled ? nextRun(now || Date.parse(`${today}T12:00:00Z`)).phrase : 'when someone deletes what is due here';
  switch (status) {
    case 'due':
      return `${plural(set.dueFaces, 'face')} ${set.dueFaces === 1 ? 'goes' : 'go'} ${scheduled ? `at the clean-up ${when}` : when}.${set.keptActive ? ` ${plural(set.keptActive, 'student')} who checked in within ${policy.activeWithinDays} days ${set.keptActive === 1 ? 'keeps theirs' : 'keep theirs'} until they stop.` : ''}`;
    case 'kept':
      return `Every face left belongs to a student who checked in within ${policy.activeWithinDays} days. Each one goes ${policy.activeWithinDays} days after that student’s last check-in.`;
    case 'coming':
      return set.faces
        ? `Faces stay until ${formatDay(set.dueOn)} (${relativeDay(set.dueOn, today)}). After that, a student who has not checked in for ${policy.activeWithinDays} days loses theirs at the next clean-up.`
        : `No face is registered in this set, so nothing will be deleted on ${formatDay(set.dueOn)}.`;
    default:
      return 'No face data is left for this set. Accounts, the class list and attendance records stay, and a student who comes back can register again.';
  }
}

/** Started → finished → faces due, with today marked. */
function Timeline({ set, today, status }: Readonly<{ set: RetentionSet; today: string; status: SetStatus }>) {
  const line = setTimeline(set, today);
  return (
    <div className={`rt-timeline is-${status}`}>
      <span className="rt-track" aria-hidden="true">
        <span className="rt-track-fill" style={{ width: `${line.today * 100}%` }} />
        <span className="rt-track-mark is-finish" style={{ left: `${line.finished * 100}%` }} />
        <span className="rt-track-today" style={{ left: `${line.today * 100}%` }} />
      </span>
      <ol className="rt-steps">
        <li><span className="rt-step-label">Started</span><span className="rt-step-date">{formatMonth(line.started)}</span></li>
        <li><span className="rt-step-label">Finished</span><span className="rt-step-date">{formatDay(set.finishedOn)}</span></li>
        <li><span className="rt-step-label">Faces due</span><span className="rt-step-date">{formatDay(set.dueOn)}</span></li>
      </ol>
    </div>
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1]![0] : '')).toUpperCase() || '?';
}

function StudentRow({ student, set, policy, now }: Readonly<{ student: RetentionStudent; set: RetentionSet; policy: RetentionPolicy; now: number }>) {
  return (
    <li>
      <Link className="ds-row rt-student" href={classListHref(set, student.matricNumber)}>
        <span className={`rt-avatar is-${student.state}`} aria-hidden="true">{initials(student.name)}</span>
        <span className="ds-row-body rt-student-body">
          <span className="rt-student-top">
            <span className="ds-row-title rt-student-name">{student.name}</span>
            <Badge tone={STATE_TONE[student.state]}>{STATE_LABEL[student.state]}</Badge>
          </span>
          <span className="rt-student-matric">{student.matricNumber}</span>
          <span className="rt-student-line">
            {now ? studentLine(student, policy, now) : null}
            {student.checkPhotos ? ` · ${plural(student.checkPhotos, 'check-in photo')}` : ''}
          </span>
        </span>
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </Link>
    </li>
  );
}
