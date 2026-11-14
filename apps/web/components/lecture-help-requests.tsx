'use client';

import type { LectureHelpRequest, LectureSessionSummary } from '@lasuatos/contracts';
import { formatAccuracy } from '@lasuatos/verification/venue-area';
import { Check, ChevronDown, Hand, MapPin, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { decideLectureHelp, failureText, formatClock, helpRequestPhotoUrl } from '../lib/lecture-api';
import { toCheckInLocation, useLiveLocation } from '../lib/location';
import { useFeedback } from './feedback';
import { LocationCheck } from './location-check';

function venueLine(request: LectureHelpRequest): string | null {
  const accuracy = request.accuracyMeters != null ? ` · ${formatAccuracy(request.accuracyMeters)}` : '';
  if (request.venueOutcome === 'within') return `Phone in the venue${accuracy}`;
  if (request.venueOutcome === 'outside') return `Phone outside the venue${accuracy}`;
  if (request.venueOutcome === 'inconclusive') return `Location unconfirmed${accuracy}`;
  if (request.venueOutcome === 'unavailable') return 'No location from the phone';
  return null;
}

/**
 * Students whose face check would not pass and who asked to be added. The
 * session taker compares the registered photo with the person in the room,
 * then adds them (the usual "added by hand", with its rules) or declines.
 */
export function HelpRequestsPanel({
  session,
  requests,
  isRep,
  onChanged,
}: Readonly<{ session: LectureSessionSummary; requests: readonly LectureHelpRequest[]; isRep: boolean; onChanged: () => void }>) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [showDecided, setShowDecided] = useState(false);
  const dialogs = useFeedback();
  const pending = requests.filter((request) => request.status === 'pending');
  const decided = requests.filter((request) => request.status !== 'pending');
  // A class rep vouches the student is in the room: their own phone must be in the venue.
  const needsLocation = isRep && session.requireVenue && session.status === 'open' && pending.length > 0;
  const live = useLiveLocation(needsLocation);
  if (requests.length === 0) return null;

  async function decide(request: LectureHelpRequest, decision: 'add' | 'decline') {
    if (decision === 'decline') {
      const sure = await dialogs.confirm({
        title: `Decline ${request.fullName}?`,
        body: 'They see that you did not add them, and can try the face check again or speak to you.',
        confirmLabel: 'Decline',
        tone: 'danger',
      });
      if (!sure) return;
    }
    const fix = live.fixRef.current;
    if (decision === 'add' && needsLocation && !fix) {
      setError(live.status === 'denied'
        ? `Location is blocked. Class reps can add students only from inside ${session.venueName ?? 'the venue'}: allow location for this site and try again.`
        : `Still finding your location to confirm you are in ${session.venueName ?? 'the venue'}. Wait a few seconds and try again.`);
      return;
    }
    setBusy(request.id);
    setError('');
    try {
      await decideLectureHelp(session.id, request.id, {
        decision,
        ...(decision === 'add' && needsLocation && fix ? { location: toCheckInLocation(fix) } : {}),
      });
      dialogs.toast(decision === 'add' ? `${request.fullName} was added.` : `You declined ${request.fullName}.`);
      onChanged();
    } catch (caught) {
      setError(failureText(caught));
    } finally {
      setBusy('');
    }
  }

  return (
    <section className={`lx-card lx-help-panel${pending.length > 0 ? ' has-pending' : ''}`} aria-label="Students asking to be added">
      <div className="lx-help-head">
        <Hand size={18} aria-hidden="true" />
        <div>
          <h2>{pending.length > 0 ? `${pending.length} asking to be added` : 'Help requests'}</h2>
          <p>Their face check did not pass. Compare the registered photo with the student in front of you before adding them.</p>
        </div>
      </div>
      {needsLocation ? <LocationCheck live={live} presence={null} venueName={session.venueName ?? 'the venue'} /> : null}
      {error ? <p className="lx-error" role="alert">{error}</p> : null}
      {pending.length > 0 ? (
        <ul className="lx-help-list">
          {pending.map((request) => {
            const venue = venueLine(request);
            return (
              <li key={request.id} className="lx-help-item">
                {request.hasPhoto ? (
                  <img className="lx-help-photo" src={helpRequestPhotoUrl(session.id, request.id)} alt={`Registered photo of ${request.fullName}`} width={72} height={72} loading="lazy" />
                ) : (
                  <span className="lx-help-photo is-empty" aria-hidden="true"><UserRound size={28} /></span>
                )}
                <div className="lx-help-body">
                  <strong>{request.fullName}</strong>
                  <span className="lx-help-matric">{request.matricNumber}</span>
                  <span className="lx-help-meta">{request.reasonLabel} · {request.failures} tr{request.failures === 1 ? 'y' : 'ies'} · asked {formatClock(request.createdAt)}</span>
                  {venue ? <span className={`lx-help-meta${request.venueOutcome === 'within' ? ' is-ok' : request.venueOutcome ? ' is-warn' : ''}`}><MapPin size={12} aria-hidden="true" /> {venue}</span> : null}
                </div>
                <div className="lx-help-actions">
                  <button className="button button-primary" type="button" disabled={Boolean(busy)} onClick={() => void decide(request, 'add')}>
                    <Check size={16} aria-hidden="true" /> {busy === request.id ? 'Saving…' : 'Add'}
                  </button>
                  <button className="button button-secondary" type="button" disabled={Boolean(busy)} onClick={() => void decide(request, 'decline')}>
                    <X size={16} aria-hidden="true" /> Decline
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="lx-fine">No one is waiting.</p>
      )}
      {decided.length > 0 ? (
        <div className="lx-help-decided">
          <button className="lx-link-button" type="button" aria-expanded={showDecided} onClick={() => setShowDecided((value) => !value)}>
            <ChevronDown size={14} aria-hidden="true" className={showDecided ? 'is-open' : undefined} /> {decided.length} decided
          </button>
          {showDecided ? (
            <ul>
              {decided.map((request) => (
                <li key={request.id}>
                  <span>{request.fullName} · {request.matricNumber}</span>
                  <span className={`lx-flag ${request.status === 'added' ? 'is-ok' : 'is-warn'}`}>{request.status === 'added' ? 'Added' : 'Declined'}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
