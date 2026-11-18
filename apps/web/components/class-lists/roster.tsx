'use client';

import { academicSetLabel, type ClassList, type ClassListEntry } from '@lasuatos/contracts';
import { ChevronRight, Download, History, Megaphone, UserPlus, UsersRound } from 'lucide-react';
import { useMemo, useState, type ReactNode } from 'react';
import { shortDepartmentName } from '../../lib/department-options';
import { Badge, Button, EmptyState, Menu, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { useClock } from '../take-attendance/hooks';
import { SearchField } from '../ui/search-field';
import {
  displayName,
  filterEntries,
  initials,
  percent,
  reminderText,
  SEARCH_FROM,
  STAGE,
  STAGE_ORDER,
  stageCounts,
  stageFromParam,
  whenLabel,
  type Place,
  type StageFilter,
} from './format';
import { StageBar } from './stage-bar';
import { StudentSheet } from './student-sheet';
import { csvText } from '../../lib/csv';

type Header = (title: string, extra?: { subtitle?: string; back?: { href: string; label: string } }) => ReactNode;

const RECENT = 5;

/** One department's set: how far it has got, and every student on it. */
export function Roster({ list, place, pathname, params, header, setParam, onChanged, onAdd }: Readonly<{
  list: ClassList;
  place: Place;
  pathname: string;
  params: { get: (name: string) => string | null } | null;
  header: Header;
  setParam: (name: string, value: string | null) => void;
  onChanged: (update?: (list: ClassList) => ClassList) => void;
  onAdd: () => void;
}>) {
  const now = useClock('fifteen');
  const feedback = useFeedback();
  const [query, setQuery] = useState('');
  const [reminding, setReminding] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const stage = stageFromParam(params?.get('stage'));
  const matric = params?.get('student') ?? null;
  const selected = matric ? list.entries.find((entry) => entry.matricNumber === matric) ?? null : null;

  const split = stageCounts(list.counts);
  const shown = useMemo(() => filterEntries(list.entries, stage, query), [list.entries, stage, query]);
  const bySet = place.set === 'all' || list.entryYear === null;
  const groups = useMemo(() => groupBySet(shown, bySet), [shown, bySet]);

  const department = list.departments.find((item) => item.id === list.departmentId);
  const title = department ? shortDepartmentName(department.name) : 'Class list';
  const level = list.entries[0]?.levelLabel;
  const subtitle = [list.setLabel ?? (bySet ? 'Every set' : null), level && !bySet ? level : null].filter(Boolean).join(' · ');
  const own = list.fixedDepartmentId !== null && list.fixedEntryYear !== null;
  const back = own ? undefined : { href: pathname, label: 'Class lists' };
  const ready = percent(list.counts.ready, list.counts.total);
  const left = list.counts.total - list.counts.ready;

  function download() {
    const rows = [
      ['Matric number', 'Surname', 'First name', 'Middle name', 'LASU email', 'Set', 'Entry', 'Stage'],
      ...list.entries.map((entry) => [
        entry.matricNumber, entry.surname, entry.firstName, entry.middleName ?? '', entry.lasuEmail ?? '',
        academicSetLabel(entry.entryYear), entry.entryLevel === 100 ? 'UTME' : `Direct entry (${entry.entryLevel} Level)`, STAGE[entry.stage].label,
      ]),
    ];
    const csv = csvText(rows);
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    link.download = `${(department?.code ?? 'class').toLowerCase()}-${list.entryYear ?? 'all'}-class-list.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    feedback.toast('Class list downloaded.');
  }

  const stages = (
    <div className="cls-stages" role="group" aria-label="Show students">
      <StageButton label="Everyone" count={list.counts.total} pressed={stage === 'all'} onPress={() => setParam('stage', null)} />
      {STAGE_ORDER.map((value) => (
        <StageButton
          key={value}
          tone={STAGE[value].param}
          label={STAGE[value].label}
          count={split[value]}
          pressed={stage === value}
          onPress={() => setParam('stage', stage === value ? null : STAGE[value].param)}
        />
      ))}
    </div>
  );

  const recent = list.history.slice(0, RECENT);
  // Shown beside the list on wide screens and under it on narrow ones; one of the two is hidden.
  const history = (where: string) => (list.history.length ? (
    <section className="ds-section cls-history" aria-labelledby={`cls-history-${where}`}>
      <div className="ds-section-head">
        <h2 className="ds-section-title" id={`cls-history-${where}`}>Recent changes</h2>
        {list.history.length > RECENT ? (
          <button className="ds-section-aside cls-link" type="button" onClick={() => setHistoryOpen(true)}>See all {list.history.length}</button>
        ) : null}
      </div>
      <HistoryList events={recent} now={now} />
    </section>
  ) : null);

  return (
    <div className="cls">
      {header(title, { ...(subtitle ? { subtitle } : {}), ...(back ? { back } : {}) })}

      {list.counts.total === 0 ? (
        <div className="ds-card">
          <EmptyState
            icon={<UsersRound size={26} strokeWidth={1.9} />}
            title="No students on this list yet"
            message="Upload the class list you already have, from Excel or a CSV file, or paste the rows. Students then open their accounts with their matric number."
            action={<Button onClick={onAdd} icon={<UserPlus size={18} strokeWidth={2.2} aria-hidden="true" />}>Add students</Button>}
          />
        </div>
      ) : (
        <div className="cls-layout">
          <aside className="cls-side" aria-label="How far the class has got">
            <div className="ds-card cls-progress">
              <p className={`cls-progress-figure${list.counts.ready === 0 ? ' is-none' : ''}`}>
                <strong>{ready}%</strong>
                <span>ready to check in</span>
              </p>
              <p className="cls-progress-line">
                {left === 0 ? 'Everyone on the list is ready.' : `${list.counts.ready} of ${list.counts.total} students. ${left} still ${left === 1 ? 'has' : 'have'} a step to do.`}
              </p>
              <StageBar counts={list.counts} />
              {stages}
              {left > 0 ? (
                <Button variant="tinted" block onClick={() => setReminding(true)} icon={<Megaphone size={18} strokeWidth={2.1} aria-hidden="true" />}>
                  Remind the class
                </Button>
              ) : null}
            </div>
            <div className="cls-side-history">{history('side')}</div>
          </aside>

          <div className="cls-main">
            <div className="cls-tools">
              {list.entries.length >= SEARCH_FROM ? (
                <SearchField className="cls-find" value={query} onValueChange={setQuery} placeholder="Name, matric number or email" aria-label="Find a student" />
              ) : <span className="cls-find" aria-hidden="true" />}
              <Menu
                label="List actions"
                title={title}
                items={[
                  { label: 'Add students', icon: <UserPlus size={18} aria-hidden="true" />, onSelect: onAdd },
                  { label: 'Download list (.csv)', icon: <Download size={18} aria-hidden="true" />, onSelect: download },
                  list.history.length ? { label: 'Recent changes', icon: <History size={18} aria-hidden="true" />, onSelect: () => setHistoryOpen(true) } : null,
                ]}
              />
            </div>

            {shown.length === 0 ? (
              <p className="cls-quiet" role="status">
                {query.trim() ? `No student matches “${query.trim()}”${stage === 'all' ? '' : ` among ${STAGE[stage].label.toLowerCase()}`}.` : `No one is at ${STAGE[stage as Exclude<StageFilter, 'all'>].label.toLowerCase()}.`}
              </p>
            ) : (
              groups.map((group) => (
                <section key={group.key} className="ds-section" aria-labelledby={`cls-s-${group.key}`}>
                  <div className="ds-section-head">
                    <h2 className="ds-section-title" id={`cls-s-${group.key}`}>{group.title}</h2>
                    <span className="ds-section-aside">{group.entries.length === list.counts.total ? group.entries.length : `${group.entries.length} of ${bySet ? group.total : list.counts.total}`}</span>
                  </div>
                  <div className="cls-columns" aria-hidden="true">
                    <span>Name</span><span>Matric</span><span>LASU email</span><span>Account</span>
                  </div>
                  <ul className="ds-list cls-students">
                    {group.entries.map((entry) => (
                      <StudentRow key={entry.id} entry={entry} faceRequired={list.faceRequired} onOpen={() => setParam('student', entry.matricNumber)} />
                    ))}
                  </ul>
                </section>
              ))
            )}

            <div className="cls-main-history">{history('main')}</div>
          </div>
        </div>
      )}

      <StudentSheet
        entry={selected}
        list={list}
        now={now}
        onClose={() => setParam('student', null)}
        onChanged={onChanged}
      />
      <ReminderSheet open={reminding} onClose={() => setReminding(false)} list={list} />
      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Recent changes">
        <HistoryList events={list.history} now={now} />
      </Sheet>
    </div>
  );
}

function groupBySet(entries: readonly ClassListEntry[], bySet: boolean) {
  if (!bySet) return [{ key: 'all', title: 'Students', entries, total: entries.length }];
  const sets = new Map<number, ClassListEntry[]>();
  for (const entry of entries) sets.set(entry.entryYear, [...(sets.get(entry.entryYear) ?? []), entry]);
  return [...sets.entries()].sort((a, b) => b[0] - a[0]).map(([year, items]) => ({ key: String(year), title: academicSetLabel(year), entries: items, total: items.length }));
}

function StageButton({ label, count, pressed, tone, onPress }: Readonly<{ label: string; count: number; pressed: boolean; tone?: string; onPress: () => void }>) {
  return (
    <button className={`cls-stage${tone ? ` is-${tone}` : ''}`} type="button" aria-pressed={pressed} onClick={onPress}>
      <span className="cls-stage-dot" aria-hidden="true" />
      <span className="cls-stage-label">{label}</span>
      <span className="cls-stage-count">{count}</span>
    </button>
  );
}

function StudentRow({ entry, faceRequired, onOpen }: Readonly<{ entry: ClassListEntry; faceRequired: boolean; onOpen: () => void }>) {
  const stage = STAGE[entry.stage];
  const label = entry.stage === 'ready' && faceRequired ? 'Ready' : stage.label;
  return (
    <li>
      <button className="ds-row cls-row" type="button" onClick={onOpen}>
        <span className={`cls-avatar is-${stage.param}`} aria-hidden="true">{initials(entry)}</span>
        <span className="ds-row-body cls-row-body">
          <span className="ds-row-title cls-name">
            <span className="cls-name-text">{displayName(entry)}</span>
            {entry.isRep ? <span className="cls-tag">Class rep</span> : null}
          </span>
          <span className="ds-row-subtitle cls-narrow">
            <span className="ds-mono">{entry.matricNumber}</span>
            <span className={`cls-stage-text is-${stage.param}`}> · {label}</span>
          </span>
        </span>
        <span className="cls-col ds-mono">{entry.matricNumber}</span>
        <span className="cls-col cls-col-email">{entry.lasuEmail ?? <span className="cls-muted">Not on the list</span>}</span>
        <span className="cls-col cls-col-stage"><Badge tone={stage.tone === 'neutral' ? 'neutral' : stage.tone}>{label}</Badge></span>
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </li>
  );
}

function HistoryList({ events, now }: Readonly<{ events: ClassList['history']; now: number }>) {
  return (
    <ul className="ds-list cls-events">
      {events.map((event) => (
        <li key={event.id} className="ds-row cls-event">
          <span className="ds-row-body">
            <span className="cls-event-text">{event.summary}{event.matricNumber ? <span className="ds-mono cls-muted"> · {event.matricNumber}</span> : null}</span>
            <span className="ds-row-subtitle">{event.actorName ?? 'LASUATOS'} · {whenLabel(event.at, now)}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

/** A message for the class group chat, naming who still has a step to do. */
function ReminderSheet({ open, onClose, list }: Readonly<{ open: boolean; onClose: () => void; list: ClassList }>) {
  const feedback = useFeedback();
  const text = open && typeof window !== 'undefined' ? reminderText(list.entries, list.faceRequired, window.location.origin) : '';
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  function copy() {
    void navigator.clipboard?.writeText(text).then(
      () => { feedback.toast('Message copied. Paste it in the class group.'); onClose(); },
      () => feedback.toast('The message could not be copied. Select it and copy it instead.', 'error'),
    );
  }

  return (
    <Sheet open={open} onClose={onClose} title="Remind the class">
      <div className="cls-form">
        <p className="cls-form-note">For the class group chat. It names everyone who still has a step to do.</p>
        <label className="account-field">
          <span className="sr-only">The message</span>
          <textarea className="cls-textarea cls-message" value={text} readOnly rows={10} onFocus={(event) => event.currentTarget.select()} />
        </label>
        <p className="cls-note">Never post setup codes in a group. Give each one to the student yourself.</p>
        <div className="cls-actions">
          {canShare ? (
            <Button variant="gray" onClick={() => { void navigator.share({ text }).then(onClose, () => undefined); }}>Share…</Button>
          ) : null}
          <Button onClick={copy}>Copy message</Button>
        </div>
      </div>
    </Sheet>
  );
}
