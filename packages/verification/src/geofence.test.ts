import { describe, expect, it } from 'vitest';
import {
  evaluateCircularGeofence,
  haversineMeters,
  isValidCoordinate,
  MAX_READING_AGE_MILLISECONDS,
  MAX_USABLE_ACCURACY_METERS,
} from './geofence.js';
import type { LocationReading } from './geofence.js';

const now = new Date('2026-11-10T12:00:00.000Z');

// Approximate anchor for the LASU Epe campus area (public map reference).
const theVenue = { latitude: 6.59425, longitude: 3.995948 };

function reading(partial: Partial<LocationReading>): LocationReading {
  return {
    latitude: theVenue.latitude,
    longitude: theVenue.longitude,
    accuracyMeters: 10,
    capturedAt: new Date(now.getTime() - 5_000),
    ...partial,
  };
}

describe('haversineMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineMeters(theVenue, theVenue)).toBe(0);
  });

  it('matches the known WGS84 metre-per-degree scale near the equator', () => {
    const eastOneDegree = { latitude: 0, longitude: 1 };
    const origin = { latitude: 0, longitude: 0 };
    const distance = haversineMeters(origin, eastOneDegree);
    expect(distance).toBeGreaterThan(111_000);
    expect(distance).toBeLessThan(111_500);
  });

  it('is symmetric and handles antipodal points', () => {
    const antipode = { latitude: -theVenue.latitude, longitude: theVenue.longitude + 180 };
    const forward = haversineMeters(theVenue, antipode);
    const backward = haversineMeters(antipode, theVenue);
    expect(forward).toBeCloseTo(backward, 6);
    expect(forward).toBeGreaterThan(19_900_000);
    expect(forward).toBeLessThan(20_100_000);
  });
});

describe('evaluateCircularGeofence', () => {
  const geofence = { kind: 'circle' as const, center: theVenue, radiusMeters: 80 };

  it('accepts a fresh, accurate reading inside the boundary', () => {
    const evaluation = evaluateCircularGeofence(geofence, reading({}), now);
    expect(evaluation.outcome).toBe('within');
    expect(evaluation.distanceMeters).toBe(0);
    expect(evaluation.reasons).toEqual(['within_boundary']);
  });

  it('rejects clearly-outside readings even at the best end of the error circle', () => {
    // ~500 m north of the venue; accuracy 10 m → best case still far outside.
    const evaluation = evaluateCircularGeofence(
      geofence,
      reading({ latitude: theVenue.latitude + 0.0045 }),
      now,
    );
    expect(evaluation.outcome).toBe('outside');
    expect(evaluation.reasons).toEqual(['clearly_outside_boundary']);
    expect(evaluation.bestCaseDistanceMeters).toBeGreaterThan(80);
  });

  it('marks boundary-straddling error circles inconclusive, not outside', () => {
    // ~90 m from the center with 30 m accuracy: center outside, but the error
    // circle still overlaps the 80 m boundary.
    const latitudeOffset = 90 / 111_320; // ≈ metres per degree latitude near LASU latitude
    const evaluation = evaluateCircularGeofence(
      geofence,
      reading({ latitude: theVenue.latitude + latitudeOffset, accuracyMeters: 30 }),
      now,
    );
    expect(evaluation.outcome).toBe('inconclusive');
    expect(evaluation.reasons).toEqual(['boundary_uncertain']);
  });

  it('never trusts a coarse reading, even when the pin lands inside', () => {
    const evaluation = evaluateCircularGeofence(
      geofence,
      reading({ accuracyMeters: MAX_USABLE_ACCURACY_METERS + 1 }),
      now,
    );
    expect(evaluation.outcome).toBe('inconclusive');
    expect(evaluation.reasons).toEqual(['accuracy_too_coarse']);
  });

  it('rejects stale readings regardless of position', () => {
    const stale = evaluateCircularGeofence(
      geofence,
      reading({ capturedAt: new Date(now.getTime() - MAX_READING_AGE_MILLISECONDS - 1) }),
      now,
    );
    expect(stale.outcome).toBe('inconclusive');
    expect(stale.reasons).toEqual(['stale_reading']);

    const future = evaluateCircularGeofence(
      geofence,
      reading({ capturedAt: new Date(now.getTime() + 5_000) }),
      now,
    );
    expect(future.outcome).toBe('inconclusive');
    expect(future.reasons).toEqual(['stale_reading']);
  });

  it('rejects invalid coordinates, accuracy and radii instead of guessing', () => {
    expect(() => evaluateCircularGeofence(
      { ...geofence, center: { latitude: 91, longitude: 0 } },
      reading({}),
      now,
    )).toThrow(RangeError);
    expect(() => evaluateCircularGeofence(
      { ...geofence, radiusMeters: 0 },
      reading({}),
      now,
    )).toThrow(RangeError);
    expect(() => evaluateCircularGeofence(
      geofence,
      reading({ accuracyMeters: Number.NaN }),
      now,
    )).toThrow(RangeError);
    expect(isValidCoordinate({ latitude: -90, longitude: 180 })).toBe(true);
    expect(isValidCoordinate({ latitude: -90.000001, longitude: 0 })).toBe(false);
  });
});
