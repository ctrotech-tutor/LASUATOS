'use client';

import { FACE_MATCH, type FaceReviewItem } from '@lasuatos/contracts';
import { Check, ChevronDown, ChevronUp, UserRound, X } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { faceReviewPhotoUrl, formatClock, formatShortDay } from '../../lib/lecture-api';
import { Badge, Button } from '../ds';
import { buttonClassName } from '../ds/button';
import { closeness, isWeak, REJECT_REASONS, sessionLine } from './format';

export type Decide = (item: FaceReviewItem, decision: 'approve' | 'reject', note?: string) => void;

/**
 * One check, compared: the photo taken at check-in beside the registered one, where the score
 * sits between the pass line and a clear match, and the decision. Used as the right-hand pane
 * on wide screens and inside a sheet on phones.
 *
 * Keys (when `keys` is on and no other dialog is in front): ↑/↓ or K/J move, A is the same
 * person, X starts a rejection; then 1–3 pick a reason, Enter removes, Escape goes back.
 */
export function Compare({ item, now, position, onMove, onDecide, keys, variant }: Readonly<{
  item: FaceReviewItem;
  now: number;
  position: { readonly index: number; readonly total: number } | null;
  onMove: (step: 1 | -1) => void;
  onDecide: Decide;
  keys: boolean;
  variant: 'pane' | 'sheet';
}>) {
  const root = useRef<HTMLElement>(null);
  const titleId = useId();
  return (
    <article ref={root} className={`fc-compare is-${variant}`} aria-labelledby={variant === 'pane' ? titleId : undefined}>
      <header className="fc-compare-head">
        <div className="fc-compare-who">
          {variant === 'pane' ? <h2 className="fc-compare-name" id={titleId}>{item.studentName}</h2> : null}
          <p className="fc-compare-meta">
            <span className="ds-mono">{item.matricNumber}</span>
            <span aria-hidden="true"> · </span>
            Checked in {formatClock(item.checkedInAt)}
          </p>
          <p className="fc-compare-meta">
            <Link href={`/sessions/${item.sessionId}`}>{sessionLine(item, now)}</Link>
            <span className="fc-compare-sep" aria-hidden="true"> · </span>
            <span className="fc-compare-by"> Taken by {item.takenBy}</span>
          </p>
        </div>
        {position && position.total > 1 ? (
          <div className="fc-stepper" role="group" aria-label="Move between checks">
            <span className="fc-stepper-count" aria-live="polite">{position.index + 1} of {position.total}</span>
            <button className="ds-icon-btn" type="button" aria-label="Previous check" data-tip="Previous · K" disabled={position.index === 0} onClick={() => onMove(-1)}>
              <ChevronUp size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
            <button className="ds-icon-btn" type="button" aria-label="Next check" data-tip="Next · J" disabled={position.index >= position.total - 1} onClick={() => onMove(1)}>
              <ChevronDown size={18} strokeWidth={2.2} aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </header>

      <div className="fc-pair">
        <Photo key={`check-${item.id}`} src={item.hasCheckPhoto ? faceReviewPhotoUrl(item.id, 'check') : null} label="At check-in" missing="No longer kept" alt={`${item.studentName} at check-in`} />
        <Photo key={`registered-${item.id}`} src={item.hasRegisteredPhoto ? faceReviewPhotoUrl(item.id, 'registered') : null} label="Registered" missing="No registered face" alt={`${item.studentName}, registered face`} />
      </div>

      <Scale score={item.score} />

      {item.status === 'pending' ? (
        <Decision key={item.id} item={item} root={root} keys={keys} onDecide={onDecide} onMove={onMove} />
      ) : (
        <Outcome item={item} />
      )}
    </article>
  );
}

function Photo({ src, label, missing, alt }: Readonly<{ src: string | null; label: string; missing: string; alt: string }>) {
  const [failed, setFailed] = useState(false);
  return (
    <figure className="fc-photo">
      {src && !failed ? (
        // Plain <img>: the photos are private (sent with the session cookie) and already small.
        <img src={src} alt={alt} width={200} height={250} decoding="async" onError={() => setFailed(true)} />
      ) : (
        <span className="fc-photo-missing"><UserRound size={34} strokeWidth={1.6} aria-hidden="true" /><small>{missing}</small></span>
      )}
      <figcaption>{label}</figcaption>
    </figure>
  );
}

/** Where the score sits: the pass line on the left, a clear match on the right. */
function Scale({ score }: Readonly<{ score: number }>) {
  const weak = isWeak(score);
  return (
    <div className="fc-scale">
      <div className="fc-scale-row">
        <Badge tone={weak ? 'warning' : 'neutral'}>{weak ? 'Weak match' : 'Close match'}</Badge>
        <span className="fc-scale-score ds-mono">{score.toFixed(2)}</span>
      </div>
      <div className="fc-scale-track" role="img" aria-label={`Score ${score.toFixed(2)}: it passed at ${FACE_MATCH.pass.toFixed(2)}; a clear match is ${FACE_MATCH.clear.toFixed(2)}`} style={{ '--at': closeness(score).toFixed(3) } as CSSProperties}>
        <span />
      </div>
      <div className="fc-scale-ends" aria-hidden="true"><span>Passed</span><span>Clear</span></div>
    </div>
  );
}

function Decision({ item, root, keys, onDecide, onMove }: Readonly<{
  item: FaceReviewItem;
  root: React.RefObject<HTMLElement | null>;
  keys: boolean;
  onDecide: Decide;
  onMove: (step: 1 | -1) => void;
}>) {
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState<string>(REJECT_REASONS[0]);
  const [other, setOther] = useState('');
  const approveRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const otherRef = useRef<HTMLInputElement>(null);
  const groupName = useId();
  const note = reason === 'other' ? other.trim() : reason;
  const ready = note.length >= 3;

  // Once someone is deciding, the next check arrives with focus on its first
  // action so keys and taps carry on. Not on first load: nothing was chosen yet.
  useEffect(() => {
    const here = root.current;
    if (!here) return undefined;
    const active = document.activeElement;
    if (here.contains(active) || (active === document.body && here.dataset.engaged)) approveRef.current?.focus({ preventScroll: true });
    const engage = () => { here.dataset.engaged = '1'; };
    here.addEventListener('pointerdown', engage);
    here.addEventListener('keydown', engage);
    return () => {
      here.removeEventListener('pointerdown', engage);
      here.removeEventListener('keydown', engage);
    };
  }, [root]);
  useEffect(() => {
    if (rejecting) (reason === 'other' ? otherRef.current : confirmRef.current)?.focus({ preventScroll: true });
  }, [rejecting, reason]);

  // Read through refs so the listener stays put while state changes.
  const live = useRef({ rejecting, ready, note });
  useEffect(() => {
    live.current = { rejecting, ready, note };
  });
  useEffect(() => {
    if (!keys) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const front = document.querySelector('dialog[open]');
      if (front && !(root.current && front.contains(root.current))) return;
      const target = event.target as HTMLElement | null;
      const typing = target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
      const state = live.current;
      if (root.current) root.current.dataset.engaged = '1';
      if (state.rejecting) {
        if (event.key === 'Escape') {
          event.preventDefault();
          setRejecting(false);
          window.setTimeout(() => approveRef.current?.focus({ preventScroll: true }));
        } else if (event.key === 'Enter' && state.ready && target?.tagName !== 'BUTTON') {
          event.preventDefault();
          onDecide(item, 'reject', state.note);
        } else if (!typing && /^[1-3]$/.test(event.key)) {
          event.preventDefault();
          setReason(REJECT_REASONS[Number(event.key) - 1]!);
        }
        return;
      }
      if (typing) return;
      const key = event.key.toLowerCase();
      if (key === 'a') {
        event.preventDefault();
        onDecide(item, 'approve');
      } else if (key === 'x') {
        event.preventDefault();
        setRejecting(true);
      } else if (key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        onMove(1);
      } else if (key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        onMove(-1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [keys, item, onDecide, onMove, root]);

  if (!rejecting) {
    return (
      <div className="fc-actions">
        <button ref={approveRef} className="fc-action is-same" type="button" onClick={() => onDecide(item, 'approve')}>
          <Check size={19} strokeWidth={2.4} aria-hidden="true" />
          <span>Same person</span>
          <kbd aria-hidden="true">A</kbd>
        </button>
        <button className="fc-action is-different" type="button" onClick={() => setRejecting(true)}>
          <X size={19} strokeWidth={2.4} aria-hidden="true" />
          <span>Not the same</span>
          <kbd aria-hidden="true">X</kbd>
        </button>
      </div>
    );
  }

  return (
    <form
      className="fc-reject"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) onDecide(item, 'reject', note);
      }}
    >
      <fieldset>
        <legend>Why remove {item.studentName.split(' ')[0]} from {item.courseCode}?</legend>
        <div className="fc-reasons">
          {REJECT_REASONS.map((value, index) => (
            <label key={value} className="fc-reason">
              <input type="radio" name={groupName} value={value} checked={reason === value} onChange={() => setReason(value)} />
              <span>{value}</span>
              <kbd aria-hidden="true">{index + 1}</kbd>
            </label>
          ))}
          <label className="fc-reason">
            <input type="radio" name={groupName} value="other" checked={reason === 'other'} onChange={() => setReason('other')} />
            <span>Something else</span>
          </label>
        </div>
        {reason === 'other' ? (
          <input
            ref={otherRef}
            className="fc-other"
            value={other}
            onChange={(event) => setOther(event.target.value)}
            maxLength={300}
            placeholder="Say why, in a few words"
            aria-label="Reason"
          />
        ) : null}
      </fieldset>
      <div className="fc-reject-actions">
        <Button variant="gray" onClick={() => setRejecting(false)}>Back</Button>
        <button ref={confirmRef} className={buttonClassName({ variant: 'destructive' })} type="submit" disabled={!ready}>Remove from the list</button>
      </div>
    </form>
  );
}

/** What was decided, by whom and when. */
function Outcome({ item }: Readonly<{ item: FaceReviewItem }>) {
  const when = item.reviewedAt ? `${formatShortDay(item.reviewedAt)}, ${formatClock(item.reviewedAt)}` : null;
  if (item.status === 'removed') {
    return <p className="fc-outcome is-removed">Taken off the list from the session before anyone reviewed it.</p>;
  }
  const approved = item.status === 'approved';
  return (
    <div className={`fc-outcome ${approved ? 'is-approved' : 'is-rejected'}`}>
      <strong>{approved ? <><Check size={16} strokeWidth={2.6} aria-hidden="true" /> Same person</> : <><X size={16} strokeWidth={2.6} aria-hidden="true" /> Removed from the list</>}</strong>
      <span>{[item.reviewedByName ? `By ${item.reviewedByName}` : null, when].filter(Boolean).join(' · ')}</span>
      {item.reviewNote ? <q>{item.reviewNote}</q> : null}
    </div>
  );
}
