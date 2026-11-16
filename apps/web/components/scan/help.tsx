'use client';

import type { LectureHelpRequestStatus, ResolvedLecture } from '@lasuatos/contracts';
import { Camera, Hand, RefreshCw, UserX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { failureText, loadLectureHelpStatus } from '../../lib/lecture-api';
import { Button } from '../ds';
import { PresentMark, StateView, Ticket } from './parts';

/** How often a waiting phone asks whether the request was decided. */
const POLL_MILLISECONDS = 4_000;

/**
 * Shown above the button once the face check has failed twice: the student can ask the person
 * taking attendance to add them by hand.
 */
export function HelpOffer({
  lecture,
  busy,
  onAsk,
}: Readonly<{ lecture: ResolvedLecture; busy: boolean; onAsk: () => void }>) {
  const taker = lecture.session.takenBy;
  return (
    <div className="sc-help-offer">
      <span className="sc-help-offer-icon" aria-hidden="true"><Hand size={20} /></span>
      <div className="sc-help-offer-body">
        <strong>Face check not working?</strong>
        <span>
          Try once more facing a window or a light, with the phone at eye level. Or ask {taker} to add you: they see your
          registered photo and confirm it is you in the room.
        </span>
        <Button variant="tinted" size="sm" onClick={onAsk} disabled={busy} busy={busy}>
          {busy ? 'Sending…' : `Ask ${taker.split(' ')[0]} to add me`}
        </Button>
      </div>
    </div>
  );
}

/**
 * After asking: the phone waits (checking every few seconds) and shows the decision as soon as
 * it is made.
 */
export function HelpWait({
  lecture,
  initial,
  now,
  onTryAgain,
}: Readonly<{ lecture: ResolvedLecture; initial: LectureHelpRequestStatus; now: number; onTryAgain: () => void }>) {
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
  const takerFirst = taker.split(' ')[0] ?? taker;
  const who = { fullName: status.fullName, matricNumber: status.matricNumber };

  if (status.status === 'added') {
    return (
      <StateView
        art={<PresentMark />}
        tone="success"
        title="You’re marked present"
        role="status"
        actions={<Button variant="gray" size="lg" block href="/account/security#face" icon={<Camera size={18} aria-hidden="true" />}>Take new face photos</Button>}
      >
        <Ticket session={lecture.session} now={now} who={who} titleAs="h2" stamp={{ at: status.decidedAt ?? status.createdAt, note: `Added by ${taker}` }} />
        <p className="sc-footnote">If the face check keeps failing, take new face photos in good light from your account.</p>
      </StateView>
    );
  }
  if (status.status === 'declined') {
    return (
      <StateView
        art={<UserX size={30} />}
        tone="danger"
        title={`${taker} didn’t add you`}
        role="alert"
        actions={<Button variant="filled" size="lg" block onClick={onTryAgain} icon={<RefreshCw size={18} aria-hidden="true" />}>Try the face check again</Button>}
      >
        <p className="sc-state-text">Speak to {takerFirst} before the class ends, or try the face check again.</p>
      </StateView>
    );
  }
  return (
    <StateView
      art={<span className="sc-pulse"><Hand size={28} /></span>}
      tone="tint"
      title={`Asked ${takerFirst} to add you`}
      role="status"
      actions={<Button variant="plain" onClick={onTryAgain}>Try the face check again instead</Button>}
    >
      <p className="sc-state-text">
        Your request is on {takerFirst}’s screen with your registered photo. Raise your hand or go to them so they can see it is you.
        This page updates by itself.
      </p>
      <Ticket session={lecture.session} now={now} who={who} titleAs="h2" />
      {problem ? <p className="sc-alert" role="alert">{problem}</p> : null}
    </StateView>
  );
}
