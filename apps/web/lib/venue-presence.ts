import type { VenueGuide } from '@lasuatos/contracts';
import {
  evaluatePresence,
  type CombinedFix,
  type PresenceEvaluation,
  type VenueArea,
} from '@lasuatos/verification/venue-area';

/** The venue's shape and allowance as the check-in page knows them, or null without a registered location. */
export function venueAreaFromGuide(guide: VenueGuide | null): VenueArea | null {
  if (!guide || guide.latitude == null || guide.longitude == null) return null;
  if (guide.outline && guide.outline.length >= 3) {
    return { shape: { kind: 'outline', points: guide.outline }, allowanceMeters: guide.allowanceMeters ?? 0 };
  }
  if (!guide.radiusMeters) return null;
  return {
    shape: { kind: 'circle', center: { latitude: guide.latitude, longitude: guide.longitude }, radiusMeters: guide.radiusMeters },
    allowanceMeters: guide.allowanceMeters ?? 0,
  };
}

/**
 * The same decision the server makes, run on the phone so the student sees
 * it before they submit. The server still decides; this only predicts.
 */
export function previewPresence(area: VenueArea | null, fix: CombinedFix | null, now = Date.now()): PresenceEvaluation | null {
  if (!area || !fix) return null;
  try {
    return evaluatePresence(area, { ...fix, ageMilliseconds: now - fix.receivedAt });
  } catch {
    return null;
  }
}
