'use client';

import type { LecturerSemester } from '@lasuatos/contracts';
import { BookOpenCheck, CalendarX2, ChevronRight, Plus, QrCode } from 'lucide-react';
import { useEffect, useState } from 'react';
import { loadLecturerOfferings, loadLecturerSemesters } from '../../lib/course-api';
import { firstName, greetingForNow, useCurrentAccount } from '../../lib/current-account';
import { capabilitiesChanged } from '../../lib/lecture-api';
import { primeResource, useResource } from '../../lib/resource';
import { Badge, Button, EmptyState, PageHeader } from '../ds';
import { GuideButton } from '../shell/guide-button';
import { useClock } from '../take-attendance/hooks';
import { AddCourseSheet } from './add-sheet';
import { CourseSheet, type IssuedCode } from './course-sheet';
import { codeState, groupOfferings, plural, problemText, rowFacts, summaryLine, withUpdated, type CourseGroup, type Offering } from './model';
import './lecturer-courses.css';

const PATH = '/lecturer/courses';
export const OFFERINGS_KEY = 'lecturer:offerings';
const SEMESTERS_KEY = 'lecturer:semesters';

async function loadOfferings(signal: AbortSignal): Promise<readonly Offering[]> {
  try {
    return (await loadLecturerOfferings(signal)).offerings;
  } catch (caught) {
    if (caught instanceof DOMException) throw caught;
    throw new Error(problemText(caught, 'Your courses did not load. Check your connection and try again.'));
  }
}

async function loadSemesters(signal: AbortSignal): Promise<readonly LecturerSemester[]> {
  try {
    return (await loadLecturerSemesters(signal)).semesters;
  } catch (caught) {
    if (caught instanceof DOMException) throw caught;
    throw new Error(problemText(caught, 'The semesters did not load. Check your connection and try again.'));
  }
}

/**
 * Course tools: the courses a lecturer teaches, by semester, each with its students and whether
 * they can still join. A course opens in a sheet with its join code (get, share, show to the
 * class, replace, turn off), its numbers and links, and its details. "Add course" picks from the
 * course list sessions use. /lecturer/courses?course=<id> opens that course.
 */
export function LecturerCourses() {
  const account = useCurrentAccount();
  const now = useClock('fifteen');
  const offerings = useResource(OFFERINGS_KEY, loadOfferings, { maxAge: 15_000 });
  const semesters = useResource(SEMESTERS_KEY, loadSemesters, { maxAge: 60_000 });
  // /lecturer/courses?course=<id> opens that course once the list is in.
  const [openId, setOpenId] = useState<string | null>(() => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('course')));
  const [adding, setAdding] = useState(false);
  // A code is shown once: it stays here, per course, until the page is left.
  const [issued, setIssued] = useState<Readonly<Record<string, IssuedCode>>>({});

  const list = offerings.data ?? null;
  const open = list?.find((item) => item.courseOfferingId === openId) ?? null;
  const groups = list && now ? groupOfferings(list, now) : null;
  const noSemesters = semesters.data !== undefined && semesters.data.length === 0;

  // The address goes back to plain /lecturer/courses, so a reload does not reopen the course.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('course')) return;
    params.delete('course');
    const query = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
  }, []);

  function replaceList(next: readonly Offering[]) {
    primeResource(OFFERINGS_KEY, next);
    offerings.reload();
  }

  function added(offering: Offering, firstCourse: boolean) {
    const current = list ?? [];
    replaceList(current.some((item) => item.courseOfferingId === offering.courseOfferingId) ? current : [...current, offering]);
    // The first course brings Course sessions, Reports and Disputes into the menu.
    if (firstCourse) capabilitiesChanged();
  }

  function codeIssued(offering: Offering, code: IssuedCode) {
    setIssued((current) => ({ ...current, [offering.courseOfferingId]: code }));
    // The list may not have the course yet (just added): read the latest from the store.
    const latest = offerings.data ?? list ?? [];
    const known = latest.some((item) => item.courseOfferingId === offering.courseOfferingId);
    replaceList((known ? latest : [...latest, offering]).map((item) => (item.courseOfferingId === offering.courseOfferingId
      ? { ...item, joinCodeActive: true, joinCodeIssuedAt: code.issuedAt }
      : item)));
  }

  const greeting = account === undefined ? null : account ? `${greetingForNow()}, ${firstName(account.displayName)}` : greetingForNow();

  return (
    <div className="lct">
      <PageHeader
        eyebrow={greeting ?? <span className="lct-eyebrow-skeleton ds-skeleton" aria-hidden="true" />}
        title="Course tools"
        subtitle={list && now ? summaryLine(list, now) : null}
        actions={(
          <div className="lct-head-actions">
            <GuideButton page={PATH} label="Course tools" />
            {noSemesters ? null : (
              <>
                <Button className="lct-add-wide" onClick={() => setAdding(true)} icon={<Plus size={18} strokeWidth={2.4} aria-hidden="true" />}>Add course</Button>
                <button className="ds-icon-btn lct-add-narrow" type="button" onClick={() => setAdding(true)} aria-label="Add course">
                  <Plus size={20} strokeWidth={2.4} aria-hidden="true" />
                </button>
              </>
            )}
          </div>
        )}
      />

      {groups ? (
        groups.length ? (
          groups.map((group) => <CourseSection key={group.key} group={group} now={now} onOpen={setOpenId} />)
        ) : noSemesters ? (
          <div className="ds-card lct-empty">
            <EmptyState
              icon={<CalendarX2 size={26} strokeWidth={1.9} />}
              title="No semester is open for new courses"
              message="An administrator adds semesters in Academic structure. You can still take attendance with a QR code meanwhile."
              action={<Button variant="tinted" href="/sessions" icon={<QrCode size={18} aria-hidden="true" />}>Take attendance</Button>}
            />
          </div>
        ) : (
          <div className="ds-card lct-empty">
            <EmptyState
              icon={<BookOpenCheck size={26} strokeWidth={1.9} />}
              title="No courses yet"
              message="Add each course you teach, then give its students the join code. They add the course in My courses, and you get its roster, reports and disputes here."
              action={<Button onClick={() => setAdding(true)} icon={<Plus size={18} strokeWidth={2.4} aria-hidden="true" />}>Add your first course</Button>}
            />
          </div>
        )
      ) : offerings.error ? (
        <div className="ds-card">
          <EmptyState error title="Your courses did not load" message={offerings.error} action={<Button variant="tinted" onClick={offerings.reload}>Try again</Button>} />
        </div>
      ) : <CoursesSkeleton />}

      <CourseSheet
        offering={open}
        now={now}
        issued={open ? issued[open.courseOfferingId] ?? null : null}
        onClose={() => setOpenId(null)}
        onIssued={codeIssued}
        onRevoked={(offering) => {
          setIssued((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== offering.courseOfferingId)));
          replaceList((list ?? []).map((item) => (item.courseOfferingId === offering.courseOfferingId
            ? { ...item, joinCodeActive: false, joinCodeIssuedAt: null }
            : item)));
        }}
        onSaved={(updated) => replaceList(withUpdated(list ?? [], updated))}
      />

      <AddCourseSheet
        open={adding}
        semesters={semesters}
        offerings={list ?? []}
        now={now}
        onClose={() => setAdding(false)}
        onAdded={(offering, firstCourse) => added(offering, firstCourse)}
        onIssued={codeIssued}
        onOpen={(id) => {
          setAdding(false);
          setOpenId(id);
        }}
      />
    </div>
  );
}

function CourseSection({ group, now, onOpen }: Readonly<{ group: CourseGroup; now: number; onOpen: (id: string) => void }>) {
  const id = `lct-${group.phase}-${group.key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
  return (
    <section className="ds-section" aria-labelledby={`${id}-title`}>
      <div className="ds-section-head">
        <h2 className="ds-section-title" id={`${id}-title`}>{group.title}</h2>
        {group.aside ? <span className="ds-section-aside">{group.aside}</span> : null}
      </div>
      <ul className={`ds-list lct-list${group.phase === 'ended' ? ' is-ended' : ''}`}>
        {group.offerings.map((offering) => <CourseRow key={offering.courseOfferingId} offering={offering} now={now} onOpen={onOpen} />)}
      </ul>
    </section>
  );
}

/** One course: code, title, level and students, and whether students can join it. */
function CourseRow({ offering, now, onOpen }: Readonly<{ offering: Offering; now: number; onOpen: (id: string) => void }>) {
  const state = codeState(offering, now);
  const status = state === 'on'
    ? <Badge tone="success" dot>Code on</Badge>
    : state === 'off' ? <Badge tone="warning">No code</Badge> : null;
  const disputes = offering.openDisputes ? plural(offering.openDisputes, 'dispute') : null;
  return (
    <li>
      <button className="ds-row lct-row" type="button" onClick={() => onOpen(offering.courseOfferingId)}>
        <span className="ds-row-body">
          <span className="lct-code">{offering.courseCode}{status}</span>
          <span className="ds-row-title lct-title">{offering.courseTitle}</span>
          <span className="ds-row-subtitle lct-facts">
            {rowFacts(offering)}
            {disputes ? <span className="lct-dispute"> · {disputes} to answer</span> : null}
          </span>
        </span>
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </li>
  );
}

function CoursesSkeleton() {
  return (
    <div className="ds-section" role="status" aria-label="Loading your courses">
      <div className="ds-section-head" aria-hidden="true"><span className="ds-skeleton" style={{ width: 170, height: 20 }} /></div>
      <ul className="ds-list lct-list" aria-hidden="true">
        {[62, 48, 56].map((width) => (
          <li key={width}>
            <div className="ds-row lct-row">
              <span className="ds-row-body">
                <span className="ds-skeleton" style={{ width: 64, height: 13 }} />
                <span className="ds-skeleton" style={{ width: `${width}%`, height: 17, marginTop: 4 }} />
                <span className="ds-skeleton" style={{ width: '40%', height: 13, marginTop: 4 }} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
