/**
 * Accuracy-aware circular geofence evaluation.
 *
 * A browser GPS reading is evidence, not proof: every reading carries an
 * uncertainty radius and an age, and a hostile or broken device can produce
 * coordinates that look wrong for legitimate reasons. This module therefore
 * returns explainable outcomes (`within`, `outside`, `inconclusive`) instead
 * of a boolean, and never treats a low-quality reading inside the boundary as
 * definitive presence.
 *
 * Distances use the Haversine formula on the WGS84 mean Earth radius. This is
 * appropriate for venue-scale geofences (meters); PostGIS/polygon geofences
 * are intentionally left for a documented future requirement.
 */

export const EARTH_MEAN_RADIUS_METERS = 6_371_008.8;

/** Readings older than this cannot support a fresh attendance decision. */
export const MAX_READING_AGE_MILLISECONDS = 120_000;

/**
 * A reading with an uncertainty radius larger than this can never produce a
 * `within` outcome, regardless of where its center lands. Venue-scoped
 * policies may lower this bound; raising it is not supported.
 */
export const MAX_USABLE_ACCURACY_METERS = 100;

export interface GeographicCoordinate {
  /** Degrees latitude, WGS84. */
  readonly latitude: number;
  /** Degrees longitude, WGS84. */
  readonly longitude: number;
}

export interface LocationReading extends GeographicCoordinate {
  /** Device-reported horizontal accuracy in meters (68% confidence radius). */
  readonly accuracyMeters: number;
  /** When the device produced this reading. */
  readonly capturedAt: Date;
}

export interface CircularGeofence {
  readonly kind: 'circle';
  readonly center: GeographicCoordinate;
  readonly radiusMeters: number;
}

export type GeofenceOutcome = 'within' | 'outside' | 'inconclusive';

export interface GeofenceEvaluation {
  readonly outcome: GeofenceOutcome;
  /** Distance between the reading center and the venue center, in meters. */
  readonly distanceMeters: number;
  /** Worst-case distance once the accuracy radius is accounted for. */
  readonly worstCaseDistanceMeters: number;
  /** Best-case distance once the accuracy radius is accounted for. */
  readonly bestCaseDistanceMeters: number;
  /** Reading age at evaluation, in milliseconds. */
  readonly readingAgeMilliseconds: number;
  /** Machine-readable reasons explaining an `outside`/`inconclusive` result. */
  readonly reasons: readonly (
    | 'stale_reading'
    | 'accuracy_too_coarse'
    | 'boundary_uncertain'
    | 'clearly_outside_boundary'
    | 'within_boundary'
  )[];
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance between two coordinates, in meters. */
export function haversineMeters(a: GeographicCoordinate, b: GeographicCoordinate): number {
  const dLat = toRadians(b.latitude - a.latitude);
  const dLng = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * EARTH_MEAN_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function isValidCoordinate(coordinate: GeographicCoordinate): boolean {
  return (
    Number.isFinite(coordinate.latitude) &&
    Math.abs(coordinate.latitude) <= 90 &&
    Number.isFinite(coordinate.longitude) &&
    Math.abs(coordinate.longitude) <= 180
  );
}

/**
 * Evaluate a location reading against a circular venue geofence.
 *
 * Decision logic, using d = center distance, a = accuracy radius, R = radius:
 * - Reading older than 120 s           → inconclusive (`stale_reading`)
 * - Accuracy radius larger than 100 m  → inconclusive (`accuracy_too_coarse`),
 *   even when the pin appears inside the boundary — a coarse reading is never
 *   silently trusted.
 * - d <= R                             → within
 * - d - a > R                          → outside (`clearly_outside_boundary`
 *   even at the best end of the error circle); a risk signal, not a finding of
 *   misconduct.
 * - otherwise                          → inconclusive (`boundary_uncertain`).
 */
export function evaluateCircularGeofence(
  geofence: CircularGeofence,
  reading: LocationReading,
  now: Date,
): GeofenceEvaluation {
  if (!Number.isFinite(geofence.radiusMeters) || geofence.radiusMeters < 5 || geofence.radiusMeters > 2_000) {
    throw new RangeError('Geofence radius must be between 5 and 2000 meters.');
  }
  if (!isValidCoordinate(geofence.center) || !isValidCoordinate(reading)) {
    throw new RangeError('Coordinates must be finite with latitude in [-90,90] and longitude in [-180,180].');
  }
  if (!Number.isFinite(reading.accuracyMeters) || reading.accuracyMeters < 0) {
    throw new RangeError('Accuracy must be a non-negative finite number of meters.');
  }

  const distanceMeters = haversineMeters(geofence.center, reading);
  const readingAgeMilliseconds = now.getTime() - reading.capturedAt.getTime();
  const worstCaseDistanceMeters = distanceMeters + reading.accuracyMeters;
  const bestCaseDistanceMeters = Math.max(0, distanceMeters - reading.accuracyMeters);

  const base = {
    distanceMeters,
    worstCaseDistanceMeters,
    bestCaseDistanceMeters,
    readingAgeMilliseconds,
  } as const;

  if (readingAgeMilliseconds < 0 || readingAgeMilliseconds > MAX_READING_AGE_MILLISECONDS) {
    return { ...base, outcome: 'inconclusive', reasons: ['stale_reading'] };
  }
  if (reading.accuracyMeters > MAX_USABLE_ACCURACY_METERS) {
    return { ...base, outcome: 'inconclusive', reasons: ['accuracy_too_coarse'] };
  }
  if (distanceMeters <= geofence.radiusMeters) {
    return { ...base, outcome: 'within', reasons: ['within_boundary'] };
  }
  if (bestCaseDistanceMeters > geofence.radiusMeters) {
    return { ...base, outcome: 'outside', reasons: ['clearly_outside_boundary'] };
  }
  return { ...base, outcome: 'inconclusive', reasons: ['boundary_uncertain'] };
}
