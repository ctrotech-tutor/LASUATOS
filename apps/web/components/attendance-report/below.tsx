'use client';

import type { LectureReport } from '@lasuatos/contracts';
import { CircleCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { List, ListRow, rateTone, Section, Sheet } from '../ds';
import { SearchField } from '../ui/search-field';
import { numberFormat, percent } from './format';
import { registerHref } from '../registers/href';

const PREVIEW = 5;
/** The server sends at most this many rows (the contract's limit). */
const ROW_CAP = 300;
type Row = LectureReport['below']['rows'][number];

/**
 * Students under the threshold in a course this semester, worst first: the list an
 * administrator acts on before exams. Each row opens the course register at that student.
 */
export function BelowSection({ report }: Readonly<{ report: LectureReport }>) {
  const [open, setOpen] = useState(false);
  const { below } = report;
  const title = (
    <>Below {below.threshold}%{below.students ? <span className="ar-pill is-warning">{numberFormat.format(below.students)}</span> : null}</>
  );
  return (
    <Section
      id="ar-below"
      title={title}
      aside={below.rows.length > PREVIEW ? <button className="ar-link" type="button" onClick={() => setOpen(true)}>See all</button> : null}
    >
      <List leading={below.rows.length === 0}>
        {below.rows.length === 0 ? (
          <ListRow
            leading={<CircleCheck size={20} strokeWidth={2.2} />}
            title={`No one below ${below.threshold}%`}
            subtitle={report.term?.label ?? 'Last 90 days'}
          />
        ) : below.rows.slice(0, PREVIEW).map((row) => <BelowRow key={`${row.matricNumber}|${row.courseCode}`} row={row} threshold={below.threshold} />)}
      </List>
      <Sheet open={open} onClose={() => setOpen(false)} title={`Below ${below.threshold}%`}>
        {open ? <BelowList report={report} /> : null}
      </Sheet>
    </Section>
  );
}

function BelowRow({ row, threshold }: Readonly<{ row: Row; threshold: number }>) {
  return (
    <ListRow
      href={registerHref(row.courseCode, row.matricNumber)}
      title={row.fullName}
      subtitle={<><span className="ds-mono">{row.matricNumber}</span> · {row.courseCode}</>}
      trailing={(
        <span className="ar-stack">
          <strong className={`is-${rateTone(row.rate, threshold)}`}>{percent(row.rate)}</strong>
          <small>{row.attended} of {row.held}</small>
        </span>
      )}
    />
  );
}

function BelowList({ report }: Readonly<{ report: LectureReport }>) {
  const [query, setQuery] = useState('');
  const { below } = report;
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase().replace(/\s+/g, '');
    if (!needle) return below.rows;
    return below.rows.filter((row) => `${row.fullName}${row.matricNumber}${row.courseCode}`.toLowerCase().replace(/\s+/g, '').includes(needle));
  }, [below.rows, query]);
  return (
    <div className="ar-sheet">
      <SearchField value={query} onValueChange={setQuery} placeholder="Name, matric or course" aria-label="Filter students below the threshold" />
      {rows.length ? (
        <List label={`Students below ${below.threshold}%`}>
          {rows.map((row) => <BelowRow key={`${row.matricNumber}|${row.courseCode}`} row={row} threshold={below.threshold} />)}
        </List>
      ) : <p className="ar-quiet" role="status">No match for “{query.trim()}”.</p>}
      {below.rows.length >= ROW_CAP ? <p className="ar-quiet">The {numberFormat.format(ROW_CAP)} lowest of {numberFormat.format(below.students)} students.</p> : null}
    </div>
  );
}
