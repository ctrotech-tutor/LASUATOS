'use client';

import type { LectureHelpRequest, LectureSessionSummary } from '@lasuatos/contracts';
import { formatAccuracy } from '@lasuatos/verification/venue-area';
import { ChevronDown, UserRound, X } from 'lucide-react';
import { useState } from 'react';
import { decideLectureHelp, failureText, formatClock, helpRequestPhotoUrl } from '../../lib/lecture-api';
import { toCheckInLocation, useLiveLocation } from '../../lib/location';
import { Button } from '../ds';
import { useFeedback } from '../feedback';
import { LocationCheck } from '../location-check';
import { numberFormat } from './format';

function venueLine(request: LectureHelpRequest): string | null {
  const accuracy = request.accuracyMeters != null ? ` (${formatAccuracy(request.accuracyMeters)})` : '';
  if (request.venueOutcome === 'within') return `Phone in the venue${accuracy}`;
  if (request.venueOutcome === 'outside') return `Phone outside the venue${accuracy}`;
  if (request.venueOutcome === 'inconclusive') return `Location unconfirmed${accuracy}`;
  if (request.venueOutcome === 'unavailable') return 'No location from the phone';
  return null;
}

/**
 * Students whose face check would not pass and who asked to be added. Compare the registered
 * photo with the person in the room, then add them (an ordinary "added by hand") or decline.
 */
export function HelpRequests({ session, requests, isRep, onChanged }: Readonly<{
  session: LectureSessionSummary;
  requests: readonly LectureHelpRequest[];
  isRep: boolean;
  onChanged: () => void;
}>) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const dialogs = useFeedback();
  const pending = requests.filter((request) => request.status === 'pending');
  const decided = requests.filter((request) => request.status !== 'pending');
  // A class rep vouches the student is in the room: their own phone must be in the venue.
  const needsLocation = isRep && session.requireVenue && session.status === 'open' && pending.length > 0;
  const live = useLiveLocation(needsLocation);

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
        : `Still finding your location in ${session.venueName ?? 'the venue'}. Wait a few seconds and try again.`);
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
    <section className="tk-help" aria-labelledby="tk-help-title">
      <div className="tk-section-head">
        <h2 className="tk-section-title" id="tk-help-title">
          Asking to be added {pending.length ? <span className="tk-pill is-warning">{numberFormat.format(pending.length)}</span> : null}
        </h2>
      </div>
      {needsLocation ? <LocationCheck live={live} presence={null} venueName={session.venueName ?? 'the venue'} /> : null}
      {error ? <p className="tk-error" role="alert">{error}</p> : null}
      {pending.length ? (
        <ul className="ds-list tk-help-list">
          {pending.map((request) => {
            const venue = venueLine(request);
            return (
              <li key={request.id} className="tk-help-item">
                {request.hasPhoto ? (
                  <img className="tk-help-photo" src={helpRequestPhotoUrl(session.id, request.id)} alt={`Registered photo of ${request.fullName}`} width={64} height={64} loading="lazy" />
                ) : (
                  <span className="tk-help-photo is-empty" aria-hidden="true"><UserRound size={26} /></span>
                )}
                <div className="tk-help-body">
                  <strong>{request.fullName}</strong>
                  <span className="ds-mono">{request.matricNumber}</span>
                  <span className="tk-help-meta">
                    {request.reasonLabel} · {request.failures} tr{request.failures === 1 ? 'y' : 'ies'} · {formatClock(request.createdAt)}
                    {venue ? <><br />{venue}</> : null}
                  </span>
                </div>
                <div className="tk-help-actions">
                  <Button size="sm" busy={busy === request.id} disabled={Boolean(busy)} onClick={() => void decide(request, 'add')}>Add</Button>
                  <button
                    className="ds-icon-btn"
                    type="button"
                    disabled={Boolean(busy)}
                    aria-label={`Decline ${request.fullName}`}
                    data-tip="Decline"
                    onClick={() => void decide(request, 'decline')}
                  >
                    <X size={18} strokeWidth={2.2} aria-hidden="true" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="tk-quiet">No one is waiting.</p>
      )}
      {decided.length ? (
        <details className="tk-decided">
          <summary>
            <ChevronDown size={16} strokeWidth={2.2} aria-hidden="true" />
            {decided.length} decided
          </summary>
          <ul className="ds-list">
            {decided.map((request) => (
              <li key={request.id}><div className="ds-row">
                <span className="ds-row-body">
                  <span className="ds-row-title">{request.fullName}</span>
                  <span className="ds-row-subtitle ds-mono">{request.matricNumber}</span>
                </span>
                <span className={`tk-flag is-${request.status === 'added' ? 'success' : 'neutral'}`}>{request.status === 'added' ? 'Added' : 'Declined'}</span>
              </div></li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
