'use client';

import type { InstitutionStructure, StructureChange } from '@lasuatos/contracts';
import {
  Ban, BarChart3, CalendarCheck, ChevronRight, ClipboardList, MoreHorizontal, Pencil, Plus, RotateCcw, TriangleAlert, UserPlus,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { setCurrentAcademicSession, updateDepartment, updateFaculty } from '../../lib/structure-api';
import { Badge, Button, Menu, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import {
  ACTIVITY_DAYS, agoLabel, changesFor, checkText, departmentChecks, failure, fullDate, levelsLabel, plural, rangeLabel, semesterLine,
  SESSION_BADGE, sessionState, shortName, targetName, todayIn, yearsLabel, type AcademicSession, type Check, type Department, type DepartmentRow, type Faculty,
} from './format';
import { Timeline } from './term-card';

/** What every sheet can do on the page: open another sheet, open a form, or wait for fresh data. */
export type Actions = {
  readonly openDepartment: (department: Department) => void;
  readonly openFaculty: (faculty: Faculty) => void;
  readonly editDepartment: (department: Department) => void;
  readonly addDepartment: (faculty: Faculty | null) => void;
  readonly renameFaculty: (faculty: Faculty) => void;
  readonly editSession: (session: AcademicSession) => void;
  readonly startSession: () => void;
  /** Fetches the structure again and waits for it, then toasts `message`. */
  readonly refresh: (message: string) => Promise<void>;
};

/** Keeps the last item while a sheet animates closed. */
function useLast<T>(item: T | null): T | null {
  const [last, setLast] = useState(item);
  if (item && item !== last) setLast(item);
  return item ?? last;
}

/** After a button replaces itself (Deactivate becomes Reactivate), keep focus inside the sheet. */
function keepFocus() {
  window.requestAnimationFrame(() => {
    if (document.activeElement !== document.body) return;
    const sheet = [...document.querySelectorAll<HTMLElement>('dialog[open]')].pop();
    sheet?.querySelector<HTMLElement>('.str-actions button, .str-actions a')?.focus();
  });
}

/* ---------- shared pieces ---------- */

export function CodeChip({ code, dim = false, large = false }: Readonly<{ code: string; dim?: boolean; large?: boolean }>) {
  return <span className={`str-code${dim ? ' is-dim' : ''}${large ? ' is-large' : ''}`}>{code}</span>;
}

function Figures({ items }: Readonly<{ items: readonly { readonly value: ReactNode; readonly label: string; readonly tone?: 'warning' | undefined }[] }>) {
  return (
    <div className="str-figures">
      {items.map((item) => (
        <div key={item.label} className={item.tone ? `is-${item.tone}` : undefined}>
          <strong>{item.value}</strong>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}

function Block({ id, title, children }: Readonly<{ id: string; title: string; children: ReactNode }>) {
  return (
    <section className="str-block" aria-labelledby={id}>
      <h3 className="str-block-title" id={id}>{title}</h3>
      {children}
    </section>
  );
}

function Callout({ icon, children }: Readonly<{ icon: ReactNode; children: ReactNode }>) {
  return <p className="str-callout">{icon}<span>{children}</span></p>;
}

function CheckList({ checks, action }: Readonly<{ checks: readonly Check[]; action: (check: Check) => ReactNode }>) {
  if (!checks.length) return null;
  return (
    <ul className="str-checks" aria-label="Needs a look">
      {checks.map((check) => {
        const text = checkText(check);
        return (
          <li key={check.kind} className="str-check">
            <TriangleAlert className="str-check-icon" size={18} strokeWidth={2.2} aria-hidden="true" />
            <div className="str-check-body">
              <strong>{text.title}</strong>
              <p>{text.detail}</p>
              <div className="str-check-links">{action(check)}</div>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Recent changes, newest first; with `structure`, each names what it changed. */
export function ChangeList({ changes, now, structure, onOpen, label }: Readonly<{
  changes: readonly StructureChange[];
  now: number;
  structure?: InstitutionStructure | undefined;
  onOpen?: ((change: StructureChange) => void) | undefined;
  label: string;
}>) {
  return (
    <ul className="ds-list str-changes" aria-label={label}>
      {changes.map((change) => {
        const target = structure ? targetName(change, structure) : null;
        const body = (
          <>
            <span className="ds-row-body">
              {target ? <span className="ds-row-title str-ellipsis">{target}</span> : null}
              <span className={target ? 'ds-row-subtitle str-change-summary' : 'ds-row-title str-change-summary'}>{change.summary}</span>
              <span className="ds-row-subtitle str-ellipsis">{change.actorName ?? 'Someone no longer here'} · {agoLabel(change.at, now)}</span>
            </span>
            {onOpen ? <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" /> : null}
          </>
        );
        return (
          <li key={change.id}>
            {onOpen ? (
              <button className="ds-row str-change" type="button" onClick={() => onOpen(change)}>{body}</button>
            ) : <div className="ds-row str-change">{body}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function History_({ changes, now, id }: Readonly<{ changes: readonly StructureChange[]; now: number; id: string }>) {
  if (!changes.length) return null;
  return (
    <Block id={id} title="Recent changes">
      <ChangeList changes={changes.slice(0, 5)} now={now} label="Recent changes" />
    </Block>
  );
}

/* ---------- a department ---------- */

export function DepartmentSheet({ department, structure, now, actions, onClose }: Readonly<{
  department: DepartmentRow | null;
  structure: InstitutionStructure;
  now: number;
  actions: Actions;
  onClose: () => void;
}>) {
  const shown = useLast(department);
  return (
    <Sheet open={department !== null} onClose={onClose} title={shown?.code ?? ''}>
      {shown ? <DepartmentDetail key={shown.id} department={shown} structure={structure} now={now} actions={actions} /> : null}
    </Sheet>
  );
}

function DepartmentDetail({ department, structure, now, actions }: Readonly<{
  department: DepartmentRow;
  structure: InstitutionStructure;
  now: number;
  actions: Actions;
}>) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const { faculty } = department;
  const checks = departmentChecks(department, todayIn(structure.academicSessions, now));
  const changes = changesFor(structure.recentChanges, department.id);
  const name = shortName(department.name);

  async function setActive(isActive: boolean) {
    if (!isActive) {
      const sure = await feedback.confirm({
        title: `Deactivate ${department.code}?`,
        body: `${name} leaves sign-up, staff invitations and new course offerings. Its people, class list and records are kept, and you can reactivate it any time.`,
        confirmLabel: 'Deactivate',
        tone: 'danger',
      });
      if (!sure) return;
    }
    setBusy(true);
    try {
      await updateDepartment(department.id, { isActive });
      await actions.refresh(isActive ? `${department.code} is active again.` : `${department.code} was deactivated.`);
      keepFocus();
    } catch (caught) {
      feedback.toast(failure(caught, isActive ? 'The department was not reactivated. Try again.' : 'The department was not deactivated. Try again.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  const reportHref = `/admin/attendance?period=month&department=${encodeURIComponent(department.id)}`;
  const classListHref = `/class-list?department=${encodeURIComponent(department.code.toLowerCase())}`;
  const active = department.isActive && faculty.isActive;

  return (
    <div className="str-detail">
      <div className="str-detail-head">
        {!department.isActive || !faculty.isActive ? (
          <div className="str-detail-badges"><Badge tone="neutral">{department.isActive ? 'Faculty inactive' : 'Inactive'}</Badge></div>
        ) : null}
        <h3 className="str-detail-title">{department.name}</h3>
        <p className="str-detail-facts">
          <button className="str-link" type="button" onClick={() => actions.openFaculty(faculty)}>{shortName(faculty.name)}</button>
          <span aria-hidden="true"> · </span>
          {yearsLabel(department.programmeYears)}, {levelsLabel(department.programmeYears)}
        </p>
      </div>

      {!department.isActive ? (
        <Callout icon={<Ban size={18} aria-hidden="true" />}>
          Inactive: not offered at sign-up, in staff invitations or for new courses. Its people and records are kept.
          {!faculty.isActive ? ` Reactivate ${shortName(faculty.name)} first to bring it back.` : ''}
        </Callout>
      ) : !faculty.isActive ? (
        <Callout icon={<Ban size={18} aria-hidden="true" />}>{shortName(faculty.name)} is inactive, so this department is hidden from sign-up and invitations too.</Callout>
      ) : null}

      <CheckList
        checks={checks}
        action={(check) => {
          if (check.kind === 'no_lecturers') return <Button size="sm" variant="tinted" href="/admin/staff?invite=1" icon={<UserPlus size={16} aria-hidden="true" />}>Invite lecturers</Button>;
          if (check.kind === 'no_class_list') return <Button size="sm" variant="tinted" href={`${classListHref}&add=1`} icon={<ClipboardList size={16} aria-hidden="true" />}>Add a class list</Button>;
          if (check.kind === 'quiet') return <Button size="sm" variant="tinted" href={reportHref} icon={<BarChart3 size={16} aria-hidden="true" />}>Open attendance</Button>;
          return null;
        }}
      />

      <div className="str-actions">
        {department.editable ? (
          <Button variant="gray" onClick={() => actions.editDepartment(department)} icon={<Pencil size={18} aria-hidden="true" />}>Edit</Button>
        ) : null}
        {active ? (
          <Button variant="gray" href={classListHref} icon={<ClipboardList size={18} aria-hidden="true" />}>Class list</Button>
        ) : null}
        {!department.isActive && department.canDeactivate && faculty.isActive ? (
          <Button variant="gray" busy={busy} onClick={() => void setActive(true)} icon={<RotateCcw size={18} aria-hidden="true" />}>Reactivate</Button>
        ) : null}
        {department.isActive ? (
          <Menu
            label={`More actions for ${department.code}`}
            title={`${department.code} · ${name}`}
            icon={<MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" />}
            items={[
              { label: 'Attendance overview', icon: <BarChart3 size={18} aria-hidden="true" />, onSelect: () => { window.location.assign(reportHref); } },
              department.canDeactivate ? { label: 'Deactivate', icon: <Ban size={18} aria-hidden="true" />, destructive: true, onSelect: () => void setActive(false) } : null,
            ]}
          />
        ) : null}
      </div>
      {!department.canDeactivate && department.editable && department.isActive ? (
        <p className="str-fine">A faculty or institution administrator can deactivate it.</p>
      ) : null}

      <Figures items={[
        { value: department.lecturerCount.toLocaleString('en-NG'), label: department.lecturerCount === 1 ? 'lecturer' : 'lecturers', tone: active && !department.lecturerCount ? 'warning' : undefined },
        { value: department.classListCount.toLocaleString('en-NG'), label: 'on class lists', tone: active && !department.classListCount ? 'warning' : undefined },
        { value: department.studentCount.toLocaleString('en-NG'), label: 'signed up' },
        { value: department.recentSessions.toLocaleString('en-NG'), label: `classes in ${ACTIVITY_DAYS} days` },
      ]} />

      <Block id="str-dept-about" title="About">
        <dl className="str-facts">
          <div><dt>Code</dt><dd>{department.code}</dd></div>
          <div><dt>Faculty</dt><dd>{faculty.name}</dd></div>
          <div><dt>Programme</dt><dd>{yearsLabel(department.programmeYears)}</dd></div>
          <div><dt>Course offerings</dt><dd>{department.courseOfferingCount.toLocaleString('en-NG')}</dd></div>
          <div><dt>Last class</dt><dd>{department.lastSessionAt ? fullDate(department.lastSessionAt) : 'None yet'}</dd></div>
        </dl>
      </Block>

      <History_ changes={changes} now={now} id="str-dept-history" />
    </div>
  );
}

/* ---------- a faculty ---------- */

export function FacultyDetailSheet({ faculty, structure, now, actions, onClose }: Readonly<{
  faculty: Faculty | null;
  structure: InstitutionStructure;
  now: number;
  actions: Actions;
  onClose: () => void;
}>) {
  const shown = useLast(faculty);
  return (
    <Sheet open={faculty !== null} onClose={onClose} title={shown?.code ?? ''}>
      {shown ? <FacultyDetail key={shown.id} faculty={shown} structure={structure} now={now} actions={actions} /> : null}
    </Sheet>
  );
}

function FacultyDetail({ faculty, structure, now, actions }: Readonly<{
  faculty: Faculty;
  structure: InstitutionStructure;
  now: number;
  actions: Actions;
}>) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const manage = structure.permissions.manageFaculties;
  const active = faculty.departments.filter((department) => department.isActive);
  const sorted = [...active, ...faculty.departments.filter((department) => !department.isActive)];
  const changes = changesFor(structure.recentChanges, faculty.id);
  const sum = (pick: (department: Department) => number) => active.reduce((total, department) => total + pick(department), 0);
  const name = shortName(faculty.name);

  async function setActive(isActive: boolean) {
    if (!isActive) {
      const sure = await feedback.confirm({
        title: `Deactivate ${name}?`,
        body: 'It leaves sign-up and staff invitations. Its departments’ records are kept, and you can reactivate it any time.',
        confirmLabel: 'Deactivate',
        tone: 'danger',
      });
      if (!sure) return;
    }
    setBusy(true);
    try {
      await updateFaculty(faculty.id, { isActive });
      await actions.refresh(isActive ? `${name} is active again. Reactivate its departments as needed.` : `${name} was deactivated.`);
      keepFocus();
    } catch (caught) {
      feedback.toast(failure(caught, isActive ? 'The faculty was not reactivated. Try again.' : 'The faculty was not deactivated. Try again.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="str-detail">
      <div className="str-detail-head">
        {!faculty.isActive ? <div className="str-detail-badges"><Badge tone="neutral">Inactive</Badge></div> : null}
        <h3 className="str-detail-title">{faculty.name}</h3>
        <p className="str-detail-facts">
          {plural(active.length, 'department')}
          {faculty.departments.length > active.length ? `, ${faculty.departments.length - active.length} inactive` : ''}
        </p>
      </div>

      {!faculty.isActive ? (
        <Callout icon={<Ban size={18} aria-hidden="true" />}>Inactive: its departments are hidden from sign-up and staff invitations. Records are kept.</Callout>
      ) : null}

      {manage && faculty.isActive && !active.length ? (
        <CheckList
          checks={[{ kind: 'empty_faculty', faculty }]}
          action={() => faculty.canAddDepartment
            ? <Button size="sm" variant="tinted" onClick={() => actions.addDepartment(faculty)} icon={<Plus size={16} aria-hidden="true" />}>Add a department</Button>
            : null}
        />
      ) : null}

      {faculty.canAddDepartment || manage ? (
        <div className="str-actions">
          {faculty.canAddDepartment && faculty.isActive ? (
            <Button variant="gray" onClick={() => actions.addDepartment(faculty)} icon={<Plus size={18} aria-hidden="true" />}>Add department</Button>
          ) : null}
          {manage ? <Button variant="gray" onClick={() => actions.renameFaculty(faculty)} icon={<Pencil size={18} aria-hidden="true" />}>Rename</Button> : null}
          {manage && !faculty.isActive ? (
            <Button variant="gray" busy={busy} onClick={() => void setActive(true)} icon={<RotateCcw size={18} aria-hidden="true" />}>Reactivate</Button>
          ) : null}
          {manage && faculty.isActive && !active.length ? (
            <Menu
              label={`More actions for ${faculty.code}`}
              title={name}
              icon={<MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" />}
              items={[{ label: 'Deactivate', icon: <Ban size={18} aria-hidden="true" />, destructive: true, onSelect: () => void setActive(false) }]}
            />
          ) : null}
        </div>
      ) : null}
      {manage && faculty.isActive && active.length ? (
        <p className="str-fine">To deactivate {name}, deactivate its {plural(active.length, 'active department')} first.</p>
      ) : null}

      <Figures items={[
        { value: active.length, label: active.length === 1 ? 'department' : 'departments' },
        { value: sum((department) => department.lecturerCount).toLocaleString('en-NG'), label: 'lecturers' },
        { value: sum((department) => department.classListCount).toLocaleString('en-NG'), label: 'on class lists' },
        { value: sum((department) => department.recentSessions).toLocaleString('en-NG'), label: `classes in ${ACTIVITY_DAYS} days` },
      ]} />

      {sorted.length ? (
        <Block id="str-fac-departments" title="Departments">
          <ul className="ds-list str-mini">
            {sorted.map((department) => (
              <li key={department.id}>
                <button className="ds-row str-mini-row" type="button" onClick={() => actions.openDepartment(department)}>
                  <CodeChip code={department.code} dim={!department.isActive} />
                  <span className="ds-row-body">
                    <span className="ds-row-title str-ellipsis">{shortName(department.name)}</span>
                    <span className="ds-row-subtitle str-ellipsis">
                      {department.isActive
                        ? `${yearsLabel(department.programmeYears)} · ${plural(department.lecturerCount, 'lecturer')} · ${department.classListCount.toLocaleString('en-NG')} on list`
                        : 'Inactive'}
                    </span>
                  </span>
                  <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </Block>
      ) : null}

      <History_ changes={changes} now={now} id="str-fac-history" />
    </div>
  );
}

/* ---------- a session ---------- */

export function SessionSheet({ session, structure, now, actions, onClose }: Readonly<{
  session: AcademicSession | null;
  structure: InstitutionStructure;
  now: number;
  actions: Actions;
  onClose: () => void;
}>) {
  const shown = useLast(session);
  return (
    <Sheet open={session !== null} onClose={onClose} title={shown?.code ?? ''}>
      {shown ? <SessionDetail key={shown.id} session={shown} structure={structure} now={now} actions={actions} /> : null}
    </Sheet>
  );
}

function SessionDetail({ session, structure, now, actions }: Readonly<{
  session: AcademicSession;
  structure: InstitutionStructure;
  now: number;
  actions: Actions;
}>) {
  const feedback = useFeedback();
  const [busy, setBusy] = useState(false);
  const manage = structure.permissions.manageSessions;
  const state = sessionState(session, now);
  const badge = SESSION_BADGE[state];
  const changes = changesFor(structure.recentChanges, session.id);
  const current = structure.academicSessions.find((item) => item.isCurrent);

  async function makeCurrent() {
    const sure = await feedback.confirm({
      title: `Make ${session.code} the current session?`,
      body: `Every student’s level is worked out from the current session, so levels change for everyone at once${current ? `. ${current.code} stops being current` : ''}.`,
      confirmLabel: 'Make current',
    });
    if (!sure) return;
    setBusy(true);
    try {
      await setCurrentAcademicSession(session.id);
      await actions.refresh(`${session.code} is now the current session.`);
      keepFocus();
    } catch (caught) {
      feedback.toast(failure(caught, 'The current session was not changed. Try again.'), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="str-detail">
      <div className="str-detail-head">
        <div className="str-detail-badges"><Badge tone={badge.tone}>{badge.label}</Badge></div>
        <h3 className="str-detail-title">{rangeLabel(session.startsAt, session.endsAt)}</h3>
        <p className="str-detail-facts">{plural(session.semesters.length, 'semester')}</p>
      </div>

      {session.semesters.length ? <Timeline session={session} now={now} /> : null}

      {state === 'open' && manage ? (
        <Callout icon={<CalendarCheck size={18} aria-hidden="true" />}>Today falls in this session, but {current ? `${current.code} is` : 'no session is'} current. Levels follow the current session.</Callout>
      ) : null}

      {manage ? (
        <div className="str-actions">
          <Button variant="gray" onClick={() => actions.editSession(session)} icon={<Pencil size={18} aria-hidden="true" />}>Edit</Button>
          {!session.isCurrent ? (
            <Button variant={state === 'open' ? 'filled' : 'gray'} busy={busy} onClick={() => void makeCurrent()} icon={<CalendarCheck size={18} aria-hidden="true" />}>Make current</Button>
          ) : null}
        </div>
      ) : null}

      <Block id="str-ses-semesters" title="Semesters">
        {session.semesters.length ? (
          <ul className="ds-list str-mini">
            {session.semesters.map((semester) => {
              const done = now > Date.parse(semester.endsAt);
              const live = !done && now >= Date.parse(semester.startsAt);
              return (
                <li key={semester.id}>
                  <div className="ds-row str-mini-row">
                    <span className="ds-row-body">
                      <span className="ds-row-title">{semester.name}</span>
                      <span className="ds-row-subtitle">{semesterLine(semester, now)}</span>
                    </span>
                    {live ? <Badge tone="success">Now</Badge> : done ? <span className="str-dim">Done</span> : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : <p className="str-fine">No semesters yet. {manage ? 'Edit the session to add them.' : ''}</p>}
      </Block>

      <History_ changes={changes} now={now} id="str-ses-history" />
    </div>
  );
}
