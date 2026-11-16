'use client';

import { useEffect, useRef } from 'react';
import { formatClock, formatDay } from '../../lib/lecture-api';
import { rateTone } from '../ds';
import { CELL, type Cell, type Report, type Student } from './model';

/** One mark: a dot, ring, square, cross or dash (see CELL). An absence in a live class is "not yet". */
export function Mark({ cell, live = false }: Readonly<{ cell: Cell; live?: boolean }>) {
  const meta = CELL[cell];
  const pending = live && cell === 'absent';
  return <span className={`rp-mark is-${meta.tone}${pending ? ' is-pending' : ''}`} aria-hidden="true" />;
}

export function markLabel(cell: Cell, live: boolean): string {
  return live && cell === 'absent' ? 'Not checked in yet' : CELL[cell].label;
}

/**
 * The report as a grid: one row per student, one column per class. Name on the left and the
 * totals on the right stay put while the classes scroll between them. A class heading opens
 * the class; a mark opens that student at that class, where it can be corrected.
 */
export function ReportGrid({ report, rows, threshold, caption, onStudent, onClass }: Readonly<{
  report: Report;
  rows: readonly Student[];
  threshold: number;
  caption: string;
  onStudent: (student: Student, classIndex?: number) => void;
  onClass: (classIndex: number) => void;
}>) {
  const wrap = useRef<HTMLDivElement>(null);
  const held = report.sessions.length;

  // Open on the latest classes, as a paper register is read: from the last page.
  useEffect(() => {
    const element = wrap.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [report.offering.id, held]);

  // Shadows on the fixed columns only while classes are hidden behind them.
  useEffect(() => {
    const element = wrap.current;
    if (!element) return undefined;
    const update = () => {
      element.toggleAttribute('data-left', element.scrollLeft > 1);
      element.toggleAttribute('data-right', element.scrollLeft + element.clientWidth < element.scrollWidth - 1);
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
    };
  }, [held]);

  return (
    <div className="rg-grid-wrap rp-grid-wrap" ref={wrap} role="region" aria-label={caption} tabIndex={0}>
      <table className="rg-grid rp-grid">
        <caption className="rg-print-title">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="rg-c-sn">#</th>
            <th scope="col" className="rg-c-name">Student</th>
            {report.sessions.map((session, index) => {
              const live = session.status === 'open';
              const [top, bottom] = live ? ['Live', formatClock(session.startsAt)] : [day(session.startsAt), month(session.startsAt)];
              return (
                <th scope="col" key={session.id} className={`rg-c-day${live ? ' is-live' : ''}`}>
                  <button
                    type="button"
                    onClick={() => onClass(index)}
                    data-tip={`${session.title} · ${formatDay(session.startsAt)}, ${formatClock(session.startsAt)} · ${session.presentCount} present${live ? ' · live' : ''}`}
                    aria-label={`${top} ${bottom}: ${session.title}, ${live ? 'taking attendance now' : formatClock(session.startsAt)}, ${session.presentCount} present`}
                  >
                    <span>{top}</span>{' '}
                    <small>{bottom}</small>
                  </button>
                </th>
              );
            })}
            <th scope="col" className="rg-c-total">Attended</th>
            <th scope="col" className="rg-c-rate">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const left = row.enrollmentStatus === 'withdrawn';
            const tone = left ? 'none' : rateTone(row.rate, threshold);
            return (
              <tr key={row.studentId} className={`is-${tone}${left ? ' is-left' : ''}`}>
                <td className="rg-c-sn">{index + 1}</td>
                <th scope="row" className="rg-c-name">
                  <button type="button" onClick={() => onStudent(row)}>
                    <strong>{row.displayName}</strong>
                    <span className="ds-mono">{row.studentNumber}{left ? <em> · left</em> : null}</span>
                  </button>
                </th>
                {row.cells.map((cell, position) => {
                  const session = report.sessions[position]!;
                  const live = session.status === 'open';
                  return (
                    <td key={session.id} className="rg-c-mark rp-c-mark">
                      <button
                        type="button"
                        tabIndex={-1}
                        onClick={() => onStudent(row, position)}
                        aria-label={`${row.displayName}, ${session.title}: ${markLabel(cell, live)}`}
                      >
                        <Mark cell={cell} live={live} />
                        <span className="rp-print-mark" aria-hidden="true">{printMark(cell)}</span>
                      </button>
                    </td>
                  );
                })}
                <td className="rg-c-total">{row.attendedSessions}/{row.eligibleSessions}</td>
                <td className="rg-c-rate"><span className={`rg-rate is-${tone}`}>{row.rate === null ? '–' : `${Math.round(row.rate)}%`}</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const dayNumber = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', day: 'numeric' });
const monthName = new Intl.DateTimeFormat('en-NG', { timeZone: 'Africa/Lagos', month: 'short' });
const day = (iso: string) => dayNumber.format(new Date(iso));
const month = (iso: string) => monthName.format(new Date(iso));

/** On paper: P for present (with a note mark for corrected or unsure), A for absent. */
function printMark(cell: Cell): string {
  switch (CELL[cell].tone) {
    case 'present': return 'P';
    case 'unsure': return 'P?';
    case 'marked': return 'P*';
    case 'removed': return 'A*';
    case 'absent': return 'A';
    default: return '·';
  }
}
