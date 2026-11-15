'use client';

import { courseCodeKey, type LectureCatalogCourse, type LectureCourseCatalog } from '@lasuatos/contracts';
import { BookMarked, ChevronRight, EyeOff, MoreHorizontal, Plus, Replace, TriangleAlert } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { lookupAdministrator, type AdministratorAccount } from '../../lib/current-account';
import { failureText, LectureRequestError, loadCourseCatalog } from '../../lib/lecture-api';
import { primeResource, useResource } from '../../lib/resource';
import { AddCourseDialog, EditCourseDialog, replaceCourse } from '../course-picker';
import { Badge, Button, EmptyState, Menu, PageHeader, SegmentedControl, Stat, Stats } from '../ds';
import { useFeedback } from '../feedback';
import { GuideButton } from '../shell/guide-button';
import { useClock } from '../take-attendance/hooks';
import { SearchField } from '../ui/search-field';
import { Select } from '../ui/select';
import { CourseSheet } from './course-sheet';
import {
  checksFor,
  checkText,
  countCourses,
  courseSlug,
  COURSES_KEY,
  findBySlug,
  groupByLevel,
  kindOf,
  matchesQuery,
  matchesShow,
  originLine,
  PATH,
  plural,
  prefixCounts,
  prefixOf,
  readView,
  SEARCH_FROM,
  semesterLabel,
  taughtLabel,
  type Check,
  type Show,
  type View,
  viewHref,
} from './format';
import { RenameSheet } from './rename-sheet';
import './courses.css';

export type Catalog = { readonly account: AdministratorAccount; readonly catalog: LectureCourseCatalog };
type Answer = { readonly kind: 'ok'; readonly data: Catalog } | { readonly kind: 'denied'; readonly message: string };

async function load(signal: AbortSignal): Promise<Answer> {
  const session = await lookupAdministrator('look after the course list');
  if (session.kind === 'error') return { kind: 'denied', message: session.message };
  try {
    return { kind: 'ok', data: { account: session.account, catalog: await loadCourseCatalog(signal, { includeHidden: true }) } };
  } catch (caught) {
    if (caught instanceof DOMException) throw caught;
    if (caught instanceof LectureRequestError && caught.status === 403) return { kind: 'denied', message: caught.message };
    throw new Error(failureText(caught, 'The course list did not load. Try again.'));
  }
}

/**
 * Course list: every course lecturers and class reps pick when they open a session, so codes and
 * titles match on every register. Administrators correct courses, add missing ones, hide old
 * ones and rename a whole prefix when a department's codes change.
 */
export function Courses() {
  const resource = useResource(COURSES_KEY, load, { maxAge: 30_000 });
  const answer = resource.data;
  if (answer?.kind === 'denied') {
    return (
      <div className="crs">
        <PageHeader title="Course list" />
        <div className="ds-card">
          <EmptyState
            icon={<BookMarked size={26} strokeWidth={1.9} />}
            title="Administrators look after the course list"
            message={answer.message}
            action={<Button href="/" variant="tinted">Go home</Button>}
          />
        </div>
      </div>
    );
  }
  if (!answer) {
    return (
      <div className="crs">
        <Header />
        {resource.error ? (
          <div className="ds-card">
            <EmptyState error title="The course list did not load" message={resource.error} action={<Button variant="tinted" onClick={resource.reload}>Try again</Button>} />
          </div>
        ) : <PageSkeleton />}
      </div>
    );
  }
  return <CourseDirectory data={answer.data} reload={resource.reload} />;
}

function Header({ subtitle, onAdd, onRename }: Readonly<{ subtitle?: string | undefined; onAdd?: (() => void) | undefined; onRename?: (() => void) | undefined }>) {
  return (
    <PageHeader
      title="Course list"
      subtitle={subtitle}
      actions={(
        <div className="crs-head-actions">
          {onAdd ? (
            <>
              <Button className="crs-add-wide" onClick={onAdd} icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />}>Add course</Button>
              <button className="ds-icon-btn is-filled crs-add-narrow" type="button" aria-label="Add course" data-tip="Add course" onClick={onAdd}>
                <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </>
          ) : null}
          {onRename ? (
            <Menu
              label="More course list actions"
              icon={<MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" />}
              items={[{ label: 'Rename a code prefix', icon: <Replace size={18} aria-hidden="true" />, onSelect: onRename }]}
            />
          ) : null}
          <GuideButton page={PATH} label="Course list" />
        </div>
      )}
    />
  );
}

type Sheets =
  | { readonly kind: 'none' }
  | { readonly kind: 'add' }
  | { readonly kind: 'edit'; readonly key: string }
  | { readonly kind: 'rename' };

const SEGMENT_LABEL: Readonly<Record<Show, string>> = { all: 'All', check: 'Needs a look', added: 'Added here', changed: 'Changed', hidden: 'Hidden' };
const SEGMENT_SHORT: Readonly<Record<Show, string>> = { all: 'All', check: 'Check', added: 'Added', changed: 'Edited', hidden: 'Hidden' };

function CourseDirectory({ data, reload }: Readonly<{ data: Catalog; reload: () => void }>) {
  const router = useRouter();
  const pathname = usePathname() ?? PATH;
  const params = useSearchParams();
  const view = readView(params);
  const now = useClock('fifteen');
  const feedback = useFeedback();
  const [query, setQuery] = useState('');
  const [sheet, setSheet] = useState<Sheets>({ kind: 'none' });
  const { catalog } = data;
  const canManage = catalog.canManage;

  const checks = useMemo(() => checksFor(catalog.courses), [catalog.courses]);
  const checksOf = (course: LectureCatalogCourse): readonly Check[] => checks.get(courseCodeKey(course.code)) ?? [];
  const counts = useMemo(() => countCourses(catalog.courses, checks, now), [catalog.courses, checks, now]);
  const prefixes = useMemo(() => prefixCounts(catalog.courses), [catalog.courses]);
  const prefix = view.prefix ? prefixes.find((item) => item.prefix.toLowerCase() === view.prefix)?.prefix ?? null : null;
  const shown = useMemo(
    () => catalog.courses.filter((course) => (!prefix || prefixOf(course.code) === prefix)
      && matchesShow(view.show, course, checks.get(courseCodeKey(course.code)) ?? [])
      && matchesQuery(course, query)),
    [catalog.courses, prefix, view.show, checks, query],
  );
  const groups = useMemo(() => groupByLevel(shown), [shown]);
  const selected = findBySlug(view.course, catalog.courses);
  const editing = sheet.kind === 'edit' ? catalog.courses.find((course) => courseCodeKey(course.code) === sheet.key) ?? null : null;

  function go(next: Partial<View>) {
    router.replace(viewHref(pathname, { ...view, ...next }), { scroll: false });
  }
  const open = (course: LectureCatalogCourse | null) => go({ course: course ? courseSlug(course.code) : null });

  // A link to a course that isn't on the list (removed, or recoded since) quietly drops it.
  useEffect(() => {
    if (view.course && !selected) router.replace(viewHref(pathname, { ...view, course: null }), { scroll: false });
  }, [view, selected, router, pathname]);

  /** Shows a change at once, then asks the server for the exact list. */
  function patch(change: (current: LectureCourseCatalog) => LectureCourseCatalog) {
    primeResource(COURSES_KEY, { kind: 'ok', data: { ...data, catalog: change(catalog) } } satisfies Answer);
    reload();
  }
  function changed(before: LectureCatalogCourse, after: LectureCatalogCourse) {
    patch((current) => replaceCourse(current, before, after));
    if (selected && courseCodeKey(before.code) === courseCodeKey(selected.code) && courseCodeKey(after.code) !== courseCodeKey(before.code)) {
      go({ course: courseSlug(after.code) });
    }
  }

  const segments: Show[] = ['all', ...(['check', 'added', 'changed', 'hidden'] as const).filter((show) => segmentCount(show) > 0 || view.show === show)];
  function segmentCount(show: Show): number {
    switch (show) {
      case 'all': return counts.total;
      case 'check': return counts.check;
      case 'added': return counts.added;
      case 'changed': return counts.changed;
      case 'hidden': return counts.hidden;
    }
  }
  const narrowed = Boolean(prefix || query.trim() || view.show !== 'all');

  return (
    <div className="crs">
      <Header
        subtitle={`${plural(counts.pickable, 'course')} lecturers can pick`}
        onAdd={() => setSheet({ kind: 'add' })}
        onRename={canManage ? () => setSheet({ kind: 'rename' }) : undefined}
      />

      <Stats label="Course list at a glance">
        <Stat label="Can be picked" value={counts.pickable} hint={`${counts.added + counts.changed} set here`} />
        <Stat label="Taught lately" value={counts.recent} hint="a session in 30 days" tone={counts.recent > 0 ? 'success' : undefined} />
        <Stat label="Need a look" value={counts.check} hint={counts.check ? 'units or same title' : 'all look right'} tone={counts.check ? 'warning' : 'success'} />
        <Stat label="Hidden" value={counts.hidden} hint="kept for old registers" />
      </Stats>

      <div className="crs-tools">
        {segments.length > 1 ? (
          <SegmentedControl
            label="Show"
            value={view.show}
            onChange={(show) => go({ show })}
            segments={segments.map((value) => ({
              value,
              label: value === 'all' ? 'All' : (
                <>
                  <span className="crs-long">{SEGMENT_LABEL[value]}</span>
                  <span className="crs-short">{SEGMENT_SHORT[value]}</span>
                  <span className="crs-count">{segmentCount(value)}</span>
                </>
              ),
            }))}
          />
        ) : null}
        {catalog.courses.length >= SEARCH_FROM ? (
          <SearchField className="crs-find" value={query} onValueChange={setQuery} placeholder="Code or title" aria-label="Find a course" />
        ) : null}
        {prefixes.length > 1 ? (
          <label className="crs-prefix">
            <span className="sr-only">Prefix</span>
            <Select
              value={prefix ?? ''}
              onValueChange={(next) => go({ prefix: next ? next.toLowerCase() : null })}
              aria-label="Prefix"
              searchable={prefixes.length > 8}
              options={[
                { value: '', label: 'Any prefix' },
                ...prefixes.map((item) => ({ value: item.prefix, label: item.prefix, description: plural(item.count, 'course') })),
              ]}
            />
          </label>
        ) : null}
      </div>

      {groups.length === 0 ? (
        <div className="ds-card crs-none">
          <EmptyState
            icon={<BookMarked size={26} strokeWidth={1.9} />}
            title={query.trim() ? `Nothing matches “${query.trim()}”` : view.show === 'check' ? 'Nothing needs a look' : 'No courses here'}
            message={query.trim()
              ? 'Check the code, or add the course if it isn’t on the list yet.'
              : narrowed ? 'Try another filter or prefix.' : 'Add the courses taught here so lecturers can pick them.'}
            action={query.trim()
              ? <Button variant="tinted" onClick={() => setSheet({ kind: 'add' })}>Add a course</Button>
              : narrowed ? <Button variant="tinted" onClick={() => { setQuery(''); go({ show: 'all', prefix: null }); }}>Show all courses</Button> : undefined}
          />
        </div>
      ) : groups.map((group, index) => (
        <section key={group.key} className="ds-section" aria-labelledby={`crs-level-${group.key}`}>
          <div className="ds-section-head">
            <h2 className="ds-section-title" id={`crs-level-${group.key}`}>{group.title}</h2>
            <span className="ds-section-aside">{plural(group.courses.length, 'course')}</span>
          </div>
          {index === 0 ? (
            <div className="crs-columns" aria-hidden="true">
              <span>Course</span><span>Units</span><span>Semester</span><span>Sessions</span><span>Last taught</span>
            </div>
          ) : null}
          <ul className="ds-list crs-list">
            {group.courses.map((course) => (
              <CourseRow key={courseCodeKey(course.code)} course={course} checks={checksOf(course)} now={now} onOpen={() => open(course)} />
            ))}
          </ul>
        </section>
      ))}
      {groups.length ? <p className="crs-source">{catalog.standardSource}</p> : null}

      <CourseSheet
        course={selected}
        checks={selected ? checksOf(selected) : []}
        canManage={canManage}
        now={now}
        onClose={() => open(null)}
        onEdit={(course) => setSheet({ kind: 'edit', key: courseCodeKey(course.code) })}
        onOpenCode={(code) => {
          const other = catalog.courses.find((course) => courseCodeKey(course.code) === courseCodeKey(code));
          if (other) open(other);
        }}
        onChanged={changed}
        onRemoved={(course) => {
          open(null);
          patch((current) => ({ ...current, courses: current.courses.filter((item) => courseCodeKey(item.code) !== courseCodeKey(course.code)) }));
        }}
      />
      {sheet.kind === 'add' ? (
        <AddCourseDialog
          catalog={catalog}
          initialCode={/^[A-Za-z]{2,5}\s?\d{3}[A-Za-z]?$/.test(query.trim()) ? query.trim().toUpperCase() : ''}
          onClose={() => setSheet({ kind: 'none' })}
          onAdded={(course) => {
            setSheet({ kind: 'none' });
            feedback.toast(`${course.code} was added. Lecturers can pick it now.`);
            setQuery('');
            patch((current) => ({ ...current, courses: [...current.courses.filter((item) => courseCodeKey(item.code) !== courseCodeKey(course.code)), course] }));
            router.replace(viewHref(pathname, { show: 'all', prefix: null, course: courseSlug(course.code) }), { scroll: false });
          }}
          onPickExisting={(course) => {
            setSheet({ kind: 'none' });
            open(course);
          }}
        />
      ) : null}
      {editing ? (
        <EditCourseDialog
          course={editing}
          canManage={canManage}
          onClose={() => setSheet({ kind: 'none' })}
          onSaved={({ course }) => {
            setSheet({ kind: 'none' });
            changed(editing, course);
          }}
          onRemoved={kindOf(editing) !== 'added' ? undefined : () => {
            setSheet({ kind: 'none' });
            open(null);
            patch((current) => ({ ...current, courses: current.courses.filter((item) => courseCodeKey(item.code) !== courseCodeKey(editing.code)) }));
          }}
        />
      ) : null}
      {canManage ? (
        <RenameSheet
          open={sheet.kind === 'rename'}
          prefixes={prefixes}
          onClose={() => setSheet({ kind: 'none' })}
          onApplied={(to) => {
            reload();
            go({ prefix: to.toLowerCase(), show: 'all', course: null });
          }}
        />
      ) : null}
    </div>
  );
}

function CourseRow({ course, checks, now, onOpen }: Readonly<{ course: LectureCatalogCourse; checks: readonly Check[]; now: number; onOpen: () => void }>) {
  const kind = kindOf(course);
  const semester = semesterLabel(course.semester);
  const first = checks[0];
  const status = course.hidden
    ? <Badge tone="neutral"><EyeOff size={12} strokeWidth={2.4} aria-hidden="true" /> Hidden</Badge>
    : kind === 'added' ? <Badge tone="tint">Added</Badge>
      : kind === 'changed' ? <Badge tone="accent">Changed</Badge> : null;
  const taught = course.sessionCount ? plural(course.sessionCount, 'session') : 'Not taught yet';
  return (
    <li>
      <button className={`ds-row crs-row${course.hidden ? ' is-hidden' : ''}`} type="button" onClick={onOpen}>
        <span className="crs-code">{course.code}</span>
        <span className="ds-row-body">
          <span className="ds-row-title crs-ellipsis">{course.title}</span>
          {first ? (
            <span className="ds-row-subtitle crs-note is-warning">
              <TriangleAlert size={13} strokeWidth={2.4} aria-hidden="true" />
              <span className="crs-ellipsis">{checkText(first).title}</span>
            </span>
          ) : <span className="ds-row-subtitle crs-ellipsis crs-wide-only">{originLine(course)}</span>}
          <span className="ds-row-subtitle crs-narrow">
            {status}
            <span className="crs-ellipsis">
              {[course.units == null ? null : plural(course.units, 'unit'), semester, course.sessionCount ? plural(course.sessionCount, 'session') : null].filter(Boolean).join(' · ') || originLine(course)}
            </span>
          </span>
        </span>
        <span className="crs-col crs-col-num">{course.units ?? '—'}</span>
        <span className="crs-col">{semester ? semester.replace(' semester', '') : '—'}</span>
        <span className="crs-col crs-col-num">{course.sessionCount ? course.sessionCount.toLocaleString('en-NG') : '—'}</span>
        <span className="crs-col">{course.lastSessionAt ? taughtLabel(course.lastSessionAt, now) : <span className="crs-dim">Never</span>}</span>
        <span className="crs-trail">{status}</span>
        <span className="sr-only">{`, ${taught}`}</span>
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </li>
  );
}

function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading the course list">
      <div className="ds-stats" aria-hidden="true">
        {[0, 1, 2, 3].map((item) => <div key={item} className="ds-stat"><span className="ds-skeleton" style={{ width: '60%', height: 14 }} /><span className="ds-skeleton" style={{ width: 48, height: 28, marginTop: 8 }} /></div>)}
      </div>
      <div className="ds-section" aria-hidden="true">
        <div className="ds-section-head"><span className="ds-skeleton" style={{ width: 120, height: 20 }} /></div>
        <ul className="ds-list">
          {[70, 52, 64, 46, 58, 40].map((width) => (
            <li key={width}>
              <div className="ds-row crs-row">
                <span className="crs-code ds-skeleton" style={{ height: 22 }} />
                <span className="ds-row-body"><span className="ds-skeleton" style={{ width: `${width}%`, height: 16 }} /><span className="ds-skeleton" style={{ width: '30%', height: 12, marginTop: 6 }} /></span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
