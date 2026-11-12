'use client';

import type { VenueGuide as VenueGuideData } from '@lasuatos/contracts';
import { Compass, ExternalLink, LoaderCircle, MapPin } from 'lucide-react';
import { useState } from 'react';
import { requestLocationSample } from '../lib/location';
import {
  describeVenuePlace,
  formatDistance,
  hasCoordinates,
  readPosition,
  walkingDirectionsUrl,
  type GuideReading,
} from '../lib/walking-guide';

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'locating' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'read'; readonly reading: GuideReading; readonly accuracy: number | null };

function readingText(reading: GuideReading): string {
  if (reading.kind === 'inside') return 'You are at the venue. You can check in now.';
  if (reading.kind === 'near') {
    return `Almost there: about ${formatDistance(reading.meters)} to the ${reading.direction}. Move closer to the venue before you check in.`;
  }
  return `About ${formatDistance(reading.meters)} to the ${reading.direction}, roughly ${reading.minutes} minute${reading.minutes === 1 ? '' : 's'} on foot.`;
}

/**
 * Helps a student find a session's venue: where it is (building, floor,
 * campus), walking directions in their maps app, and a one-tap "how far am I?"
 * reading. The location used here stays on the phone; nothing is sent.
 */
export function VenueGuide({ venueName, guide }: Readonly<{ venueName: string; guide: VenueGuideData | null }>) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const place = describeVenuePlace(guide);
  const located = hasCoordinates(guide) ? guide : null;

  async function locate() {
    if (!located) return;
    setState({ kind: 'locating' });
    const sample = await requestLocationSample();
    if (!sample) {
      setState({ kind: 'unavailable' });
      return;
    }
    setState({ kind: 'read', reading: readPosition(sample, located), accuracy: sample.accuracyMeters });
  }

  return (
    <div className="venue-guide">
      <p className="venue-guide-place">
        <MapPin size={14} aria-hidden="true" />
        <span><strong>{venueName}</strong>{place ? ` · ${place}` : ''}</span>
      </p>
      {located ? (
        <div className="venue-guide-actions">
          <a className="text-button" href={walkingDirectionsUrl(located)} target="_blank" rel="noopener noreferrer">
            Walking directions <ExternalLink size={12} aria-hidden="true" />
          </a>
          <button className="text-button" type="button" onClick={() => void locate()} disabled={state.kind === 'locating'}>
            {state.kind === 'locating'
              ? <><LoaderCircle className="course-spin" size={12} aria-hidden="true" /> Finding you…</>
              : <><Compass size={12} aria-hidden="true" /> How far am I?</>}
          </button>
        </div>
      ) : (
        <p className="venue-guide-note">This venue&apos;s map location has not been registered yet. Ask your lecturer or the course rep for directions.</p>
      )}
      {state.kind === 'read' ? (
        <p className={`venue-guide-reading venue-guide-${state.reading.kind}`} role="status">
          {readingText(state.reading)}
          {state.accuracy !== null && state.accuracy > 60 ? ' Your phone’s location is rough right now; step outside or wait a moment and try again.' : ''}
        </p>
      ) : null}
      {state.kind === 'unavailable' ? (
        <p className="venue-guide-reading venue-guide-away" role="status">
          Your location is not available. Allow location for this site in your browser settings, or use Walking directions.
        </p>
      ) : null}
    </div>
  );
}
