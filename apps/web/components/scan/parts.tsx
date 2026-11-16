'use client';

import type { ResolvedLecture } from '@lasuatos/contracts';
import { BadgeCheck, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { formatClock } from '../../lib/lecture-api';
import { Bone, SkeletonRegion } from '../ui/skeleton';
import { closingLabel, courseLine, ticketInitials } from './model';

type Session = ResolvedLecture['session'];

/** What a ticket needs: a lecture (the Scan screen) or a course session (/check-in). */
export type TicketClass = Pick<Session, 'courseCode' | 'courseTitle' | 'endsAt'> & Partial<Pick<Session, 'lecturerName' | 'venueName'>>;

/**
 * The class as a ticket: the course on navy paper, a tear line, then who is being marked. The
 * same ticket is stamped on the done screen, so the student sees the thing they confirmed become
 * the receipt.
 */
export function Ticket({
  session,
  now,
  who,
  stamp,
  titleAs = 'h1',
  line: lineOverride,
}: Readonly<{
  session: TicketClass;
  now: number;
  /** The person being marked; null while somebody still has to sign in. */
  who: { readonly fullName: string; readonly matricNumber: string } | null;
  /** Shown once marked: the time, and who added them when it was by hand. */
  stamp?: { readonly at: string; readonly note?: string | undefined } | undefined;
  titleAs?: 'h1' | 'h2';
  /** The line under the title, when not the lecturer and venue. */
  line?: string;
}>) {
  const Title = titleAs;
  const line = lineOverride ?? courseLine({ lecturerName: session.lecturerName ?? null, venueName: session.venueName ?? null });
  return (
    <article className={`sc-ticket${stamp ? ' is-stamped' : ''}`} aria-label={`${session.courseCode} ${session.courseTitle}`}>
      <div className="sc-ticket-top">
        <div className="sc-ticket-row">
          <span className="sc-ticket-code">{session.courseCode}</span>
          {stamp ? null : (
            <span className="sc-ticket-open">
              <span className="sc-ticket-dot" aria-hidden="true" />
              {closingLabel(session.endsAt, now, formatClock)}
            </span>
          )}
        </div>
        <Title className="sc-ticket-title">{session.courseTitle}</Title>
        {line ? <p className="sc-ticket-line">{line}</p> : null}
      </div>
      <div className="sc-ticket-tear" aria-hidden="true" />
      <div className="sc-ticket-who">
        {who ? (
          <span className="sc-ticket-avatar" aria-hidden="true">{ticketInitials(who.fullName)}</span>
        ) : (
          <span className="sc-ticket-avatar is-empty" aria-hidden="true"><UserRound size={20} /></span>
        )}
        <span className="sc-ticket-person">
          <span className="sc-ticket-label">{stamp ? 'Present' : 'Marking'}</span>
          {who ? (
            <>
              <strong>{who.fullName}</strong>
              <span className="ds-num">{who.matricNumber}</span>
            </>
          ) : (
            <strong>Whoever signs in below</strong>
          )}
        </span>
        {stamp ? (
          <span className="sc-ticket-stamp">
            <BadgeCheck size={16} aria-hidden="true" />
            <span className="ds-num">{formatClock(stamp.at)}</span>
          </span>
        ) : null}
      </div>
      {stamp?.note ? <p className="sc-ticket-note">{stamp.note}</p> : null}
    </article>
  );
}

export function TicketSkeleton() {
  return (
    <SkeletonRegion label="Opening the class…" className="sc-confirm">
      <div className="sc-ticket is-skeleton">
        <div className="sc-ticket-top">
          <Bone width={78} height={24} style={{ borderRadius: 999 }} />
          <Bone width="78%" height={26} />
          <Bone width="52%" height={14} />
        </div>
        <div className="sc-ticket-tear" />
        <div className="sc-ticket-who">
          <Bone width={44} height={44} style={{ borderRadius: 999 }} />
          <span className="sc-ticket-person">
            <Bone width={140} height={14} />
            <Bone width={96} height={12} />
          </span>
        </div>
      </div>
      <Bone height={52} style={{ borderRadius: 14 }} />
    </SkeletonRegion>
  );
}

export type CheckTone = 'ok' | 'wait' | 'warn' | 'bad' | 'info';

/** One thing that happens before the student is marked (the face check, the venue). */
export function CheckRow({
  icon,
  tone,
  title,
  detail,
  action,
  live = false,
}: Readonly<{
  icon: ReactNode;
  tone: CheckTone;
  title: ReactNode;
  detail?: ReactNode;
  action?: ReactNode;
  /** Read out as it changes (the live location). */
  live?: boolean;
}>) {
  return (
    <li className={`sc-check is-${tone}`}>
      <span className="sc-check-icon" aria-hidden="true">{icon}</span>
      <span className="sc-check-body" role={live ? 'status' : undefined} aria-live={live ? 'polite' : undefined}>
        <span className="sc-check-title">{title}</span>
        {detail ? <span className="sc-check-detail">{detail}</span> : null}
      </span>
      {action ? <span className="sc-check-action">{action}</span> : null}
    </li>
  );
}

/** A whole-screen outcome: the mark or icon, a title, the words, then actions. */
export function StateView({
  art,
  tone,
  title,
  children,
  actions,
  role,
}: Readonly<{
  art: ReactNode;
  tone: 'success' | 'warning' | 'danger' | 'tint';
  title: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
  role?: 'status' | 'alert';
}>) {
  return (
    <div className={`sc-state is-${tone}`} role={role}>
      <span className="sc-state-art" aria-hidden="true">{art}</span>
      <h1 className="sc-state-title">{title}</h1>
      {children}
      {actions ? <div className="sc-actions">{actions}</div> : null}
    </div>
  );
}

/** The green tick that draws itself when someone is marked present. */
export function PresentMark() {
  return (
    <span className="sx-result-mark sc-present-mark">
      <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="M15 27 l7 7 l15 -16" /></svg>
    </span>
  );
}
