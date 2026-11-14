'use client';

import type { LectureHelpRequestStatus, ResolvedLecture } from '@lasuatos/contracts';
import { BadgeCheck, Hand, RefreshCw, UserX } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { failureText, formatClock, loadLectureHelpStatus } from '../lib/lecture-api';

/** How often a waiting phone asks whether the request was decided. */
const POLL_MILLISECONDS = 4_000;

/**
 * Shown under the check-in button once the face check has failed twice: the
 * student can ask the person taking attendance to add them by hand.
 */
export function CheckInHelpOffer({
  lecture,
  busy,
  onAsk,
}: Readonly<{ lecture: ResolvedLecture; busy: boolean; onAsk: () => void }>) {
  return (
    <div className="lx-help-offer">
      <Hand size={20} aria-hidden="true" />
      <div>
        <strong>Face check not working?</strong>
        <span>
          Try once more facing a window or a light, with the phone at eye level. If it still fails, ask {lecture.session.takenBy} to add you:
          they see your registered photo and confirm it is you in the room.
        </span>
        <button className="button button-secondary" type="button" onClick={onAsk} disabled={busy}>
          {busy ? 'Sending…' : `Ask ${lecture.session.takenBy.split(' ')[0]} to add me`}
        </button>
      </div>
    </div>
  );
}

/**
 * After asking: the phone waits (checking every few seconds) and shows the
 * decision as soon as it is made.
 */
export function CheckInHelpWait({
  lecture,
  initial,
  onTryAgain,
}: Readonly<{ lecture: ResolvedLecture; initial: LectureHelpRequestStatus; onTryAgain: () => void }>) {
  const [status, setStatus] = useState(initial);
  const [problem, setProblem] = useState('');

  useEffect(() => {
    if (status.status !== 'pending') return undefined;
    const controller = new AbortController();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'hidden') return;
      loadLectureHelpStatus(lecture.session.id, controller.signal)
        .then((next) => {
          setStatus(next);
          setProblem('');
        })
        .catch((caught: unknown) => {
          if (caught instanceof DOMException && caught.name === 'AbortError') return;
          setProblem(failureText(caught, 'Could not check for an answer. It will try again.'));
        });
    }, POLL_MILLISECONDS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [lecture.session.id, status.status]);

  const taker = status.takerName || lecture.session.takenBy;
  if (status.status === 'added') {
    return (
      <div className="lx-card lx-center lx-done" role="status">
        <span className="sx-result-mark lx-mark" aria-hidden="true">
          <svg viewBox="0 0 52 52"><circle cx="26" cy="26" r="24" /><path d="M15 27 l7 7 l15 -16" /></svg>
        </span>
        <h1>You’re marked present</h1>
        <p className="lx-done-course"><strong>{status.courseCode}</strong> · {lecture.session.courseTitle}</p>
        <dl className="lx-receipt">
          <div><dt>Name</dt><dd>{status.fullName}</dd></div>
          <div><dt>Matric</dt><dd>{status.matricNumber}</dd></div>
          {status.decidedAt ? <div><dt>Time</dt><dd>{formatClock(status.decidedAt)}</dd></div> : null}
        </dl>
        <p className="lx-confirmed"><BadgeCheck size={16} aria-hidden="true" /> Added by {taker}</p>
        <p className="lx-fine">If the face check keeps failing, take new face photos from your account page in good light.</p>
        <Link className="button button-secondary" href="/account/security">Take new face photos</Link>
      </div>
    );
  }
  if (status.status === 'declined') {
    return (
      <div className="lx-card lx-center lx-failed" role="alert">
        <UserX size={34} aria-hidden="true" />
        <h2>{taker} did not add you</h2>
        <p>Speak to {taker.split(' ')[0]} before the class ends, or try the face check again.</p>
        <button className="button button-primary lx-big-button" type="button" onClick={onTryAgain}>
          <RefreshCw size={18} aria-hidden="true" /> Try the face check again
        </button>
      </div>
    );
  }
  return (
    <div className="lx-card lx-center lx-help-wait" role="status">
      <span className="lx-help-pulse" aria-hidden="true"><Hand size={28} /></span>
      <h1>Asked {taker} to add you</h1>
      <p className="lx-done-course"><strong>{status.courseCode}</strong> · {lecture.session.courseTitle}</p>
      <p>
        Your request is on {taker.split(' ').at(0)}’s screen with your registered photo. Raise your hand or go to them so they can see it is you.
        This page updates by itself.
      </p>
      <dl className="lx-receipt">
        <div><dt>Name</dt><dd>{status.fullName}</dd></div>
        <div><dt>Matric</dt><dd>{status.matricNumber}</dd></div>
        <div><dt>Asked at</dt><dd>{formatClock(status.createdAt)}</dd></div>
      </dl>
      {problem ? <p className="lx-error" role="alert">{problem}</p> : null}
      <button className="lx-link-button" type="button" onClick={onTryAgain}>Try the face check again instead</button>
    </div>
  );
}
