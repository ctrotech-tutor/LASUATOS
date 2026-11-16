'use client';

import { BookOpenCheck, ChevronRight, Plus, QrCode } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { formatClock } from '../../lib/lecture-api';
import { useResource } from '../../lib/resource';
import { Button, EmptyState, PageHeader } from '../ds';
import { GuideButton } from '../shell/guide-button';
import { dayHeading, lagosDay, remainingLabel, timeRange } from '../take-attendance/format';
import { useClock, useToday } from '../take-attendance/hooks';
import { loadOfferings, loadSessions, OFFERINGS_KEY, SESSIONS_KEY } from './data';
import { isLive, openableOfferings, plural, type CourseSession, type Offering } from './model';
import { OpenClassSheet } from './open-sheet';
import '../take-attendance/take.css';
import './course-sessions.css';

const PATH = '/lecturer/attendance';
/** Rows shown before "Show earlier classes": a semester of two classes a week. */
const FIRST_ROWS = 30;

function readParam(name: string): string | null {
  return typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get(name);
}

/** Keeps the course filter in the address (so a reload keeps it) and drops one-off flags. */
function writeParams(course: string | null) {
  const params = new URLSearchParams(window.location.search);
  params.delete('new');
  if (course) params.set('courseOfferingId', course);
  else params.delete('courseOfferingId');
  const query = params.toString();
  window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
}

/**
 * Course sessions: the classes a lecturer opens for an enrolled course. What is live (with its
 * QR code a tap away), opening a class, and every class before, by day, with how many of the
 * course's students checked in. ?courseOfferingId= shows one course; ?new=1 opens a class.
 */
export function CourseSessions() {
  const now = useClock('fifteen');
  const sessions = useResource(SESSIONS_KEY, loadSessions, { maxAge: 10_000, poll: 20_000 });
  const offerings = useResource(OFFERINGS_KEY, loadOfferings, { maxAge: 15_000 });
  const [course, setCourse] = useState<string | null>(() => readParam('courseOfferingId'));
  const [opening, setOpening] = useState(() => readParam('new') !== null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => { writeParams(course); }, [course]);

  const courses = offerings.data ?? null;
  const all = sessions.data ?? null;
  const byId = useMemo(() => new Map((courses ?? []).map((item) => [item.courseOfferingId, item])), [courses]);
  // A course asked for that is not this lecturer's (or not loaded yet) filters nothing.
  const activeCourse = course && (!courses || byId.has(course)) ? course : null;
  const shown = useMemo(() => (all ?? []).filter((item) => !activeCourse || item.courseOfferingId === activeCourse), [all, activeCourse]);
  const live = shown.filter(isLive);
  const past = shown.filter((item) => !isLive(item));
  const visiblePast = showAll ? past : past.slice(0, FIRST_ROWS);
  const openable = courses && now ? openableOfferings(courses, now) : [];
  const chips = useMemo(() => courseChips(courses ?? [], all ?? [], now), [courses, all, now]);
  const filtered = activeCourse ? byId.get(activeCourse) ?? null : null;

  const subtitle = all && courses ? summary(all) : null;
  const noCourses = courses !== null && courses.length === 0;
  const canOpen = openable.length > 0;

  return (
    <div className="tk-page cs-page">
      <PageHeader
        title="Course sessions"
        subtitle={subtitle}
        actions={(
          <div className="tk-head-actions">
            <GuideButton page={PATH} label="Course sessions" />
            {canOpen ? (
              <>
                <Button className="tk-new-wide" icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />} onClick={() => setOpening(true)}>
                  Open a class
                </Button>
                <button className="ds-icon-btn is-filled tk-new-compact" type="button" aria-label="Open a class" onClick={() => setOpening(true)}>
                  <Plus size={20} strokeWidth={2.4} aria-hidden="true" />
                </button>
              </>
            ) : null}
          </div>
        )}
      />

      {chips.length > 1 ? (
        <div className="cs-chips" role="group" aria-label="Show classes for">
          <button className="cs-chip" type="button" aria-pressed={!activeCourse} onClick={() => setCourse(null)}>All courses</button>
          {chips.map((item) => (
            <button
              key={item.courseOfferingId}
              className="cs-chip"
              type="button"
              aria-pressed={activeCourse === item.courseOfferingId}
              onClick={() => setCourse(activeCourse === item.courseOfferingId ? null : item.courseOfferingId)}
            >
              {item.courseCode}
            </button>
          ))}
        </div>
      ) : null}

      {all === null || courses === null ? (
        sessions.error || offerings.error ? (
          <div className="ds-card">
            <EmptyState
              error
              title="Your sessions did not load"
              message={sessions.error ?? offerings.error}
              action={<Button variant="tinted" onClick={() => { sessions.reload(); offerings.reload(); }}>Try again</Button>}
            />
          </div>
        ) : <ListBones />
      ) : noCourses ? (
        <div className="ds-card cs-empty">
          <EmptyState
            icon={<BookOpenCheck size={26} strokeWidth={1.9} aria-hidden="true" />}
            title="Add a course first"
            message="Classes here are for courses students joined with your code. Add the course in Course tools, give students its join code, then open a class."
            action={<Button href="/lecturer/courses" icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />}>Go to Course tools</Button>}
          />
        </div>
      ) : shown.length === 0 ? (
        <div className="ds-card cs-empty">
          <EmptyState
            icon={<QrCode size={26} strokeWidth={1.9} aria-hidden="true" />}
            title={filtered ? `No classes for ${filtered.courseCode} yet` : 'No classes yet'}
            message={canOpen
              ? 'Open one when class begins. Students scan the code on your screen; the ones who have not are listed too.'
              : 'No course of yours is in a running semester, so a class cannot be opened now.'}
            action={canOpen ? <Button icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />} onClick={() => setOpening(true)}>Open a class</Button> : undefined}
          />
        </div>
      ) : (
        <>
          {live.length ? (
            <section className="tk-live" aria-label="Taking attendance now">
              {live.map((item) => <LiveCard key={item.id} session={item} offering={byId.get(item.courseOfferingId) ?? null} />)}
            </section>
          ) : null}
          <History sessions={visiblePast} byId={byId} />
          {past.length > visiblePast.length ? (
            <div className="tk-more">
              <Button variant="gray" block onClick={() => setShowAll(true)}>Show {plural(past.length - visiblePast.length, 'earlier class', 'earlier classes')}</Button>
            </div>
          ) : null}
        </>
      )}

      <OpenClassSheet
        open={opening}
        openable={openable}
        sessions={all ?? []}
        preferred={activeCourse}
        now={now}
        onClose={() => setOpening(false)}
      />
    </div>
  );
}

/** "2 open now · 14 classes": what is live, then how many classes in all. */
function summary(sessions: readonly CourseSession[]): string | null {
  if (!sessions.length) return null;
  const open = sessions.filter(isLive).length;
  return [open ? `${open} open now` : null, plural(sessions.length, 'class', 'classes')].filter(Boolean).join(' · ');
}

/** One chip per course worth filtering by: it has classes, or a class can be opened for it now. */
function courseChips(offerings: readonly Offering[], sessions: readonly CourseSession[], now: number): Offering[] {
  const used = new Set(sessions.map((item) => item.courseOfferingId));
  const openable = new Set(now ? openableOfferings(offerings, now).map((item) => item.courseOfferingId) : []);
  return offerings
    .filter((item) => used.has(item.courseOfferingId) || openable.has(item.courseOfferingId))
    .sort((a, b) => a.courseCode.localeCompare(b.courseCode, 'en', { numeric: true }));
}

function LiveCard({ session, offering }: Readonly<{ session: CourseSession; offering: Offering | null }>) {
  const now = useClock('fifteen');
  const left = now ? remainingLabel(session.endsAt, new Date(now)) : null;
  return (
    <Link className="tk-live-card" href={`${PATH}/${session.id}`}>
      <span className="tk-live-top">
        <span className="tk-pulse" aria-hidden="true" />
        <span>Live{left ? ` · ${left}` : ''}</span>
      </span>
      <span className="tk-live-main">
        <span className="tk-live-text">
          <span className="tk-live-code">{session.courseCode} · {session.title}</span>
          <strong className="tk-live-title">{session.courseTitle}</strong>
          <span className="tk-live-meta">
            {session.venueName ? `${session.venueName} · ` : ''}until {formatClock(session.endsAt)}
          </span>
        </span>
        <span className="tk-live-count">
          <strong>{session.attendanceCount.toLocaleString('en-NG')}</strong>
          <small>{offering?.students ? `of ${offering.students.toLocaleString('en-NG')}` : 'present'}</small>
        </span>
      </span>
      <span className="tk-live-cta">
        <QrCode size={18} strokeWidth={2.1} aria-hidden="true" />
        Show QR code
        <ChevronRight size={18} strokeWidth={2.2} aria-hidden="true" />
      </span>
    </Link>
  );
}

/** Classes that have ended, a group per day. */
function History({ sessions, byId }: Readonly<{ sessions: readonly CourseSession[]; byId: ReadonlyMap<string, Offering> }>) {
  const today = useToday();
  const groups = useMemo(() => {
    const byDay = new Map<string, CourseSession[]>();
    for (const item of sessions) {
      const day = lagosDay(item.startsAt);
      const group = byDay.get(day);
      if (group) group.push(item);
      else byDay.set(day, [item]);
    }
    return [...byDay];
  }, [sessions]);
  return (
    <>
      {groups.map(([day, items]) => (
        <section className="tk-day" key={day} aria-label={dayHeading(day, today)}>
          <div className="tk-day-head">
            <h2 className="tk-day-title">{dayHeading(day, today)}</h2>
          </div>
          <ul className="ds-list tk-rows">
            {items.map((item) => <SessionRow key={item.id} session={item} offering={byId.get(item.courseOfferingId) ?? null} />)}
          </ul>
        </section>
      ))}
    </>
  );
}

function SessionRow({ session, offering }: Readonly<{ session: CourseSession; offering: Offering | null }>) {
  const details = [timeRange(session.startsAt, session.endsAt), session.courseTitle, session.venueName].filter(Boolean).join(' · ');
  const classSize = offering?.students ?? null;
  return (
    <li>
      <Link className="ds-row tk-row" href={`${PATH}/${session.id}`}>
        <span className="tk-code">{session.courseCode}</span>
        <span className="ds-row-body">
          <span className="tk-code-inline">{session.courseCode}</span>
          <span className="ds-row-title">{session.title}</span>
          <span className="ds-row-subtitle">{details}</span>
        </span>
        <span className="tk-count">
          <strong>{session.attendanceCount.toLocaleString('en-NG')}</strong>
          <small>{classSize ? `of ${classSize.toLocaleString('en-NG')}` : 'present'}</small>
        </span>
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </Link>
    </li>
  );
}

function ListBones() {
  return (
    <ul className="ds-list tk-rows tk-bones" role="status" aria-label="Loading sessions">
      {[0, 1, 2, 3, 4].map((index) => (
        <li key={index}>
          <div className="ds-row tk-row">
            <span className="ds-skeleton tk-code tk-bone-tile" />
            <span className="ds-row-body">
              <span className="ds-skeleton" style={{ width: `${70 - index * 8}%` }} />
              <span className="ds-skeleton tk-bone-small" style={{ width: `${44 - index * 4}%` }} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
