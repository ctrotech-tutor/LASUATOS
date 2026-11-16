'use client';

import { Ban, Check, Minus, X } from 'lucide-react';
import { useState, type CSSProperties, type ReactNode } from 'react';
import { clock, dayLabel, formatRate, lectureLine, plural, standing, STATUS_LABEL, type Course, type Lecture, type LectureStatus, type Tone } from './model';

/**
 * A rate as a ring: the arc fills to the rate in the tone's colour, and a short gold tick marks
 * the exam line, so "above or below" reads at a glance. The centre holds whatever is passed in.
 */
export function Ring({ rate, threshold, tone, size, stroke, className = '', children }: Readonly<{
  rate: number | null;
  threshold: number;
  tone: Tone;
  size: number;
  stroke: number;
  className?: string;
  children?: ReactNode;
}>) {
  const radius = (size - stroke) / 2;
  const centre = size / 2;
  const circumference = 2 * Math.PI * radius;
  const filled = rate === null ? 0 : Math.min(100, Math.max(0, rate)) / 100;
  // The tick crosses the ring at the line, measured clockwise from the top.
  const angle = (threshold / 100) * 2 * Math.PI - Math.PI / 2;
  // Just outside the ring, like a mark on a dial: never near the number in the centre.
  const inner = radius + stroke / 2 + 1.5;
  const outer = inner + Math.max(4, stroke * 0.55);
  return (
    <span className={`ma-ring is-${tone} ${className}`} style={{ '--ring': `${size}px` } as CSSProperties}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle className="ma-ring-track" cx={centre} cy={centre} r={radius} strokeWidth={stroke} fill="none" />
        {filled > 0 ? (
          <circle
            className="ma-ring-value"
            cx={centre}
            cy={centre}
            r={radius}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${circumference * filled} ${circumference}`}
            transform={`rotate(-90 ${centre} ${centre})`}
          />
        ) : null}
        <line
          className="ma-ring-line"
          x1={centre + inner * Math.cos(angle)}
          y1={centre + inner * Math.sin(angle)}
          x2={centre + outer * Math.cos(angle)}
          y2={centre + outer * Math.sin(angle)}
          strokeLinecap="round"
        />
      </svg>
      {children ? <span className="ma-ring-centre">{children}</span> : null}
    </span>
  );
}

export function StatusGlyph({ status, size = 16 }: Readonly<{ status: LectureStatus; size?: number }>) {
  const icon = status === 'present' ? <Check size={size} strokeWidth={3} /> : status === 'missed' ? <Minus size={size} strokeWidth={3} /> : <Ban size={size} strokeWidth={2.6} />;
  return <span className={`ma-glyph is-${status}`} aria-hidden="true">{icon}</span>;
}

/** One lecture: in the timeline it leads with the course; inside a course, with the day. */
export function LectureRow({ lecture, now, inCourse = false }: Readonly<{ lecture: Lecture; now: number; inCourse?: boolean }>) {
  return (
    <li className={`ma-lecture is-${lecture.status}`}>
      <StatusGlyph status={lecture.status} />
      <span className="ma-lecture-text">
        <span className="ma-lecture-title">
          {inCourse ? dayLabel(lecture.at, now) : <><strong>{lecture.courseCode}</strong> {lecture.courseTitle}</>}
        </span>
        <span className="ma-lecture-line">{lectureLine(lecture)}</span>
        {lecture.status === 'removed' ? (
          <span className="ma-lecture-note">
            {lecture.reason ? `Removed: ${lecture.reason}` : 'Removed by the lecturer or class rep'}
            {lecture.disputable ? <> · <a href="#attendance-disputes">Raise a concern</a></> : null}
          </span>
        ) : lecture.imprecise ? <span className="ma-lecture-note is-quiet">Location was imprecise; still counts</span> : null}
      </span>
      {lecture.status !== 'present' ? <span className={`ma-lecture-badge is-${lecture.status}`}>{STATUS_LABEL[lecture.status]}</span> : <span className="sr-only">, present</span>}
    </li>
  );
}

const TILES = ['present', 'missed', 'removed'] as const;
const TILE_LABEL: Record<LectureStatus, string> = { present: 'Attended', missed: 'Missed', removed: 'Removed' };

/** A course on its own: the rate against the line, what it takes to stay above it, and each lecture. */
export function CourseDetail({ course, threshold, now, onClose, inSheet = false }: Readonly<{
  course: Course;
  threshold: number;
  now: number;
  onClose?: () => void;
  inSheet?: boolean;
}>) {
  const state = standing(course, threshold);
  const ordered = [...course.lectures].reverse();
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const tally = { present: 0, missed: 0, removed: 0 };
  for (const lecture of ordered) tally[lecture.status] += 1;
  const [only, setOnly] = useState<LectureStatus | null>(null);
  const listed = only ? course.lectures.filter((lecture) => lecture.status === only) : course.lectures;
  return (
    <div className="ma-detail">
      {inSheet ? <p className="ma-detail-sub">{course.title}</p> : (
        <div className="ma-detail-head">
          <div className="ma-detail-name">
            <p className="ma-detail-code">{course.code}</p>
            <h2 className="ma-detail-title">{course.title}</h2>
          </div>
          {onClose ? (
            <button className="ds-icon-btn" type="button" onClick={onClose} aria-label="Close" data-tip="Close (Esc)">
              <X size={18} strokeWidth={2.3} aria-hidden="true" />
            </button>
          ) : null}
        </div>
      )}

      <div className={`ma-detail-rate is-${state.tone}`}>
        <Ring rate={course.rate} threshold={threshold} tone={state.tone} size={92} stroke={9}>
          <span className="ma-detail-pct">{formatRate(course.rate)}</span>
        </Ring>
        <div className="ma-detail-rate-text">
          <p className="ma-detail-big">{course.attended} of {plural(course.held, 'lecture')}</p>
          <p className={`ma-detail-state is-${state.tone}`}>{state.line}</p>
        </div>
      </div>

      <div className="ma-detail-stats" role="group" aria-label="Show only">
        {TILES.map((tile) => {
          const count = tile === 'present' ? course.attended : course[tile];
          return (
            <button
              key={tile}
              type="button"
              className={`ma-tile is-${tile}`}
              aria-pressed={only === tile}
              disabled={count === 0 && only !== tile}
              onClick={() => setOnly((value) => (value === tile ? null : tile))}
            >
              <span className="ma-tile-label">{TILE_LABEL[tile]}</span>
              <span className="ma-tile-count">{count}</span>
            </button>
          );
        })}
      </div>

      {ordered.length > 1 && first && last ? (
        <section className="ma-strip" aria-labelledby={`ma-strip-${course.slug}`}>
          <h3 className="ma-detail-h" id={`ma-strip-${course.slug}`}>Every lecture</h3>
          <ol className="ma-strip-cells" aria-label={`${plural(ordered.length, 'lecture')}, oldest first: ${tally.present} attended, ${tally.missed} missed, ${tally.removed} removed`}>
            {ordered.map((lecture) => (
              <li key={`${lecture.status}-${lecture.id}`} className={`is-${lecture.status}`} title={`${dayLabel(lecture.at, now)} · ${clock(lecture.at)} · ${STATUS_LABEL[lecture.status]}`} aria-hidden="true" />
            ))}
          </ol>
          <p className="ma-strip-ends" aria-hidden="true"><span>{dayLabel(first.at, now)}</span><span>{dayLabel(last.at, now)}</span></p>
        </section>
      ) : null}

      <section aria-labelledby={`ma-list-${course.slug}`}>
        <div className="ma-detail-list-head">
          <h3 className="ma-detail-h" id={`ma-list-${course.slug}`}>{only ? `${TILE_LABEL[only]} lectures` : 'Lectures'}</h3>
          {only ? <button className="ma-link" type="button" onClick={() => setOnly(null)}>Show all</button> : null}
        </div>
        <ul className="ma-lectures is-course">
          {listed.map((lecture) => <LectureRow key={`${lecture.status}-${lecture.id}`} lecture={lecture} now={now} inCourse />)}
        </ul>
      </section>
      {course.removed ? <p className="ma-detail-note">Think a removal is wrong? Speak to the lecturer or class rep who took attendance that day.</p> : null}
    </div>
  );
}
