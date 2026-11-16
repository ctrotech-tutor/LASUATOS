'use client';

import type { VenueGuide as VenueGuideData } from '@lasuatos/contracts';
import { ArrowUpRight, Compass, LocateFixed, MapPin, Navigation, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { locationSettingsHelp, phonePlatform, requestLocationSample } from '../lib/location';
import { haptic } from '../lib/use-live';
import {
  describeVenuePlace,
  formatDistance,
  hasCoordinates,
  readPosition,
  walkingDirectionsUrl,
  type GuideReading,
} from '../lib/walking-guide';
import { buttonClassName } from './ds';
import './venue-guide.css';

/** Readings rougher than this may put the student on the wrong side of the line. */
const ROUGH_METERS = 60;

type State =
  | { readonly kind: 'idle' }
  | { readonly kind: 'locating'; readonly previous: Extract<State, { kind: 'read' }> | null }
  | { readonly kind: 'unavailable'; readonly help: string }
  | { readonly kind: 'read'; readonly reading: GuideReading; readonly accuracy: number | null; readonly at: number };

const timeFormat = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'Africa/Lagos' });

function headline(reading: GuideReading): string {
  if (reading.kind === 'inside') return 'You’re at the venue';
  if (reading.kind === 'near') return `${formatDistance(reading.meters)} to go`;
  return `${formatDistance(reading.meters)} away`;
}

function detail(reading: GuideReading, checkedIn: boolean): string {
  if (reading.kind === 'inside') return checkedIn ? 'And you’re checked in for this class.' : 'You can check in from here.';
  if (reading.kind === 'near') return `Almost there: head ${reading.direction}, and check in once you’re inside.`;
  return `Head ${reading.direction}, about ${reading.minutes} minute${reading.minutes === 1 ? '' : 's'} on foot.`;
}

/** Whether location is blocked for this site (to give the right help), when the browser can say. */
async function locationBlocked(): Promise<boolean> {
  try {
    const status = await navigator.permissions?.query({ name: 'geolocation' as PermissionName });
    return status?.state === 'denied';
  } catch {
    return false;
  }
}

/**
 * Finding a class's venue, inside its Open-now card: where it is (building, floor, campus),
 * walking directions in the phone's maps app, and "How far am I?", which reads the phone's
 * location once and says, by the same rule the check-in uses, whether they are there yet. The
 * reading stays on the phone; nothing is sent.
 */
export function VenueGuide({ venueName, guide, checkedIn = false }: Readonly<{ venueName: string; guide: VenueGuideData | null; checkedIn?: boolean }>) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const place = describeVenuePlace(guide);
  const located = hasCoordinates(guide) ? guide : null;

  async function locate() {
    if (!located) return;
    setState((current) => ({ kind: 'locating', previous: current.kind === 'read' ? current : null }));
    const sample = await requestLocationSample({ settleMilliseconds: 2500 });
    if (!sample) {
      const blocked = await locationBlocked();
      setState({ kind: 'unavailable', help: locationSettingsHelp(phonePlatform(), blocked ? 'denied' : 'off') });
      return;
    }
    const reading = readPosition(sample, located);
    if (reading.kind === 'inside') haptic(18);
    setState({ kind: 'read', reading, accuracy: sample.accuracyMeters, at: Date.now() });
  }

  const read = state.kind === 'read' ? state : state.kind === 'locating' ? state.previous : null;
  const rough = read && read.accuracy !== null && read.accuracy > ROUGH_METERS;

  return (
    <div className="vg">
      <div className="vg-place">
        <span className="vg-pin" aria-hidden="true"><MapPin size={16} strokeWidth={2.3} /></span>
        <span className="vg-place-text">
          <span className="vg-name">{venueName}</span>
          {place ? <span className="vg-where">{place}</span> : null}
        </span>
      </div>

      {located ? (
        <>
          <div className="vg-actions">
            <a
              className={buttonClassName({ variant: 'gray', size: 'sm', className: 'vg-action' })}
              href={walkingDirectionsUrl(located)}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Navigation size={15} strokeWidth={2.3} aria-hidden="true" />
              <span>Directions</span>
              <ArrowUpRight className="vg-out" size={14} strokeWidth={2.3} aria-hidden="true" />
              <span className="sr-only"> (opens your maps app)</span>
            </a>
            <button
              type="button"
              className={buttonClassName({ variant: 'gray', size: 'sm', className: 'vg-action' })}
              onClick={() => void locate()}
              disabled={state.kind === 'locating'}
              aria-busy={state.kind === 'locating' ? true : undefined}
            >
              {state.kind === 'locating' ? (
                <><LocateFixed className="vg-spin" size={15} strokeWidth={2.3} aria-hidden="true" /><span>Finding you…</span></>
              ) : read ? (
                <><RotateCw size={15} strokeWidth={2.3} aria-hidden="true" /><span>Check again</span></>
              ) : (
                <><Compass size={15} strokeWidth={2.3} aria-hidden="true" /><span>How far am I?</span></>
              )}
            </button>
          </div>

          <div className="vg-live" role="status" aria-live="polite">
            {read ? (
              <div className={`vg-reading is-${read.reading.kind}${state.kind === 'locating' ? ' is-stale' : ''}`}>
                <p className="vg-reading-head">
                  <span className="vg-dot" aria-hidden="true" />
                  <strong>{headline(read.reading)}</strong>
                  <span className="vg-reading-at">at {timeFormat.format(read.at)}</span>
                </p>
                <p className="vg-reading-detail">{detail(read.reading, checkedIn)}</p>
                {rough ? (
                  <p className="vg-reading-rough">Your phone’s location is rough right now (±{Math.round(read.accuracy ?? 0)} m). Step outside or wait a moment, then check again.</p>
                ) : null}
              </div>
            ) : state.kind === 'unavailable' ? (
              <div className="vg-reading is-off">
                <p className="vg-reading-head"><strong>Your location isn’t available</strong></p>
                <p className="vg-reading-detail">{state.help} Or use Directions.</p>
              </div>
            ) : null}
          </div>
          {read ? <p className="vg-private">Your location stays on this phone.</p> : null}
        </>
      ) : (
        <p className="vg-none">Its map location isn’t added yet. Ask your lecturer or course rep for directions.</p>
      )}
    </div>
  );
}
