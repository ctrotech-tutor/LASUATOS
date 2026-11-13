import type { VenueGuide } from '@lasuatos/contracts';
import { distanceOutsideMeters } from '@lasuatos/verification/venue-area';
import { venueAreaFromGuide } from './venue-presence';

/**
 * Pure helpers for the student "find your venue" guide. Distances are
 * straight-line (great-circle) estimates; real walking routes come from the
 * phone's own maps app via the directions link.
 */

const EARTH_RADIUS_METERS = 6_371_008.8;
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'] as const;
/** A typical walking pace of about 80 metres per minute (4.8 km/h). */
const WALKING_METERS_PER_MINUTE = 80;

export interface Point { readonly latitude: number; readonly longitude: number }

const radians = (degrees: number) => (degrees * Math.PI) / 180;

export function distanceMeters(from: Point, to: Point): number {
  const deltaLatitude = radians(to.latitude - from.latitude);
  const deltaLongitude = radians(to.longitude - from.longitude);
  const a = Math.sin(deltaLatitude / 2) ** 2
    + Math.cos(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.sin(deltaLongitude / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing in degrees clockwise from north (0–360). */
export function bearingDegrees(from: Point, to: Point): number {
  const y = Math.sin(radians(to.longitude - from.longitude)) * Math.cos(radians(to.latitude));
  const x = Math.cos(radians(from.latitude)) * Math.sin(radians(to.latitude))
    - Math.sin(radians(from.latitude)) * Math.cos(radians(to.latitude)) * Math.cos(radians(to.longitude - from.longitude));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

export function compassDirection(bearing: number): (typeof COMPASS)[number] {
  return COMPASS[Math.round(bearing / 45) % 8]!;
}

export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export function walkingMinutes(meters: number): number {
  return Math.max(1, Math.round(meters / WALKING_METERS_PER_MINUTE));
}

/** "Engineering Complex · Ground floor · Epe Campus" — whatever is known. */
export function describeVenuePlace(guide: VenueGuide | null): string {
  if (!guide) return '';
  return [guide.buildingName, guide.floorLabel, guide.sectionLabel, guide.campusName].filter(Boolean).join(' · ');
}

export function hasCoordinates(guide: VenueGuide | null): guide is VenueGuide & { latitude: number; longitude: number } {
  return Boolean(guide && guide.latitude !== null && guide.longitude !== null);
}

/** Opens walking directions in Google Maps (app or web) on any phone. */
export function walkingDirectionsUrl(destination: Point): string {
  const params = new URLSearchParams({
    api: '1',
    destination: `${destination.latitude.toFixed(6)},${destination.longitude.toFixed(6)}`,
    travelmode: 'walking',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

export type GuideReading =
  | { readonly kind: 'inside'; readonly meters: number }
  | { readonly kind: 'near'; readonly meters: number; readonly direction: string }
  | { readonly kind: 'away'; readonly meters: number; readonly direction: string; readonly minutes: number };

/**
 * Where the student is relative to the venue, by the same rule the check-in
 * uses: inside when the reading is within the venue's shape plus its
 * allowance (the phone's accuracy is not added on top).
 */
export function readPosition(
  here: Point & { readonly accuracyMeters?: number | null },
  guide: VenueGuide & { latitude: number; longitude: number },
): GuideReading {
  const venue = { latitude: guide.latitude, longitude: guide.longitude };
  const meters = distanceMeters(here, venue);
  const area = venueAreaFromGuide(guide) ?? {
    shape: { kind: 'circle' as const, center: venue, radiusMeters: 50 },
    allowanceMeters: 0,
  };
  const beyond = Math.max(0, distanceOutsideMeters(area.shape, here) - area.allowanceMeters);
  if (beyond === 0) return { kind: 'inside', meters };
  const direction = compassDirection(bearingDegrees(here, venue));
  if (beyond <= 150) return { kind: 'near', meters: beyond, direction };
  return { kind: 'away', meters: beyond, direction, minutes: walkingMinutes(beyond) };
}
