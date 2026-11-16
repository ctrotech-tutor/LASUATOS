'use client';

import { DEFAULT_ATTENDANCE_THRESHOLD, type StudentAttendanceHistory, type StudentAttendanceHistoryEntry, type StudentOpenAttendanceSession } from '@lasuatos/contracts';
import { ChevronRight, ClipboardCheck, KeyRound, ScanLine } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  checkInWithAttendanceCode,
  loadStudentAttendance,
  loadStudentAttendanceDisputes,
  loadStudentAttendanceSummary,
  loadStudentOpenAttendanceSessions,
  type CheckInLocationInput,
} from '../../lib/attendance-api';
import { firstName, greetingForNow, useCurrentAccount } from '../../lib/current-account';
import { failureText, loadStudentLectureHistory } from '../../lib/lecture-api';
import { requestLocationSample } from '../../lib/location';
import { staleResources, useResource } from '../../lib/resource';
import { haptic } from '../../lib/use-live';
import { Button, EmptyState, PageHeader, SegmentedControl, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { GuideButton } from '../shell/guide-button';
import { StudentSetupCard } from '../student-setup-card';
import { useClock } from '../take-attendance/hooks';
import { VenueGuide } from '../venue-guide';
import { useWide } from '../venues/hooks';
import { DisputeProvider, DisputesSection, DISPUTES_KEY, useDisputesHash, waitingOn } from './disputes';
import { CourseDetail, LectureRow, Ring, StatusGlyph } from './parts';
import {
  buildCourses, buildLectures, catchUp, counts, filterLectures, formatRate, groupByDay, overall, plural, recentForm, standing, STATUS_LABEL, verdict,
  type Course, type Filter, type Lecture,
} from './model';
import './my-attendance.css';

const PATH = '/attendance';
const LINE = DEFAULT_ATTENDANCE_THRESHOLD;
const PAGE = 20;
const KEYS = {
  lectures: 'student:lecture-history',
  history: 'student:attendance-history',
  summary: 'student:attendance-summary',
  open: 'student:attendance-open',
} as const;

const loadLectures = (signal: AbortSignal) => loadStudentLectureHistory(signal);
// Course check-ins (students with enrolled courses) are a second, optional source: a failure
// there must not hide lecture attendance.
const NO_HISTORY: StudentAttendanceHistory = { records: [], missed: [] };
const loadHistory = (signal: AbortSignal) => loadStudentAttendance(signal).catch(() => NO_HISTORY);
const loadDisputes = (signal: AbortSignal) => loadStudentAttendanceDisputes(signal);
const loadSummary = (signal: AbortSignal) => loadStudentAttendanceSummary(signal).then((result) => result.courses).catch(() => []);
const loadOpen = (signal: AbortSignal) => loadStudentOpenAttendanceSessions(signal).then((result) => result.sessions).catch(() => [] as StudentOpenAttendanceSession[]);

function readFilter(value: string | null): Filter {
  return value === 'missed' || value === 'removed' ? value : 'all';
}

/**
 * My attendance: where the student stands for exams (the 75% line), each course with what it
 * takes to stay above it, and every lecture held, attended, missed or removed. A course opens
 * beside the list on wide screens and in a sheet on phones; the address keeps the open course
 * and the filter (/attendance?course=ece-405&show=missed).
 */
export function MyAttendance() {
  const router = useRouter();
  const pathname = usePathname() ?? PATH;
  const params = useSearchParams();
  const slug = params.get('course');
  const filter = readFilter(params.get('show'));
  const wide = useWide();
  const now = useClock('fifteen');
  const account = useCurrentAccount();

  const lectures = useResource(KEYS.lectures, loadLectures, { maxAge: 20_000, poll: 60_000 });
  const history = useResource(KEYS.history, loadHistory, { maxAge: 20_000 });
  const disputes = useResource(DISPUTES_KEY, loadDisputes, { maxAge: 20_000, poll: 60_000, pollWhile: waitingOn });
  const summary = useResource(KEYS.summary, loadSummary, { maxAge: 20_000 });
  const open = useResource(KEYS.open, loadOpen, { maxAge: 10_000, poll: 15_000 });

  const go = useCallback((next: { course?: string | null; show?: Filter }) => {
    const query = new URLSearchParams();
    const course = next.course === undefined ? slug : next.course;
    const show = next.show ?? filter;
    if (course) query.set('course', course);
    if (show !== 'all') query.set('show', show);
    const search = query.toString();
    router.replace(search ? `${pathname}?${search}` : pathname, { scroll: false });
  }, [router, pathname, slug, filter]);
  const openCourse = useCallback((next: string | null) => go({ course: next }), [go]);

  // Escape closes the course beside the list (phones have the sheet).
  const keys = useRef({ close: () => openCourse(null), active: false });
  useEffect(() => {
    keys.current = { close: () => openCourse(null), active: wide && slug !== null };
  });
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'Escape' || !keys.current.active || event.defaultPrevented || document.querySelector('dialog[open]')) return;
      if ((event.target as HTMLElement | null)?.closest('input, textarea, [role="listbox"]')) return;
      event.preventDefault();
      keys.current.close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const all = useMemo(() => buildLectures(lectures.data ?? null, history.data?.records ?? [], history.data?.missed ?? []), [lectures.data, history.data]);
  const courses = useMemo(() => buildCourses(lectures.data ?? null, summary.data ?? [], all), [lectures.data, summary.data, all]);
  const selected = slug ? courses.find((course) => course.slug === slug) ?? null : null;

  const reloadAll = useCallback(() => {
    staleResources('student:');
    lectures.reload();
    history.reload();
    summary.reload();
    open.reload();
    disputes.reload();
  }, [lectures, history, summary, open, disputes]);

  const greeting = account === undefined ? null : account ? `${greetingForNow()}, ${firstName(account.displayName)}` : greetingForNow();
  const header = (
    <PageHeader
      eyebrow={greeting ?? <span className="ma-eyebrow-skeleton ds-skeleton" aria-hidden="true" />}
      title="My attendance"
      actions={<GuideButton page={PATH} label="My attendance" />}
    />
  );

  const openSessions = open.data ?? [];
  const recordsBySession = new Map((history.data?.records ?? []).map((record) => [record.attendanceSessionId, record]));
  const ready = lectures.data !== undefined && history.data !== undefined && summary.data !== undefined;
  // Only students on a course joined with a code can dispute; for others a failed read stays quiet.
  const joined = (summary.data?.length ?? 0) > 0 || (history.data?.records.length ?? 0) > 0;
  useDisputesHash(ready && disputes.data !== undefined);

  if (!ready) {
    return (
      <div className="ma">
        {header}
        <StudentSetupCard />
        {lectures.error && !lectures.data ? (
          <div className="ds-card">
            <EmptyState error title="Your attendance did not load" message={lectures.error} action={<Button variant="tinted" onClick={lectures.reload}>Try again</Button>} />
          </div>
        ) : <PageSkeleton />}
      </div>
    );
  }

  const nothing = all.length === 0 && courses.length === 0;
  const disputesSection = <DisputesSection data={disputes.data} error={joined ? disputes.error : undefined} onRetry={disputes.reload} />;

  return (
    <DisputeProvider data={disputes.data} now={now} onChanged={disputes.reload}>
      <div className="ma">
        {header}
        <StudentSetupCard />
        {openSessions.length ? <OpenNow sessions={openSessions} records={recordsBySession} now={now} onDone={reloadAll} /> : null}

        {nothing ? (
          <div className="ds-card ma-empty">
            <EmptyState
              icon={<ClipboardCheck size={26} strokeWidth={1.9} />}
              title="No lectures yet"
              message={`Scan the QR code in your next class. Each course then shows here with your percentage against the ${LINE}% exam line.`}
              action={<Button href="/a" variant="filled" icon={<ScanLine size={18} aria-hidden="true" />}>Scan a QR code</Button>}
            />
          </div>
        ) : (
          <>
            <div className={`ma-split${wide ? ' is-wide' : ''}`}>
              <div className="ma-main">
                <Standing courses={courses} lectures={all} onOpen={openCourse} />
                <section className="ma-section" aria-labelledby="ma-courses-title">
                  <div className="ma-section-head">
                    <h2 className="ma-section-title" id="ma-courses-title">Courses</h2>
                    <span className="ma-section-meta">{LINE}% needed for exams</span>
                  </div>
                  <ul className="ma-courses">
                    {courses.map((course) => (
                      <CourseRow key={course.slug} course={course} selected={wide && selected?.slug === course.slug} onOpen={() => openCourse(course.slug)} />
                    ))}
                  </ul>
                </section>
                {disputesSection}
              </div>
              {wide ? (
                <aside className="ma-pane" aria-label={selected ? `${selected.code} ${selected.title}` : 'Lectures'}>
                  {selected ? (
                    <div className="ma-pane-card">
                      <CourseDetail key={selected.slug} course={selected} threshold={LINE} now={now} onClose={() => openCourse(null)} />
                    </div>
                  ) : slug ? (
                    <div className="ma-pane-card"><MissingCourse onBack={() => openCourse(null)} /></div>
                  ) : (
                    <Timeline lectures={all} filter={filter} now={now} onFilter={(show) => go({ show })} />
                  )}
                </aside>
              ) : null}
            </div>
            {!wide ? <Timeline lectures={all} filter={filter} now={now} onFilter={(show) => go({ show })} /> : null}
            {!wide ? (
              <CourseSheet open={slug !== null} course={selected} now={now} onClose={() => openCourse(null)} />
            ) : null}
          </>
        )}
      </div>
    </DisputeProvider>
  );
}

/** The navy card at the top: the overall rate on a dial with the exam line, the verdict, and the latest lectures as dots. */
function Standing({ courses, lectures, onOpen }: Readonly<{ courses: readonly Course[]; lectures: readonly Lecture[]; onOpen: (slug: string) => void }>) {
  const total = overall(courses);
  const result = verdict(courses, LINE);
  const worst = [...result.below].sort((a, b) => (a.rate ?? 0) - (b.rate ?? 0))[0];
  const form = recentForm(lectures, 14);
  const formCounts = counts(form);
  return (
    <section className={`ma-hero is-${result.tone}`} aria-labelledby="ma-hero-title">
      <div className="ma-hero-top">
        <Ring rate={total.rate} threshold={LINE} tone={result.tone} size={132} stroke={12} className="ma-hero-ring">
          <span className="ma-hero-rate">{formatRate(total.rate)}</span>
          <span className="ma-hero-of">{total.attended} of {total.held}</span>
        </Ring>
        <div className="ma-hero-text">
          <p className="ma-hero-eyebrow">This semester</p>
          <h2 className="ma-hero-title" id="ma-hero-title">{result.title}</h2>
          <p className="ma-hero-line">
            {plural(total.attended, 'lecture')} attended of {total.held} across {plural(courses.length, 'course')}.
          </p>
        </div>
      </div>
      {worst ? (
        <button className="ma-hero-action" type="button" onClick={() => onOpen(worst.slug)}>
          <span>{catchUp(worst, LINE)}</span>
          <ChevronRight size={18} strokeWidth={2.4} aria-hidden="true" />
        </button>
      ) : null}
      {form.length >= 3 ? (
        <div className="ma-form">
          <p className="ma-form-label">
            <span>Last {plural(form.length, 'lecture')}</span>
            <span className="ma-form-key" aria-hidden="true">
              <i className="is-present" /> In <i className="is-missed" /> Missed{formCounts.removed ? <><i className="is-removed" /> Removed</> : null}
            </span>
          </p>
          <ol className="ma-form-dots" aria-label={`Last ${form.length} lectures, oldest first`}>
            {form.map((lecture) => (
              <li key={`${lecture.status}-${lecture.id}`} className={`is-${lecture.status}`}>
                <span className="sr-only">{lecture.courseCode}, {STATUS_LABEL[lecture.status].toLowerCase()}</span>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}

function CourseRow({ course, selected, onOpen }: Readonly<{ course: Course; selected: boolean; onOpen: () => void }>) {
  const state = standing(course, LINE);
  return (
    <li>
      <button className={`ma-course${selected ? ' is-selected' : ''}`} type="button" onClick={onOpen} aria-current={selected ? 'true' : undefined}>
        <Ring rate={course.rate} threshold={LINE} tone={state.tone} size={50} stroke={5}>
          <span className="ma-course-rate">{formatRate(course.rate)}</span>
        </Ring>
        <span className="ma-course-text">
          <span className="ma-course-code">{course.code}</span>
          <span className="ma-course-title">{course.title}</span>
          <span className={`ma-course-state is-${state.tone}`}>{state.line}</span>
        </span>
        <span className="ma-course-count" aria-hidden="true">{course.attended}/{course.held}</span>
        <ChevronRight className="ma-course-chevron" size={18} strokeWidth={2.4} aria-hidden="true" />
        <span className="sr-only">, {course.attended} of {course.held} lectures</span>
      </button>
    </li>
  );
}

/** Every lecture, newest first, by day; Missed and Removed narrow it down. */
function Timeline({ lectures, filter, now, onFilter }: Readonly<{ lectures: readonly Lecture[]; filter: Filter; now: number; onFilter: (filter: Filter) => void }>) {
  const [limit, setLimit] = useState(PAGE);
  const [lastFilter, setLastFilter] = useState(filter);
  if (filter !== lastFilter) {
    setLastFilter(filter);
    setLimit(PAGE);
  }
  const tally = counts(lectures);
  const shown = filterLectures(lectures, filter);
  const groups = groupByDay(shown.slice(0, limit), now);
  const segments = [
    { value: 'all' as const, label: 'All' },
    ...(tally.missed || filter === 'missed' ? [{ value: 'missed' as const, label: `Missed ${tally.missed}` }] : []),
    ...(tally.removed || filter === 'removed' ? [{ value: 'removed' as const, label: `Removed ${tally.removed}` }] : []),
  ];
  return (
    <section className="ma-section ma-timeline" aria-labelledby="ma-lectures-title">
      <div className="ma-section-head">
        <h2 className="ma-section-title" id="ma-lectures-title">Lectures</h2>
        <span className="ma-section-meta">{tally.present} attended</span>
      </div>
      {segments.length > 1 ? (
        <div className="ma-filter">
          <SegmentedControl segments={segments} value={filter} onChange={onFilter} label="Show lectures" block />
        </div>
      ) : null}
      {shown.length === 0 ? (
        <div className="ds-card">
          {filter === 'all' ? (
            <EmptyState
              icon={<ClipboardCheck size={26} strokeWidth={1.9} />}
              title="No lectures held yet"
              message="Each lecture of your courses shows here once it is over, attended or not."
            />
          ) : (
            <EmptyState
              icon={<StatusGlyph status={filter} size={26} />}
              title={filter === 'removed' ? 'Nothing removed' : 'Nothing missed'}
              message={filter === 'removed' ? 'None of your check-ins has been taken off.' : 'Every lecture held so far has your check-in.'}
              action={<Button variant="tinted" onClick={() => onFilter('all')}>Show all lectures</Button>}
            />
          )}
        </div>
      ) : (
        <div className="ma-days">
          {groups.map((group) => (
            <section key={group.key} className="ma-day" aria-label={group.label}>
              <h3 className="ma-day-title" aria-hidden="true">{group.label}</h3>
              <ul className="ma-lectures">
                {group.items.map((lecture) => <LectureRow key={`${lecture.status}-${lecture.id}`} lecture={lecture} now={now} />)}
              </ul>
            </section>
          ))}
          {shown.length > limit ? (
            <button className="ma-more" type="button" onClick={() => setLimit((value) => value + PAGE)}>
              Show {Math.min(PAGE, shown.length - limit)} more <span className="ma-more-of">of {shown.length - limit}</span>
            </button>
          ) : null}
        </div>
      )}
    </section>
  );
}

function CourseSheet({ open, course, now, onClose }: Readonly<{ open: boolean; course: Course | null; now: number; onClose: () => void }>) {
  // Keep the last course on screen while the sheet slides away.
  const [last, setLast] = useState(course);
  if (course && course !== last) setLast(course);
  const shown = open ? course : last;
  return (
    <Sheet open={open} onClose={onClose} title={shown ? shown.code : 'Course'} size="wide">
      {shown ? <CourseDetail key={shown.slug} course={shown} threshold={LINE} now={now} inSheet /> : open ? <MissingCourse onBack={onClose} /> : null}
    </Sheet>
  );
}

function MissingCourse({ onBack }: Readonly<{ onBack: () => void }>) {
  return (
    <EmptyState
      icon={<ClipboardCheck size={26} strokeWidth={1.9} />}
      title="That course isn’t in your attendance"
      message="A course shows here once you have marked attendance in one of its lectures."
      action={<Button variant="tinted" onClick={onBack}>Back to all courses</Button>}
    />
  );
}

function closesIn(endsAt: string, now: number): string {
  const minutes = Math.max(0, Math.round((Date.parse(endsAt) - now) / 60_000));
  if (minutes < 1) return 'Closing now';
  if (minutes < 60) return `Closes in ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `Closes in ${hours} h${minutes % 60 ? ` ${minutes % 60} min` : ''}`;
}

/** Course check-ins open right now (students with enrolled courses only). */
function OpenNow({ sessions, records, now, onDone }: Readonly<{
  sessions: readonly StudentOpenAttendanceSession[];
  records: ReadonlyMap<string, StudentAttendanceHistoryEntry>;
  now: number;
  onDone: () => void;
}>) {
  // The check-in page links here with #code for students who want to type the code.
  const [codeOpen, setCodeOpen] = useState(() => typeof window !== 'undefined' && window.location.hash === '#code');
  const typable = sessions.some((session) => !session.qrOnly);
  return (
    <section className="ma-section ma-open" aria-labelledby="ma-open-title" aria-live="polite">
      <div className="ma-section-head">
        <h2 className="ma-section-title" id="ma-open-title"><span className="ma-live-dot" aria-hidden="true" />Open now</h2>
        <span className="ma-section-meta">Course check-in</span>
      </div>
      <ul className="ma-open-list">
        {sessions.map((session) => {
          const record = records.get(session.attendanceSessionId);
          const present = record?.status === 'present';
          return (
            <li key={session.attendanceSessionId} className={`ma-open-card${present ? ' is-done' : ''}`}>
              <div className="ma-open-top">
                <span className="ma-open-code">{session.courseCode}</span>
                <span className="ma-open-time">{closesIn(session.endsAt, now)}</span>
              </div>
              <p className="ma-open-title">{session.sessionTitle}</p>
              <p className="ma-open-course">{session.courseTitle}</p>
              {present ? (
                <p className="ma-open-done"><StatusGlyph status="present" size={18} /> You’re checked in</p>
              ) : (
                <div className="ma-open-actions">
                  <Button href="/a" variant="filled" size="sm" icon={<ScanLine size={16} aria-hidden="true" />}>Scan the QR code</Button>
                  {!session.qrOnly ? <Button variant="tinted" size="sm" icon={<KeyRound size={16} aria-hidden="true" />} onClick={() => setCodeOpen(true)}>Type the code</Button> : null}
                </div>
              )}
              {session.venueName ? <div className="ma-open-venue"><VenueGuide venueName={session.venueName} guide={session.venueGuide} checkedIn={present} /></div> : null}
            </li>
          );
        })}
      </ul>
      {typable ? <CodeSheet open={codeOpen} needsLocation={sessions.some((session) => session.locationRequired)} onClose={() => setCodeOpen(false)} onDone={onDone} /> : null}
    </section>
  );
}

function CodeSheet({ open, needsLocation, onClose, onDone }: Readonly<{ open: boolean; needsLocation: boolean; onClose: () => void; onDone: () => void }>) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const code = String(new FormData(form).get('code') ?? '');
    setBusy(true);
    setError('');
    try {
      let location: CheckInLocationInput | undefined;
      if (needsLocation) location = (await requestLocationSample()) ?? undefined;
      const result = await checkInWithAttendanceCode(code, location);
      haptic([16, 60, 24]);
      feedback.toast(`${result.status === 'checked_in' ? 'Checked in to' : 'Already checked in to'} ${result.attendance.courseCode}`);
      form.reset();
      onClose();
      onDone();
    } catch (caught) {
      setError(failureText(caught, 'That code did not work. Check it and try again.'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="Type the session code">
      <form className="ma-code-form" onSubmit={submit}>
        <label className="ma-code-label" htmlFor="ma-code">The code under the QR code on the lecturer’s screen</label>
        <input
          id="ma-code"
          className="ma-code-input"
          name="code"
          type="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="7K9M-PQ2R-4XBD"
          maxLength={24}
          required
          aria-describedby={error ? 'ma-code-error' : 'ma-code-note'}
          aria-invalid={error ? true : undefined}
        />
        {error ? <p className="ma-code-error" id="ma-code-error" role="alert">{error}</p> : (
          <p className="ma-code-note" id="ma-code-note">Not the course code you joined with.{needsLocation ? ' Your phone will ask for your location: tap Allow.' : ''}</p>
        )}
        <Button type="submit" variant="filled" block busy={busy} disabled={busy}>{busy ? 'Checking in…' : 'Check in'}</Button>
      </form>
    </Sheet>
  );
}

function PageSkeleton() {
  return (
    <div className="ma-skeleton" role="status" aria-label="Loading your attendance">
      <div className="ma-hero is-skeleton" aria-hidden="true">
        <div className="ma-hero-top">
          <span className="ma-skeleton-ring" />
          <span className="ma-hero-text">
            <span className="ma-skeleton-line" style={{ width: '40%' }} />
            <span className="ma-skeleton-line is-big" style={{ width: '75%' }} />
            <span className="ma-skeleton-line" style={{ width: '90%' }} />
          </span>
        </div>
      </div>
      <ul className="ma-courses" aria-hidden="true">
        {[1, 2, 3].map((item) => (
          <li key={item} className="ma-course is-skeleton">
            <span className="ds-skeleton" style={{ width: 50, height: 50, borderRadius: '50%' }} />
            <span className="ma-course-text">
              <span className="ds-skeleton" style={{ width: '30%', height: 16 }} />
              <span className="ds-skeleton" style={{ width: '70%', height: 14 }} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
