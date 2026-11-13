'use client';

import { formatAccuracy, formatMeters, type PresenceEvaluation } from '@lasuatos/verification/venue-area';
import { AlertTriangle, CheckCircle2, LocateFixed, MapPinOff, Navigation, RotateCcw } from 'lucide-react';
import { useMemo } from 'react';
import { locationSettingsHelp, phonePlatform, type LiveLocation } from '../lib/location';

type Tone = 'ok' | 'wait' | 'warn' | 'bad';

interface View {
  readonly tone: Tone;
  readonly title: string;
  readonly detail?: string | undefined;
}

/** How long before "still looking" turns into advice. */
const SLOW_FIX_MILLISECONDS = 12_000;

export function describeLocation(live: LiveLocation, presence: PresenceEvaluation | null, venueName: string, now: number): View {
  const platform = phonePlatform();
  switch (live.status) {
    case 'unsupported':
      return { tone: 'bad', title: 'This browser cannot share your location', detail: 'Open this page in Chrome or Safari on your phone.' };
    case 'denied':
      return { tone: 'bad', title: 'Location is blocked for this site', detail: locationSettingsHelp(platform, 'denied') };
    case 'unavailable':
      if (!live.fix) return { tone: 'bad', title: 'Your phone could not find your location', detail: locationSettingsHelp(platform, 'off') };
      break;
    case 'idle':
    case 'waiting':
      return live.startedAt && now - live.startedAt > SLOW_FIX_MILLISECONDS
        ? { tone: 'wait', title: 'Still looking for your location…', detail: 'Make sure Location is on. If your phone asked, tap Allow. Standing near a window or the door helps.' }
        : { tone: 'wait', title: 'Finding your location…', detail: 'If your phone asks, tap Allow.' };
    default:
      break;
  }
  if (!presence) return { tone: 'wait', title: 'Finding your location…' };
  const accuracy = presence.accuracyMeters != null ? formatAccuracy(presence.accuracyMeters) : '';
  switch (presence.reason) {
    case 'inside':
    case 'within_allowance':
      return { tone: 'ok', title: `You’re at ${venueName}`, detail: `Location accurate to ${accuracy}.` };
    case 'outside':
      return { tone: 'bad', title: `You’re about ${formatMeters(presence.outsideMeters)} from ${venueName}`, detail: `Go into the venue to mark attendance. (Accuracy ${accuracy}.)` };
    case 'outside_uncertain':
      return { tone: 'warn', title: `Not confirmed yet: about ${formatMeters(presence.outsideMeters)} outside`, detail: `Your location is accurate to ${accuracy}. If you are inside, hold on a few seconds while it sharpens, or move away from thick walls.` };
    case 'approximate':
      return { tone: 'bad', title: 'Your phone is sharing only an approximate location', detail: `Accuracy ${accuracy} cannot confirm you are in the venue. ${locationSettingsHelp(platform, 'approximate')}` };
    case 'coarse':
      return live.startedAt && now - live.startedAt > SLOW_FIX_MILLISECONDS
        ? { tone: 'warn', title: `Location not precise enough yet (${accuracy})`, detail: 'Make sure Location is on, then move near a window or the door for a few seconds.' }
        : { tone: 'wait', title: `Sharpening your location… (${accuracy})`, detail: 'This usually takes a few seconds.' };
    default:
      return { tone: 'wait', title: 'Taking a fresh reading…' };
  }
}

const ICONS: Record<Tone, typeof CheckCircle2> = {
  ok: CheckCircle2,
  wait: LocateFixed,
  warn: Navigation,
  bad: AlertTriangle,
};

/**
 * The live "are you in the venue?" card on the check-in form. It runs the
 * server's own rule on the phone, so students know before they tap the
 * button, and it updates as they move or as the reading sharpens.
 */
export function LocationCheck({
  live,
  presence,
  venueName,
}: Readonly<{ live: LiveLocation & { restart: () => void }; presence: PresenceEvaluation | null; venueName: string }>) {
  const view = useMemo(() => describeLocation(live, presence, venueName, live.updatedAt), [live, presence, venueName]);
  const Icon = live.status === 'denied' || live.status === 'unsupported' ? MapPinOff : ICONS[view.tone];
  const retryable = live.status === 'denied' || live.status === 'unavailable';
  return (
    <div className={`lx-locate is-${view.tone}`} role="status" aria-live="polite">
      <span className="lx-locate-icon" aria-hidden="true"><Icon size={20} /></span>
      <div className="lx-locate-copy">
        <strong>{view.title}</strong>
        {view.detail ? <span>{view.detail}</span> : null}
      </div>
      {retryable ? (
        <button type="button" className="lx-locate-retry" onClick={live.restart}>
          <RotateCcw size={14} aria-hidden="true" /> Try again
        </button>
      ) : null}
    </div>
  );
}
