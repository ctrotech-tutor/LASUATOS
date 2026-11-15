'use client';

import { CalendarDays, CalendarPlus, ChevronRight } from 'lucide-react';
import { Button } from '../ds';
import { dateLabel, fraction, plural, relativeDays, type AcademicSession, type Today } from './format';

/**
 * The session as one bar: semesters as blocks along it, today as a marker. Positions are shares
 * of the session's length, so a long break shows as a long gap.
 */
export function Timeline({ session, now, compact = false }: Readonly<{ session: AcademicSession; now: number; compact?: boolean }>) {
  const inside = now >= Date.parse(session.startsAt) && now <= Date.parse(session.endsAt);
  const at = fraction(session.startsAt, session.endsAt, now);
  return (
    <div className={`str-timeline${compact ? ' is-compact' : ''}`}>
      <div className="str-track" aria-hidden="true">
        {session.semesters.map((semester) => {
          const left = fraction(session.startsAt, session.endsAt, Date.parse(semester.startsAt));
          const right = fraction(session.startsAt, session.endsAt, Date.parse(semester.endsAt));
          const done = now > Date.parse(semester.endsAt);
          const live = now >= Date.parse(semester.startsAt) && !done;
          return (
            <span
              key={semester.id}
              className={`str-seg${done ? ' is-done' : ''}${live ? ' is-live' : ''}`}
              style={{ left: `${left * 100}%`, width: `${Math.max(0.5, (right - left) * 100)}%` }}
            >
              {live ? <span className="str-seg-fill" style={{ width: `${fraction(semester.startsAt, semester.endsAt, now) * 100}%` }} /> : null}
            </span>
          );
        })}
        {inside ? <span className="str-now" style={{ left: `${at * 100}%` }} /> : null}
      </div>
      {!compact ? (
        <div className="str-scale" aria-hidden="true">
          {session.semesters.map((semester) => {
            const left = fraction(session.startsAt, session.endsAt, Date.parse(semester.startsAt));
            const right = fraction(session.startsAt, session.endsAt, Date.parse(semester.endsAt));
            return (
              <span key={semester.id} className="str-scale-label" style={{ left: `${left * 100}%`, width: `${(right - left) * 100}%` }}>
                {semester.name.replace(/\s+semester$/i, '')}
              </span>
            );
          })}
        </div>
      ) : null}
      <div className="str-ends">
        <span>{dateLabel(session.startsAt, now)}</span>
        <span>{dateLabel(session.endsAt, now)}</span>
      </div>
    </div>
  );
}

/** The figure and line under it for where today falls. */
function headline(today: Exclude<Today, { kind: 'none' }>, now: number): { readonly title: string; readonly line: string } {
  switch (today.kind) {
    case 'in_semester':
      return {
        title: `${today.semester.name}, week ${today.week}`,
        line: `${plural(today.weeks - today.week, 'week')} to go · ends ${dateLabel(today.semester.endsAt, now)}${today.daysLeft <= 14 ? `, ${relativeDays(today.daysLeft)}` : ''}`,
      };
    case 'between':
      return today.next
        ? { title: 'Between semesters', line: `${today.next.name} starts ${dateLabel(today.next.startsAt, now)}, ${relativeDays(today.startsIn ?? 0)}` }
        : { title: 'Semesters are over', line: `The session ends ${dateLabel(today.session.endsAt, now)}` };
    case 'not_started':
      return { title: 'Not started yet', line: `Starts ${dateLabel(today.session.startsAt, now)}, ${relativeDays(today.startsIn)}` };
    case 'ended':
      return { title: 'This session has ended', line: `Ended ${dateLabel(today.session.endsAt, now)}. Make the next session current.` };
  }
}

/** The page's top card: the current session, where today falls in it, and the way to it. */
export function TermCard({ today, now, canManage, onOpen, onStart, onSessions }: Readonly<{
  today: Today;
  now: number;
  canManage: boolean;
  onOpen: (session: AcademicSession) => void;
  onStart: () => void;
  onSessions: () => void;
}>) {
  if (today.kind === 'none') {
    return (
      <section className="str-term is-empty" aria-labelledby="str-term-title">
        <span className="str-term-icon" aria-hidden="true"><CalendarDays size={22} strokeWidth={2} /></span>
        <div className="str-term-text">
          <p className="str-term-kicker">Current session</p>
          <h2 className="str-term-title" id="str-term-title">None set</h2>
          <p className="str-term-line">Until one is made current, levels are worked out from today’s date.</p>
        </div>
        {canManage ? (
          <div className="str-term-actions">
            <Button onClick={onStart} icon={<CalendarPlus size={18} aria-hidden="true" />}>Start a session</Button>
            <Button variant="gray" onClick={onSessions}>All sessions</Button>
          </div>
        ) : null}
      </section>
    );
  }
  const { title, line } = headline(today, now);
  const ended = today.kind === 'ended';
  return (
    <section className={`str-term${ended ? ' is-warning' : ''}`} aria-labelledby="str-term-title">
      <h2 className="sr-only" id="str-term-title">Current session</h2>
      <button className="str-term-open" type="button" onClick={() => onOpen(today.session)}>
        <span className="str-term-head">
          <span className="str-term-text">
            <span className="str-term-kicker">Current session · {today.session.code}</span>
            <span className="str-term-title">{title}</span>
            <span className="str-term-line">{line}</span>
          </span>
          {today.kind === 'in_semester' ? (
            <span className="str-term-week" aria-hidden="true">
              <strong>{today.week}</strong>
              <span>of {today.weeks}</span>
            </span>
          ) : null}
          <ChevronRight className="str-term-chevron" size={20} strokeWidth={2.2} aria-hidden="true" />
        </span>
        <Timeline session={today.session} now={now} />
      </button>
    </section>
  );
}
