'use client';

import type { LectureRegister } from '@lasuatos/contracts';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { formatClock, formatDay, formatShortDay } from '../../lib/lecture-api';
import { rateTone } from '../ds';

type Student = LectureRegister['students'][number];

/**
 * The register as a grid: one row per student, one column per class. The name stays on the
 * left and the totals on the right while the sessions scroll between them; a session's heading
 * opens it. It is also what prints.
 */
export function RegisterGrid({ register, rows, threshold, caption, onOpen }: Readonly<{
  register: LectureRegister;
  rows: readonly Student[];
  threshold: number;
  caption: string;
  onOpen: (student: Student) => void;
}>) {
  const wrap = useRef<HTMLDivElement>(null);
  const held = register.sessions.length;

  // Open on the latest sessions, as a paper register is read: from the last page.
  useEffect(() => {
    const element = wrap.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [register.generatedAt, register.term?.id]);

  // Shadows on the fixed columns only while sessions are hidden behind them.
  useEffect(() => {
    const element = wrap.current;
    if (!element) return;
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
    <div className="rg-grid-wrap" ref={wrap} role="region" aria-label={caption} tabIndex={0}>
      <table className="rg-grid">
        <caption className="rg-print-title">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="rg-c-sn">#</th>
            <th scope="col" className="rg-c-name">Student</th>
            {register.sessions.map((session, index) => (
              <th scope="col" key={session.id} className="rg-c-day">
                <Link
                  href={`/sessions/${session.id}`}
                  data-tip={`${formatDay(session.startsAt)}, ${formatClock(session.startsAt)} · ${session.takenBy} · ${session.presentCount} present`}
                  aria-label={`${formatShortDay(session.startsAt)} ${formatClock(session.startsAt)}: session ${index + 1}, ${session.presentCount} present`}
                >
                  <span>{formatShortDay(session.startsAt)}</span>{' '}
                  <small>{formatClock(session.startsAt)}</small>
                </Link>
              </th>
            ))}
            <th scope="col" className="rg-c-total">Attended</th>
            <th scope="col" className="rg-c-rate">%</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const tone = rateTone(row.rate, threshold);
            return (
              <tr key={row.matricNumber} className={`is-${tone}`}>
                <td className="rg-c-sn">{index + 1}</td>
                <th scope="row" className="rg-c-name">
                  <button type="button" onClick={() => onOpen(row)}>
                    <strong>{row.fullName}</strong>
                    <span className="ds-mono">{row.matricNumber}</span>
                  </button>
                </th>
                {row.present.map((present, position) => (
                  <td key={register.sessions[position]!.id} className="rg-c-mark">
                    <span className={present ? 'rg-mark is-present' : 'rg-mark'}>
                      <span className="sr-only">{present ? 'Present' : 'Absent'}</span>
                    </span>
                  </td>
                ))}
                <td className="rg-c-total">{row.attended}/{held}</td>
                <td className="rg-c-rate"><span className={`rg-rate is-${tone}`}>{Math.round(row.rate)}%</span></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
