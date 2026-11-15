'use client';

import type { ClassList } from '@lasuatos/contracts';
import { ChevronRight, ListChecks, Plus } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState, type ReactNode } from 'react';
import { shortDepartmentName } from '../../lib/department-options';
import { Button, EmptyState, Stat, Stats } from '../ds';
import { useClock } from '../take-attendance/hooks';
import { SearchField } from '../ui/search-field';
import { overviewGroups, overviewTotals, percent, placeHref, SEARCH_FROM, updatedLabel, type OverviewRow, type Place } from './format';
import { StageBar } from './stage-bar';

type Header = (title: string, extra?: { subtitle?: string; back?: { href: string; label: string } }) => ReactNode;

/** Every list in the viewer's area, with how far each one has got. */
export function Overview({ list, place, pathname, header, onAdd }: Readonly<{
  list: ClassList;
  place: Place;
  pathname: string;
  header: Header;
  onAdd: (departmentId?: string | null) => void;
}>) {
  const now = useClock('fifteen');
  const [query, setQuery] = useState('');
  const groups = useMemo(() => overviewGroups(list), [list]);
  const totals = useMemo(() => overviewTotals(list.lists), [list.lists]);
  const rowCount = groups.reduce((sum, group) => sum + group.rows.length, 0);
  const missing = list.departments.filter((department) => !list.lists.some((item) => item.departmentId === department.id)).length;
  const needle = query.trim().toLowerCase();
  const shown = needle
    ? groups.map((group) => ({ ...group, rows: group.rows.filter((row) => `${row.title} ${row.code} ${row.subtitle} ${group.title}`.toLowerCase().includes(needle)) })).filter((group) => group.rows.length)
    : groups;

  // Inside one department (asked for, or the only one they have) the title is the department.
  const department = list.departments.find((item) => item.id === list.departmentId) ?? null;
  const faculties = [...new Set(list.departments.map((item) => item.facultyName))];
  const scoped = department && (list.fixedDepartmentId !== null || place.department !== null || list.departments.length === 1);
  const title = scoped ? shortDepartmentName(department.name) : 'Class lists';
  const subtitleParts = [
    list.fixedEntryYear !== null && list.setLabel ? list.setLabel : null,
    !scoped && faculties.length === 1 ? faculties[0]! : null,
  ].filter(Boolean);
  const back = scoped && list.fixedDepartmentId === null && list.departments.length > 1 ? { href: pathname, label: 'Class lists' } : undefined;

  return (
    <div className="cls">
      {header(title, { ...(subtitleParts.length ? { subtitle: subtitleParts.join(' · ') } : {}), ...(back ? { back } : {}) })}

      {list.departments.length === 0 ? (
        <div className="ds-card">
          <EmptyState icon={<ListChecks size={26} strokeWidth={1.9} />} title="No departments yet" message="Departments are added in Academic structure. Their class lists then appear here." action={<Button href="/admin/structure" variant="tinted">Open Academic structure</Button>} />
        </div>
      ) : (
        <>
          {totals.lists > 0 ? (
            <Stats label="Across these lists">
              <Stat label="Students" value={totals.students.toLocaleString('en-NG')} hint={`on ${totals.lists} ${totals.lists === 1 ? 'list' : 'lists'}`} />
              <Stat label="Ready to check in" value={`${percent(totals.ready, totals.students)}%`} hint={`${totals.ready.toLocaleString('en-NG')} students`} tone={totals.ready > 0 ? 'success' : undefined} />
              <Stat label="Not opened" value={totals.notOpened.toLocaleString('en-NG')} hint="accounts still to open" tone={totals.notOpened > 0 ? 'warning' : undefined} />
              {list.departments.length > 1 ? <Stat label="No list yet" value={missing} hint={missing === 1 ? 'department' : 'departments'} tone={missing > 0 ? 'warning' : undefined} /> : null}
            </Stats>
          ) : null}

          {rowCount >= SEARCH_FROM ? (
            <div className="cls-tools">
              <SearchField className="cls-find" value={query} onValueChange={setQuery} placeholder="Department, code or set" aria-label="Find a class list" />
            </div>
          ) : null}

          {shown.length === 0 ? <p className="cls-quiet" role="status">No list matches “{query.trim()}”.</p> : null}

          {shown.map((group) => (
            <section key={group.key} className="ds-section" aria-labelledby={`cls-g-${group.key}`}>
              <div className="ds-section-head">
                <h2 className="ds-section-title" id={`cls-g-${group.key}`}>{group.title}</h2>
                <span className="ds-section-aside">{group.rows.filter((row) => row.summary).length || 'No'} {group.rows.filter((row) => row.summary).length === 1 ? 'list' : 'lists'}</span>
              </div>
              <ul className="ds-list cls-lists">
                {group.rows.map((row) => <OverviewItem key={row.key} row={row} now={now} pathname={pathname} onAdd={() => onAdd(row.departmentId)} />)}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  );
}

function OverviewItem({ row, now, pathname, onAdd }: Readonly<{ row: OverviewRow; now: number; pathname: string; onAdd: () => void }>) {
  const summary = row.summary;
  if (!summary) {
    return (
      <li>
        <button className="ds-row cls-list-row is-empty" type="button" onClick={onAdd}>
          <span className="cls-list-icon" aria-hidden="true"><Plus size={18} strokeWidth={2.2} /></span>
          <span className="ds-row-body">
            <span className="ds-row-title">{row.title}</span>
            <span className="ds-row-subtitle">No list yet. Add one</span>
          </span>
          <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
        </button>
      </li>
    );
  }
  const ready = percent(summary.ready, summary.total);
  const href = placeHref(pathname, { department: row.code.toLowerCase(), set: summary.entryYear });
  return (
    <li>
      <Link className="ds-row cls-list-row" href={href}>
        <span className="ds-row-body">
          <span className="ds-row-title">{row.title}</span>
          <span className="ds-row-subtitle">{row.subtitle}<span className="cls-list-updated"> · changed {updatedLabel(summary.updatedAt, now)}</span></span>
        </span>
        <span className="cls-list-progress">
          <StageBar counts={summary} compact />
          <span className={`cls-list-figure${ready >= 80 ? ' is-good' : ''}`}><strong>{ready}%</strong> ready</span>
        </span>
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </Link>
    </li>
  );
}
