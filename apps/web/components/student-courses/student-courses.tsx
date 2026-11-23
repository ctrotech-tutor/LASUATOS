'use client';

import { DEFAULT_ATTENDANCE_THRESHOLD, type JoinCourseResponse, type StudentAttendanceCourseSummary, type StudentEnrollment } from '@lasuatos/contracts';
import { ArrowRight, ChevronRight, CircleCheck, GraduationCap, KeyRound, TriangleAlert } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { loadStudentAttendanceSummary } from '../../lib/attendance-api';
import { joinCourse, loadStudentEnrollments } from '../../lib/course-api';
import { firstName, greetingForNow, useCurrentAccount } from '../../lib/current-account';
import { primeResource, staleResources, useResource } from '../../lib/resource';
import { haptic } from '../../lib/use-live';
import { Button, EmptyState, PageHeader, RateMeter } from '../ds';
import { GuideButton } from '../shell/guide-button';
import { useClock } from '../take-attendance/hooks';
import { LevelCard } from './level';
import {
  backspacedDash,
  caretAfter,
  codeCharsBefore,
  courseLine,
  groupCourses,
  JOIN_CODE_LENGTH,
  joinFailure,
  misreadHint,
  plural,
  readJoinCode,
  type CourseItem,
  type JoinFailure,
} from './model';
import './student-courses.css';

const PATH = '/courses';
const LINE = DEFAULT_ATTENDANCE_THRESHOLD;
/** The summary key is shared with My attendance, so both pages read one answer. */
const KEYS = { enrollments: 'student:enrollments', summary: 'student:attendance-summary' } as const;

async function loadEnrollments(signal: AbortSignal): Promise<readonly StudentEnrollment[]> {
  try {
    return (await loadStudentEnrollments(signal)).enrollments;
  } catch (caught) {
    if (caught instanceof DOMException) throw caught;
    const message = caught && typeof caught === 'object' && 'message' in caught && typeof caught.message === 'string' ? caught.message : '';
    throw new Error(message || 'Your courses did not load. Check your connection and try again.');
  }
}
// Attendance is extra on this page: without it the courses still show.
const loadSummary = (signal: AbortSignal) => loadStudentAttendanceSummary(signal).then((result) => result.courses).catch(() => [] as StudentAttendanceCourseSummary[]);

/**
 * My courses: join a course with the code from its lecturer, then see each course with the
 * attendance so far (opening it in My attendance), and the level read from the matric number.
 * /courses#join puts the cursor in the code field (the check-in screen links there).
 */
export function StudentCourses() {
  const account = useCurrentAccount();
  const now = useClock('fifteen');
  const enrollments = useResource(KEYS.enrollments, loadEnrollments, { maxAge: 20_000 });
  const summary = useResource(KEYS.summary, loadSummary, { maxAge: 20_000 });
  const [fresh, setFresh] = useState<string | null>(null);

  const groups = enrollments.data ? groupCourses(enrollments.data, summary.data ?? [], now) : null;
  const tracked = new Set((summary.data ?? []).map((course) => course.courseOfferingId));

  function joined(result: JoinCourseResponse) {
    const current = enrollments.data ?? [];
    if (!current.some((item) => item.courseOfferingId === result.course.courseOfferingId)) {
      primeResource(KEYS.enrollments, [...current, { ...result.course, enrolledAt: new Date().toISOString() }]);
    }
    setFresh(result.course.courseOfferingId);
    // A new course changes My attendance and the menu, so they ask again next time.
    staleResources('student:');
    enrollments.reload();
    summary.reload();
  }

  const greeting = account === undefined ? null : account ? `${greetingForNow()}, ${firstName(account.displayName)}` : greetingForNow();
  const subtitle = groups
    ? groups.current.length ? `${plural(groups.current.length, 'course')} this semester` : groups.earlier.length ? 'No courses this semester yet' : null
    : null;

  return (
    <div className="stc">
      <PageHeader
        eyebrow={greeting ?? <span className="stc-eyebrow-skeleton ds-skeleton" aria-hidden="true" />}
        title="My courses"
        subtitle={subtitle}
        actions={<GuideButton page={PATH} label="My courses" />}
      />

      <JoinCard onJoined={joined} />

      {groups ? (
        groups.current.length + groups.earlier.length === 0 ? (
          <div className="ds-card stc-empty">
            <EmptyState
              icon={<GraduationCap size={26} strokeWidth={1.9} />}
              title="No courses yet"
              message="Type the code from your lecturer above. Each course then shows here with your attendance."
            />
          </div>
        ) : (
          <>
            {groups.current.length ? (
              <CourseSection id="stc-current" title="This semester" courses={groups.current} tracked={tracked} fresh={fresh} aside={`${LINE}% needed for exams`} />
            ) : null}
            {groups.earlier.length ? (
              <CourseSection id="stc-earlier" title="Earlier" courses={groups.earlier} tracked={tracked} fresh={fresh} />
            ) : null}
          </>
        )
      ) : enrollments.error ? (
        <div className="ds-card">
          <EmptyState error title="Your courses did not load" message={enrollments.error} action={<Button variant="tinted" onClick={enrollments.reload}>Try again</Button>} />
        </div>
      ) : <CoursesSkeleton />}

      <LevelCard />
    </div>
  );
}

function CourseSection({ id, title, aside, courses, tracked, fresh }: Readonly<{
  id: string;
  title: string;
  aside?: string;
  courses: readonly CourseItem[];
  tracked: ReadonlySet<string>;
  fresh: string | null;
}>) {
  return (
    <section className="ds-section" aria-labelledby={`${id}-title`}>
      <div className="ds-section-head">
        <h2 className="ds-section-title" id={`${id}-title`}>{title}</h2>
        {aside ? <span className="ds-section-aside">{aside}</span> : null}
      </div>
      <ul className="ds-list stc-list">
        {courses.map((course) => (
          <CourseRow key={course.courseOfferingId} course={course} linked={tracked.has(course.courseOfferingId)} fresh={fresh === course.courseOfferingId} />
        ))}
      </ul>
    </section>
  );
}

/** One course: its code and title, level and semester, and attendance so far against the line. */
function CourseRow({ course, linked, fresh }: Readonly<{ course: CourseItem; linked: boolean; fresh: boolean }>) {
  const row = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (fresh) row.current?.scrollIntoView({ block: 'nearest', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }, [fresh]);
  const content = (
    <>
      <span className="ds-row-body">
        <span className="stc-code">{course.courseCode}{fresh ? <span className="stc-new">Just joined</span> : null}</span>
        <span className="ds-row-title stc-title">{course.courseTitle}</span>
        <span className="ds-row-subtitle stc-meta">{courseLine(course)}</span>
      </span>
      {course.held ? (
        <span className="stc-rate">
          <RateMeter rate={course.rate} threshold={LINE} />
          <span className="stc-of" aria-hidden="true">{course.attended} of {course.held}</span>
        </span>
      ) : <span className="stc-none">No classes yet</span>}
      <span className="sr-only">{course.held ? `, attended ${course.attended} of ${plural(course.held, 'class', 'classes')}` : ''}</span>
    </>
  );
  return (
    <li ref={row} className={fresh ? 'is-fresh' : undefined}>
      {linked ? (
        <Link className="ds-row stc-row" href={`/attendance?course=${course.slug}`}>
          {content}
          <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
        </Link>
      ) : <div className="ds-row stc-row">{content}</div>}
    </li>
  );
}

/**
 * The code field: groups the code as ABCD-EFGH-JKLM while it is typed or pasted, keeps the
 * caret where it was, and flags characters codes never use before anything is sent.
 */
function JoinCard({ onJoined }: Readonly<{ onJoined: (result: JoinCourseResponse) => void }>) {
  // /courses?code=7K9M-PQ2R-4XBD (the link a lecturer shares): the code is filled in, ready to join.
  const [value, setValue] = useState(() => readJoinCode(new URLSearchParams(window.location.search).get('code') ?? '').display);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<JoinFailure | null>(null);
  const [tooShort, setTooShort] = useState(false);
  const [done, setDone] = useState<JoinCourseResponse | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const caret = useRef<number | null>(null);
  const input = readJoinCode(value);

  useLayoutEffect(() => {
    const element = field.current;
    if (caret.current === null || !element || document.activeElement !== element) return;
    element.setSelectionRange(caret.current, caret.current);
    caret.current = null;
  });

  // /courses#join, or a shared link with the code: ready to type or join.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linked = params.has('code');
    if (linked) {
      params.delete('code');
      const query = params.toString();
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
    }
    if (window.location.hash !== '#join' && !linked) return;
    field.current?.focus();
    field.current?.scrollIntoView({ block: 'center' });
  }, []);

  function change(event: ChangeEvent<HTMLInputElement>) {
    const typed = event.target.value;
    const position = event.target.selectionStart ?? typed.length;
    const result = backspacedDash(value, typed, position) ?? { code: typed, before: codeCharsBefore(typed, position) };
    const next = readJoinCode(result.code);
    caret.current = caretAfter(next.display, result.before);
    setValue(next.display);
    setFailure(null);
    setTooShort(false);
    if (next.code) setDone(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (input.misread.length) {
      field.current?.focus();
      return;
    }
    if (!input.complete) {
      setTooShort(true);
      field.current?.focus();
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const result = await joinCourse(input.code);
      haptic(18);
      setValue('');
      setDone(result);
      onJoined(result);
    } catch (caught) {
      setFailure(joinFailure(caught));
      haptic([30, 60, 30]);
    } finally {
      setBusy(false);
    }
  }

  const invalid = input.misread.length > 0 || tooShort || failure !== null;
  const hint = input.misread.length ? misreadHint(input.misread)
    : tooShort ? `A course code has ${JOIN_CODE_LENGTH} characters. This one has ${input.code.length}.`
      : failure ? null
        : <>Your lecturer gives it out — from Course tools, under the course, “Get a join code” — e.g. <span className="stc-nowrap">7K9M-PQ2R-4XBD</span>. Joining adds the course here; in class you still scan to be marked present.</>;

  return (
    <section className="stc-join" id="join" aria-labelledby="stc-join-title">
      <form className="stc-join-form" onSubmit={(event) => void submit(event)} noValidate>
        <label className="stc-join-label" id="stc-join-title" htmlFor="stc-join-input">
          <KeyRound size={16} strokeWidth={2.2} aria-hidden="true" /> Join a course
        </label>
        <div className={`stc-field${invalid ? ' is-invalid' : ''}`}>
          <input
            ref={field}
            id="stc-join-input"
            className="stc-input"
            value={value}
            onChange={change}
            placeholder="XXXX-XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            inputMode="text"
            maxLength={32}
            aria-invalid={invalid ? true : undefined}
            aria-describedby="stc-join-hint"
            disabled={busy}
          />
          <button className={`stc-go${input.complete ? ' is-ready' : ''}`} type="submit" aria-label="Join the course" aria-busy={busy ? true : undefined}>
            {busy ? <span className="stc-spinner" aria-hidden="true" /> : <ArrowRight size={20} strokeWidth={2.4} aria-hidden="true" />}
          </button>
        </div>
        <div id="stc-join-hint" aria-live="polite">
          {failure ? (
            <p className="stc-failure" role="alert">
              <TriangleAlert size={16} strokeWidth={2.3} aria-hidden="true" />
              <span><strong>{failure.title}.</strong> {failure.message}</span>
            </p>
          ) : hint ? <p className={`stc-hint${invalid ? ' is-error' : ''}`}>{hint}</p> : null}
        </div>
      </form>
      {done ? (
        <p className="stc-done" role="status">
          <CircleCheck size={20} strokeWidth={2.3} aria-hidden="true" />
          <span>
            <strong>{done.status === 'already_enrolled' ? `You’re already on ${done.course.courseCode}` : `You joined ${done.course.courseCode}`}</strong>
            <span>{done.course.courseTitle} · {courseLine(done.course)}</span>
          </span>
        </p>
      ) : null}
    </section>
  );
}

function CoursesSkeleton() {
  return (
    <div className="ds-section" role="status" aria-label="Loading your courses">
      <div className="ds-section-head" aria-hidden="true"><span className="ds-skeleton" style={{ width: 120, height: 20 }} /></div>
      <ul className="ds-list stc-list" aria-hidden="true">
        {[64, 48, 56].map((width) => (
          <li key={width}>
            <div className="ds-row stc-row">
              <span className="ds-row-body">
                <span className="ds-skeleton" style={{ width: 72, height: 14 }} />
                <span className="ds-skeleton" style={{ width: `${width}%`, height: 17, marginTop: 6 }} />
                <span className="ds-skeleton" style={{ width: '38%', height: 13, marginTop: 6 }} />
              </span>
              <span className="ds-skeleton" style={{ width: 84, height: 18 }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
