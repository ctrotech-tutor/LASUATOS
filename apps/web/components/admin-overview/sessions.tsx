'use client';

import type { LectureSessionList, LectureSessionSummary } from '@lasuatos/contracts';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { Resource } from '../../lib/resource';
import { clockLabel, numberFormat, plural, whenLabel } from './format';

const LIVE_SHOWN = 3;
const RECENT_SHOWN = 5;

const takenBy = (session: LectureSessionSummary) => session.lecturerName || session.creatorName;
const isLive = (session: LectureSessionSummary) => session.status === 'open';

/** Sessions taking attendance right now, with their running count. Absent when none are open. */
export function LiveNow({ sessions, openNow }: Readonly<{ sessions: readonly LectureSessionSummary[]; openNow: number }>) {
  const live = sessions.filter(isLive);
  if (!live.length) return null;
  const shown = live.slice(0, LIVE_SHOWN);
  const more = Math.max(openNow, live.length) - shown.length;
  const checkedIn = live.reduce((sum, session) => sum + session.presentCount, 0);
  return (
    <section className="ds-section ov-live" aria-labelledby="ov-live-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="ov-live-title">
          <span className="ov-pulse" aria-hidden="true" />Live now
        </h2>
        {live.length > 1 ? <span className="ds-section-aside">{plural(checkedIn, 'check-in')}</span> : null}
      </div>
      <ul className="ds-list ov-sessions">
        {shown.map((session) => (
          <li key={session.id}>
            <Link className="ds-row ov-session" href={`/sessions/${session.id}`}>
              <span className="ov-code">{session.courseCode}</span>
              <span className="ds-row-body">
                <span className="ov-code-inline">{session.courseCode}</span>
                <span className="ds-row-title">{session.courseTitle}</span>
                <span className="ds-row-subtitle">{takenBy(session)} · since {clockLabel(session.startsAt)}</span>
              </span>
              <span className="ov-count is-live">
                <strong>{numberFormat.format(session.presentCount)}</strong>
                <small>in</small>
              </span>
              <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
            </Link>
          </li>
        ))}
        {more > 0 ? (
          <li>
            <Link className="ds-row ov-more" href="/sessions">
              <span className="ds-row-body"><span className="ds-row-title">{plural(more, 'more live session')}</span></span>
              <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
            </Link>
          </li>
        ) : null}
      </ul>
    </section>
  );
}

/** The latest finished sessions in the administrator's area. Hidden until there is one. */
export function RecentSessions({ resource, today }: Readonly<{ resource: Resource<LectureSessionList>; today: string }>) {
  const sessions = resource.data?.sessions.filter((session) => !isLive(session)).slice(0, RECENT_SHOWN);
  if (resource.data && !sessions?.length) return null;
  if (!resource.data && resource.error) return null;
  return (
    <section className="ds-section ov-recent" aria-labelledby="ov-recent-title">
      <div className="ds-section-head">
        <h2 className="ds-section-title" id="ov-recent-title">Recent sessions</h2>
        <Link className="ov-section-link" href="/sessions">See all</Link>
      </div>
      {sessions ? (
        <ul className="ds-list ov-sessions">
          {sessions.map((session) => (
            <li key={session.id}>
              <Link className="ds-row ov-session" href={`/sessions/${session.id}`}>
                <span className="ov-code">{session.courseCode}</span>
                <span className="ds-row-body">
                  <span className="ov-code-inline">{session.courseCode}</span>
                  <span className="ds-row-title">{session.courseTitle}</span>
                  <span className="ds-row-subtitle">{takenBy(session)} · {whenLabel(session.startsAt, today)}</span>
                </span>
                <span className="ov-count">
                  <strong>{numberFormat.format(session.presentCount)}</strong>
                  <small>present</small>
                </span>
                <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <RowBones rows={3} label="Loading recent sessions" />
      )}
    </section>
  );
}

export function RowBones({ rows, label }: Readonly<{ rows: number; label: string }>) {
  return (
    <ul className="ds-list ov-bones" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <li key={index}>
          <div className="ds-row">
            <span className="ds-skeleton ov-bone-tile" />
            <span className="ds-row-body">
              <span className="ds-skeleton" style={{ width: `${72 - index * 9}%` }} />
              <span className="ds-skeleton ov-bone-small" style={{ width: `${46 - index * 5}%` }} />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}
