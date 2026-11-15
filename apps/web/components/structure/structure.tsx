'use client';

import type { InstitutionStructure, StructureChange } from '@lasuatos/contracts';
import { Building2, CalendarPlus, ChevronRight, History, Landmark, MoreHorizontal, Plus, TriangleAlert } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { lookupAdministrator, type AdministratorAccount } from '../../lib/current-account';
import { loadInstitutionStructure } from '../../lib/structure-api';
import { primeResource, useResource } from '../../lib/resource';
import { Badge, Button, EmptyState, Menu, PageHeader, SegmentedControl, Stat, Stats } from '../ds';
import { useFeedback } from '../feedback';
import { GuideButton } from '../shell/guide-button';
import { useClock } from '../take-attendance/hooks';
import { SearchField } from '../ui/search-field';
import { Select } from '../ui/select';
import { ChangeList, CodeChip, DepartmentSheet, FacultyDetailSheet, SessionSheet, type Actions } from './detail-sheets';
import {
  ACTIVITY_DAYS, checkKey, checksFor, checkShort, checkText, countStructure, dateLabel, departmentChecks, departmentRows, failure, matchesQuery, PATH,
  plural, rangeLabel, readView, SESSION_BADGE, sessionSlug, sessionState, shortName, slug, STRUCTURE_KEY, todayIn, viewHref, whenLabel,
  yearsLabel, type AcademicSession, type Check, type Department, type DepartmentRow, type Faculty, type Show, type Tab, type View,
} from './format';
import { DepartmentFormSheet, FacultyFormSheet, SessionFormSheet } from './forms';
import { TermCard } from './term-card';
import './structure.css';

type Data = { readonly account: AdministratorAccount; readonly structure: InstitutionStructure };
type Answer = { readonly kind: 'ok'; readonly data: Data } | { readonly kind: 'denied'; readonly message: string };

async function load(signal: AbortSignal): Promise<Answer> {
  const session = await lookupAdministrator('manage the academic structure');
  if (session.kind === 'error') return { kind: 'denied', message: session.message };
  try {
    return { kind: 'ok', data: { account: session.account, structure: await loadInstitutionStructure(signal) } };
  } catch (caught) {
    if (caught instanceof DOMException) throw caught;
    if ((caught as { status?: number } | null)?.status === 403) return { kind: 'denied', message: failure(caught, 'You can’t open the academic structure.') };
    throw new Error(failure(caught, 'The academic structure did not load. Try again.'));
  }
}

/** Departments to search among before the search field appears. */
const SEARCH_FROM = 8;

/**
 * Academic structure: the faculties and departments people are placed in, how long each
 * programme runs (which sets students' levels), and the academic sessions and semesters that
 * date everything. Opens on where today falls in the session and anything that needs setting up.
 */
export function Structure() {
  const resource = useResource(STRUCTURE_KEY, load, { maxAge: 30_000 });
  const answer = resource.data;
  if (answer?.kind === 'denied') {
    return (
      <div className="str">
        <PageHeader title="Academic structure" />
        <div className="ds-card">
          <EmptyState
            icon={<Landmark size={26} strokeWidth={1.9} />}
            title="Administrators look after the academic structure"
            message={answer.message}
            action={<Button href="/" variant="tinted">Go home</Button>}
          />
        </div>
      </div>
    );
  }
  if (!answer) {
    return (
      <div className="str">
        <Header />
        {resource.error ? (
          <div className="ds-card">
            <EmptyState error title="The academic structure did not load" message={resource.error} action={<Button variant="tinted" onClick={resource.reload}>Try again</Button>} />
          </div>
        ) : <PageSkeleton />}
      </div>
    );
  }
  return <Workspace data={answer.data} reload={resource.reload} />;
}

type HeaderAction = { readonly label: string; readonly icon: ReactNode; readonly onSelect: () => void };

function Header({ subtitle, primary, more = [] }: Readonly<{ subtitle?: string | undefined; primary?: HeaderAction | undefined; more?: readonly HeaderAction[] }>) {
  return (
    <PageHeader
      title="Academic structure"
      subtitle={subtitle}
      actions={(
        <div className="str-head-actions">
          {primary ? (
            <>
              <Button className="str-add-wide" onClick={primary.onSelect} icon={primary.icon}>{primary.label}</Button>
              <button className="ds-icon-btn is-filled str-add-narrow" type="button" aria-label={primary.label} data-tip={primary.label} onClick={primary.onSelect}>
                {primary.icon}
              </button>
            </>
          ) : null}
          {more.length ? (
            <Menu
              label="More structure actions"
              icon={<MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" />}
              items={more.map((item) => ({ label: item.label, icon: item.icon, onSelect: item.onSelect }))}
            />
          ) : null}
          <GuideButton page={PATH} label="Academic structure" />
        </div>
      )}
    />
  );
}

type Form =
  | { readonly kind: 'none' }
  | { readonly kind: 'faculty'; readonly faculty: Faculty | null }
  | { readonly kind: 'department'; readonly department: Department | null; readonly facultyId: string | null }
  | { readonly kind: 'session'; readonly session: AcademicSession | null };

const TAB_LABEL: Readonly<Record<Tab, string>> = { departments: 'Departments', sessions: 'Sessions', history: 'Changes' };
const SHOW_LABEL: Readonly<Record<Show, string>> = { all: 'All departments', attention: 'Need a look', inactive: 'Inactive' };

function Workspace({ data, reload }: Readonly<{ data: Data; reload: () => void }>) {
  const router = useRouter();
  const pathname = usePathname() ?? PATH;
  const params = useSearchParams();
  const view = readView(params);
  const now = useClock('fifteen');
  const feedback = useFeedback();
  const [query, setQuery] = useState('');
  const [form, setForm] = useState<Form>({ kind: 'none' });
  const { structure, account } = data;
  const { permissions } = structure;

  const today = useMemo(() => todayIn(structure.academicSessions, now), [structure.academicSessions, now]);
  const checks = useMemo(() => checksFor(structure, now), [structure, now]);
  const counts = useMemo(() => countStructure(structure.faculties), [structure.faculties]);
  const rows = useMemo(() => departmentRows(structure.faculties), [structure.faculties]);
  const checksByDepartment = useMemo(() => {
    const map = new Map<string, Check[]>();
    for (const row of rows) map.set(row.id, departmentChecks(row, today));
    return map;
  }, [rows, today]);
  const flagged = rows.filter((row) => (checksByDepartment.get(row.id) ?? []).length > 0);
  const inactive = rows.filter((row) => !row.isActive || !row.faculty.isActive);
  const sessions = useMemo(
    () => [...structure.academicSessions].sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt)),
    [structure.academicSessions],
  );
  const addable = structure.faculties.filter((faculty) => faculty.canAddDepartment && faculty.isActive);

  const selectedDepartment = view.department ? rows.find((row) => slug(row.code) === view.department) ?? null : null;
  const selectedFaculty = view.faculty ? structure.faculties.find((faculty) => slug(faculty.code) === view.faculty) ?? null : null;
  const selectedSession = view.session ? structure.academicSessions.find((session) => sessionSlug(session.code) === view.session) ?? null : null;

  function go(next: Partial<View>) {
    router.replace(viewHref(pathname, { ...view, ...next }), { scroll: false });
  }
  const closed = { department: null, faculty: null, session: null } as const;

  // A link to something that isn't here (renamed code, another scope) quietly drops it.
  useEffect(() => {
    const stale = (view.department && !selectedDepartment) || (view.faculty && !selectedFaculty) || (view.session && !selectedSession);
    if (stale) {
      router.replace(viewHref(pathname, {
        ...view,
        department: selectedDepartment ? view.department : null,
        faculty: selectedFaculty ? view.faculty : null,
        session: selectedSession ? view.session : null,
      }), { scroll: false });
    }
  }, [view, selectedDepartment, selectedFaculty, selectedSession, router, pathname]);

  /** Fetches the structure again and waits for it, so the next screen shows the change. */
  async function refresh(message: string) {
    try {
      const fresh = await loadInstitutionStructure();
      primeResource(STRUCTURE_KEY, { kind: 'ok', data: { ...data, structure: fresh } } satisfies Answer);
    } catch {
      reload();
    }
    feedback.toast(message);
  }

  const actions: Actions = {
    openDepartment: (department) => go({ ...closed, department: slug(department.code) }),
    openFaculty: (faculty) => go({ ...closed, faculty: slug(faculty.code) }),
    editDepartment: (department) => setForm({ kind: 'department', department, facultyId: null }),
    addDepartment: (faculty) => setForm({ kind: 'department', department: null, facultyId: faculty?.id ?? null }),
    renameFaculty: (faculty) => setForm({ kind: 'faculty', faculty }),
    editSession: (session) => setForm({ kind: 'session', session }),
    startSession: () => setForm({ kind: 'session', session: null }),
    refresh,
  };
  const openSession = (session: AcademicSession) => go({ ...closed, session: sessionSlug(session.code) });

  async function saved(message: string, after?: { readonly department?: string; readonly faculty?: string; readonly session?: string }) {
    await refresh(message);
    setForm({ kind: 'none' });
    if (after?.department) go({ ...closed, department: slug(after.department), show: 'all' });
    else if (after?.faculty) go({ ...closed, faculty: slug(after.faculty) });
    else if (after?.session) go({ ...closed, session: sessionSlug(after.session) });
  }

  // The header's main button follows the tab; everything else sits in the menu.
  const addDepartment: HeaderAction | null = addable.length
    ? { label: 'Add department', icon: <Plus size={18} strokeWidth={2.2} aria-hidden="true" />, onSelect: () => actions.addDepartment(null) }
    : null;
  const startSession: HeaderAction | null = permissions.manageSessions
    ? { label: 'New session', icon: <CalendarPlus size={18} strokeWidth={2.1} aria-hidden="true" />, onSelect: actions.startSession }
    : null;
  const addFaculty: HeaderAction | null = permissions.manageFaculties
    ? { label: 'Add faculty', icon: <Building2 size={18} strokeWidth={2.1} aria-hidden="true" />, onSelect: () => setForm({ kind: 'faculty', faculty: null }) }
    : null;
  const primary = view.tab === 'sessions' ? startSession ?? addDepartment : addDepartment ?? startSession;
  const more = [addDepartment, addFaculty, startSession].filter((item): item is HeaderAction => Boolean(item) && item !== primary);

  const topChecks = checks.filter((check) => check.kind === 'no_session' || check.kind === 'session_ended' || check.kind === 'next_session'
    || check.kind === 'no_semesters' || check.kind === 'empty_faculty');

  return (
    <div className="str">
      <Header subtitle={account.scope.label} primary={primary ?? undefined} more={more} />

      <div className="str-top">
        <TermCard
          today={today}
          now={now}
          canManage={permissions.manageSessions}
          onOpen={openSession}
          onStart={actions.startSession}
          onSessions={() => go({ ...closed, tab: 'sessions' })}
        />
        <Stats label="Structure at a glance">
          <Stat label={counts.departments === 1 ? 'Department' : 'Departments'} value={counts.departments} hint={counts.inactive ? `${counts.inactive} inactive` : plural(counts.faculties, 'faculty', 'faculties')} />
          <Stat label={counts.lecturers === 1 ? 'Lecturer' : 'Lecturers'} value={counts.lecturers.toLocaleString('en-NG')} hint="active accounts" />
          <Stat label="On class lists" value={counts.classList.toLocaleString('en-NG')} hint="students" />
          <Stat label={`Classes, ${ACTIVITY_DAYS} days`} value={counts.sessions.toLocaleString('en-NG')} hint="attendance taken" tone={counts.sessions ? 'success' : undefined} />
        </Stats>
      </div>

      {topChecks.length || flagged.length ? (
        <Attention
          checks={topChecks}
          flagged={flagged}
          checksByDepartment={checksByDepartment}
          onAct={(check) => {
            switch (check.kind) {
              case 'no_session':
                if (structure.academicSessions.length) go({ ...closed, tab: 'sessions' });
                else actions.startSession();
                break;
              case 'session_ended':
                if (check.next) openSession(check.next); else actions.startSession();
                break;
              case 'next_session': actions.startSession(); break;
              case 'no_semesters': actions.editSession(check.session); break;
              case 'empty_faculty': actions.addDepartment(check.faculty); break;
              default: break;
            }
          }}
          onReview={() => {
            go({ ...closed, tab: 'departments', show: 'attention' });
            window.requestAnimationFrame(() => document.getElementById('str-tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
          }}
        />
      ) : null}

      <div className="str-tools" id="str-tabs">
        <SegmentedControl
          label="Section"
          value={view.tab}
          onChange={(tab) => go({ tab, show: 'all' })}
          segments={(['departments', 'sessions', 'history'] as const).map((value) => ({ value, label: TAB_LABEL[value] }))}
        />
        {view.tab === 'departments' && rows.length >= SEARCH_FROM ? (
          <SearchField className="str-find" value={query} onValueChange={setQuery} placeholder="Code or name" aria-label="Find a department" />
        ) : null}
        {view.tab === 'departments' && (flagged.length || inactive.length || view.show !== 'all') ? (
          <label className="str-show">
            <span className="sr-only">Show</span>
            <Select
              value={view.show}
              aria-label="Show"
              onValueChange={(show) => go({ show: show as Show })}
              options={[
                { value: 'all', label: SHOW_LABEL.all, description: String(rows.length) },
                { value: 'attention', label: SHOW_LABEL.attention, description: String(flagged.length) },
                { value: 'inactive', label: SHOW_LABEL.inactive, description: String(inactive.length) },
              ]}
            />
          </label>
        ) : null}
      </div>

      {view.tab === 'departments' ? (
        <DepartmentList
          faculties={structure.faculties}
          checksByDepartment={checksByDepartment}
          show={view.show}
          query={query}
          now={now}
          canAddFaculty={permissions.manageFaculties}
          onOpen={actions.openDepartment}
          onOpenFaculty={actions.openFaculty}
          onAdd={actions.addDepartment}
          onAddFaculty={() => setForm({ kind: 'faculty', faculty: null })}
          onReset={() => { setQuery(''); go({ show: 'all' }); }}
        />
      ) : view.tab === 'sessions' ? (
        <SessionList sessions={sessions} now={now} canManage={permissions.manageSessions} onOpen={openSession} onStart={actions.startSession} />
      ) : (
        <Changes structure={structure} now={now} onOpen={(change) => {
          if (change.targetType === 'academic_session') {
            const session = structure.academicSessions.find((item) => item.id === change.targetId);
            if (session) openSession(session);
          } else if (change.targetType === 'faculty') {
            const faculty = structure.faculties.find((item) => item.id === change.targetId);
            if (faculty) actions.openFaculty(faculty);
          } else {
            const department = rows.find((item) => item.id === change.targetId);
            if (department) actions.openDepartment(department);
          }
        }} />
      )}

      <DepartmentSheet department={selectedDepartment} structure={structure} now={now} actions={actions} onClose={() => go(closed)} />
      <FacultyDetailSheet faculty={selectedFaculty} structure={structure} now={now} actions={actions} onClose={() => go(closed)} />
      <SessionSheet session={selectedSession} structure={structure} now={now} actions={actions} onClose={() => go(closed)} />

      <DepartmentFormSheet
        open={form.kind === 'department'}
        department={form.kind === 'department' ? form.department : null}
        faculties={structure.faculties}
        facultyId={form.kind === 'department' ? form.facultyId : null}
        onClose={() => setForm({ kind: 'none' })}
        onSaved={saved}
      />
      {permissions.manageFaculties ? (
        <FacultyFormSheet
          open={form.kind === 'faculty'}
          faculty={form.kind === 'faculty' ? form.faculty : null}
          onClose={() => setForm({ kind: 'none' })}
          onSaved={saved}
        />
      ) : null}
      {permissions.manageSessions ? (
        <SessionFormSheet
          open={form.kind === 'session'}
          session={form.kind === 'session' ? form.session : null}
          sessions={structure.academicSessions}
          onClose={() => setForm({ kind: 'none' })}
          onSaved={saved}
        />
      ) : null}
    </div>
  );
}

/* ---------- needs a look ---------- */

const ACT_LABEL: Partial<Record<Check['kind'], (check: Check) => string>> = {
  no_session: () => 'Set one up',
  session_ended: (check) => (check.kind === 'session_ended' && check.next ? `Open ${check.next.code}` : 'Start the next'),
  next_session: () => 'Set it up',
  no_semesters: () => 'Add semesters',
  empty_faculty: () => 'Add department',
};

function Attention({ checks, flagged, checksByDepartment, onAct, onReview }: Readonly<{
  checks: readonly Check[];
  flagged: readonly DepartmentRow[];
  checksByDepartment: ReadonlyMap<string, readonly Check[]>;
  onAct: (check: Check) => void;
  onReview: () => void;
}>) {
  const canAddTo = (check: Check) => check.kind !== 'empty_faculty' || check.faculty.canAddDepartment;
  return (
    <section className="ds-section str-attention" aria-labelledby="str-attention-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="str-attention-title">Needs a look</h2>
        <span className="ds-section-aside">{plural(checks.length + (flagged.length ? 1 : 0), 'item')}</span>
      </div>
      <ul className="ds-list str-attention-list">
        {checks.map((check) => {
          const text = checkText(check);
          const label = ACT_LABEL[check.kind]?.(check);
          return (
            <li key={checkKey(check)} className="str-attention-row">
              <TriangleAlert className="str-attention-icon" size={18} strokeWidth={2.2} aria-hidden="true" />
              <div className="str-attention-body">
                <strong>{text.title}</strong>
                <p>{text.detail}</p>
              </div>
              {label && canAddTo(check) ? <Button size="sm" variant="tinted" onClick={() => onAct(check)}>{label}</Button> : null}
            </li>
          );
        })}
        {flagged.length ? (
          <li className="str-attention-row">
            <TriangleAlert className="str-attention-icon" size={18} strokeWidth={2.2} aria-hidden="true" />
            <div className="str-attention-body">
              <strong>{flagged.length === 1 ? `${flagged[0]!.code} needs a look` : `${flagged.length} departments need a look`}</strong>
              <p>{departmentSummary(flagged, checksByDepartment)}</p>
            </div>
            <Button size="sm" variant="tinted" onClick={onReview}>Review</Button>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/** "No lecturers: CVE, PHY · No class list: CVE · No classes in 30 days: CPE". */
function departmentSummary(flagged: readonly DepartmentRow[], checksByDepartment: ReadonlyMap<string, readonly Check[]>): string {
  const missing = (kind: Check['kind']) => flagged.filter((row) => (checksByDepartment.get(row.id) ?? []).some((check) => check.kind === kind)).map((row) => row.code);
  const parts = [
    [missing('no_lecturers'), 'no lecturers'],
    [missing('no_class_list'), 'no class list'],
    [missing('quiet'), `no classes in ${ACTIVITY_DAYS} days`],
  ] as const;
  return parts.filter(([codes]) => codes.length).map(([codes, what]) => `${what}: ${codes.join(', ')}`).join(' · ').replace(/^./, (first) => first.toUpperCase());
}

/* ---------- departments ---------- */

function DepartmentList({ faculties, checksByDepartment, show, query, now, canAddFaculty, onOpen, onOpenFaculty, onAdd, onAddFaculty, onReset }: Readonly<{
  faculties: readonly Faculty[];
  checksByDepartment: ReadonlyMap<string, readonly Check[]>;
  show: Show;
  query: string;
  now: number;
  canAddFaculty: boolean;
  onOpen: (department: Department) => void;
  onOpenFaculty: (faculty: Faculty) => void;
  onAdd: (faculty: Faculty) => void;
  onAddFaculty: () => void;
  onReset: () => void;
}>) {
  const narrowed = show !== 'all' || Boolean(query.trim());
  const groups = faculties.map((faculty) => {
    const departments = faculty.departments
      .map((department): DepartmentRow => ({ ...department, faculty }))
      .filter((row) => {
        const off = !row.isActive || !faculty.isActive;
        if (show === 'attention' && !(checksByDepartment.get(row.id) ?? []).length) return false;
        if (show === 'inactive' && !off) return false;
        return matchesQuery(row, query);
      })
      .sort((a, b) => Number(!a.isActive) - Number(!b.isActive) || a.code.localeCompare(b.code));
    return { faculty, departments };
  }).filter((group) => !narrowed || group.departments.length || (show === 'inactive' && !group.faculty.isActive && !query.trim()));

  if (!groups.length) {
    return (
      <div className="ds-card str-none">
        <EmptyState
          icon={<Landmark size={26} strokeWidth={1.9} />}
          title={query.trim() ? `Nothing matches “${query.trim()}”` : show === 'attention' ? 'Every department is set up' : show === 'inactive' ? 'Nothing is inactive' : 'No faculties yet'}
          message={narrowed ? 'Try another search or filter.' : canAddFaculty ? 'Add a faculty, then its departments.' : 'An institution administrator adds faculties and departments.'}
          action={narrowed
            ? <Button variant="tinted" onClick={onReset}>Show all departments</Button>
            : canAddFaculty ? <Button variant="tinted" onClick={onAddFaculty}>Add a faculty</Button> : undefined}
        />
      </div>
    );
  }

  return (
    <>
      {groups.map(({ faculty, departments }, index) => {
        const id = `str-fac-${faculty.id}`;
        return (
          <section key={faculty.id} className={`ds-section str-faculty${faculty.isActive ? '' : ' is-inactive'}`} aria-labelledby={id}>
            <div className="ds-section-head str-faculty-head">
              <h2 className="ds-section-title" id={id}>
                <button className="str-faculty-name" type="button" onClick={() => onOpenFaculty(faculty)}>
                  <span className="str-ellipsis">{shortName(faculty.name)}</span>
                  <ChevronRight size={16} strokeWidth={2.4} aria-hidden="true" />
                </button>
              </h2>
              {!faculty.isActive ? <Badge tone="neutral">Inactive</Badge> : null}
              <span className="ds-section-aside">{plural(faculty.departments.filter((department) => department.isActive).length, 'department')}</span>
              {faculty.canAddDepartment && faculty.isActive ? (
                <button className="ds-icon-btn str-faculty-add" type="button" aria-label={`Add a department to ${shortName(faculty.name)}`} data-tip="Add department" onClick={() => onAdd(faculty)}>
                  <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
                </button>
              ) : null}
            </div>
            {index === 0 && departments.length ? (
              <div className="str-columns" aria-hidden="true">
                <span>Department</span><span>Years</span><span>Lecturers</span><span>On list</span><span>Joined</span><span>Classes</span><span>Last class</span>
              </div>
            ) : null}
            {departments.length ? (
              <ul className="ds-list str-list">
                {departments.map((row) => (
                  <DepartmentLine key={row.id} row={row} checks={checksByDepartment.get(row.id) ?? []} now={now} onOpen={() => onOpen(row)} />
                ))}
              </ul>
            ) : (
              <div className="ds-list str-empty">
                <p>{faculty.departments.length ? 'All its departments are inactive.' : 'No departments yet.'}</p>
                {faculty.canAddDepartment && faculty.isActive ? (
                  <Button size="sm" variant="tinted" onClick={() => onAdd(faculty)} icon={<Plus size={16} aria-hidden="true" />}>Add department</Button>
                ) : null}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}

function DepartmentLine({ row, checks, now, onOpen }: Readonly<{ row: DepartmentRow; checks: readonly Check[]; now: number; onOpen: () => void }>) {
  const off = !row.isActive || !row.faculty.isActive;
  const first = checks[0];
  const facts = [
    `${row.programmeYears} yrs`,
    plural(row.lecturerCount, 'lecturer'),
    `${row.classListCount.toLocaleString('en-NG')} on list`,
  ].join(' · ');
  const warn = (value: number) => (!off && value === 0 ? ' is-warning' : '');
  return (
    <li>
      <button className={`ds-row str-row${off ? ' is-inactive' : ''}`} type="button" onClick={onOpen}>
        <CodeChip code={row.code} dim={off} />
        <span className="ds-row-body">
          <span className="ds-row-title str-ellipsis">{shortName(row.name)}</span>
          {off ? (
            <span className="ds-row-subtitle">Inactive</span>
          ) : first ? (
            <span className="ds-row-subtitle str-note is-warning">
              <TriangleAlert size={13} strokeWidth={2.4} aria-hidden="true" />
              <span className="str-ellipsis">{checks.map(checkShort).join(' · ')}</span>
            </span>
          ) : <span className="ds-row-subtitle str-ellipsis str-narrow">{facts}</span>}
          {!off && first ? <span className="sr-only">{`. ${facts}`}</span> : null}
        </span>
        <span className="str-col str-col-num">{row.programmeYears}</span>
        <span className={`str-col str-col-num${warn(row.lecturerCount)}`}>{row.lecturerCount.toLocaleString('en-NG')}</span>
        <span className={`str-col str-col-num${warn(row.classListCount)}`}>{row.classListCount.toLocaleString('en-NG')}</span>
        <span className="str-col str-col-num">{row.studentCount.toLocaleString('en-NG')}</span>
        <span className="str-col str-col-num">{row.recentSessions.toLocaleString('en-NG')}</span>
        <span className="str-col">{row.lastSessionAt ? whenLabel(row.lastSessionAt, now) : <span className="str-dim">Never</span>}</span>
        <span className="sr-only">{`, ${yearsLabel(row.programmeYears)}, ${plural(row.recentSessions, 'class', 'classes')} in ${ACTIVITY_DAYS} days`}</span>
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </li>
  );
}

/* ---------- sessions ---------- */

function SessionList({ sessions, now, canManage, onOpen, onStart }: Readonly<{
  sessions: readonly AcademicSession[];
  now: number;
  canManage: boolean;
  onOpen: (session: AcademicSession) => void;
  onStart: () => void;
}>) {
  if (!sessions.length) {
    return (
      <div className="ds-card str-none">
        <EmptyState
          icon={<CalendarPlus size={26} strokeWidth={1.9} />}
          title="No academic sessions yet"
          message={canManage ? 'Add the current session and its semesters, so levels and registers follow the calendar.' : 'An institution administrator adds sessions.'}
          action={canManage ? <Button variant="tinted" onClick={onStart}>Start a session</Button> : undefined}
        />
      </div>
    );
  }
  return (
    <section className="ds-section" aria-labelledby="str-sessions-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="str-sessions-title">Academic sessions</h2>
        <span className="ds-section-aside">{plural(sessions.length, 'session')}</span>
      </div>
      <ul className="ds-list str-sessions">
        {sessions.map((session) => {
          const badge = SESSION_BADGE[sessionState(session, now)];
          return (
            <li key={session.id}>
              <button className="ds-row str-session-row" type="button" onClick={() => onOpen(session)}>
                <span className="str-session-code">{session.code}</span>
                <span className="ds-row-body">
                  <span className="ds-row-title str-ellipsis str-session-range">{rangeLabel(session.startsAt, session.endsAt)}</span>
                  <span className="ds-row-subtitle str-ellipsis">
                    {session.semesters.length ? session.semesters.map((semester) => `${semester.name.replace(/\s+semester$/i, '')} ${dateLabel(semester.startsAt, now)}`).join(' · ') : 'No semesters'}
                  </span>
                </span>
                <Badge tone={badge.tone}>{badge.label}</Badge>
                <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/* ---------- history ---------- */

function Changes({ structure, now, onOpen }: Readonly<{ structure: InstitutionStructure; now: number; onOpen: (change: StructureChange) => void }>) {
  if (!structure.recentChanges.length) {
    return (
      <div className="ds-card str-none">
        <EmptyState icon={<History size={26} strokeWidth={1.9} />} title="No changes yet" message="Changes to faculties, departments and sessions show here, with who made them." />
      </div>
    );
  }
  return (
    <section className="ds-section" aria-labelledby="str-changes-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="str-changes-title">Recent changes</h2>
        <Button size="sm" variant="plain" href="/admin/audit">Audit log</Button>
      </div>
      <ChangeList changes={structure.recentChanges} now={now} structure={structure} onOpen={onOpen} label="Recent changes" />
    </section>
  );
}

/* ---------- loading ---------- */

function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading the academic structure">
      <div className="str-top" aria-hidden="true">
        <div className="str-term"><span className="ds-skeleton" style={{ width: '40%', height: 14 }} /><span className="ds-skeleton" style={{ width: '60%', height: 26, marginTop: 10 }} /><span className="ds-skeleton" style={{ width: '100%', height: 10, marginTop: 22 }} /></div>
        <div className="ds-stats">
          {[0, 1, 2, 3].map((item) => <div key={item} className="ds-stat"><span className="ds-skeleton" style={{ width: '60%', height: 14 }} /><span className="ds-skeleton" style={{ width: 48, height: 28, marginTop: 8 }} /></div>)}
        </div>
      </div>
      <div className="ds-section" aria-hidden="true">
        <div className="ds-section-head"><span className="ds-skeleton" style={{ width: 160, height: 20 }} /></div>
        <ul className="ds-list">
          {[70, 52, 64, 46].map((width) => (
            <li key={width}>
              <div className="ds-row str-row">
                <span className="str-code ds-skeleton" />
                <span className="ds-row-body"><span className="ds-skeleton" style={{ width: `${width}%`, height: 16 }} /><span className="ds-skeleton" style={{ width: '30%', height: 12, marginTop: 6 }} /></span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

