import { describe, expect, it } from 'vitest';
import {
  combineFixes,
  distanceMeters,
  distanceOutsideMeters,
  evaluatePresence,
  formatAccuracy,
  formatMeters,
  outlineAreaSquareMeters,
  outlineCentroid,
  outlineProblem,
  outlineReachMeters,
  outlineContains,
  recommendedAllowanceMeters,
  simplifyOutline,
  surveyPoint,
  type Coordinate,
  type VenueArea,
} from './venue-area.js';

/** Metres → degrees near LASU Ojo (latitude ≈ 6.47°). */
const ORIGIN: Coordinate = { latitude: 6.4672, longitude: 3.2004 };
const METERS_PER_DEGREE_LAT = 111_195;
const METERS_PER_DEGREE_LNG = 111_195 * Math.cos((ORIGIN.latitude * Math.PI) / 180);
const at = (east: number, north: number): Coordinate => ({
  latitude: ORIGIN.latitude + north / METERS_PER_DEGREE_LAT,
  longitude: ORIGIN.longitude + east / METERS_PER_DEGREE_LNG,
});

/** A 40 m × 24 m lecture hall, corners in order, centred on ORIGIN. */
const HALL = [at(-20, -12), at(20, -12), at(20, 12), at(-20, 12)];
const hall = (allowanceMeters: number): VenueArea => ({ shape: { kind: 'outline', points: HALL }, allowanceMeters });
const reading = (point: Coordinate, accuracyMeters: number | null, ageMilliseconds = 1_000) => ({ ...point, accuracyMeters, ageMilliseconds });

describe('venue geometry', () => {
  it('measures distances like a surveyor would', () => {
    expect(distanceMeters(at(0, 0), at(30, 40))).toBeCloseTo(50, 1);
    expect(outlineAreaSquareMeters(HALL)).toBeCloseTo(960, 0);
    const centre = outlineCentroid(HALL);
    expect(distanceMeters(centre, ORIGIN)).toBeLessThan(0.05);
    expect(outlineReachMeters(HALL, centre)).toBeCloseTo(Math.hypot(20, 12), 1);
  });

  it('puts the back rows of a hall inside it (a 10 m circle would not)', () => {
    const backRow = at(17, 10); // 19.7 m from the centre
    expect(distanceOutsideMeters({ kind: 'outline', points: HALL }, backRow)).toBe(0);
    expect(distanceOutsideMeters({ kind: 'circle', center: ORIGIN, radiusMeters: 10 }, backRow)).toBeCloseTo(9.72, 1);
  });

  it('measures how far outside the walls a point is', () => {
    expect(distanceOutsideMeters({ kind: 'outline', points: HALL }, at(0, 20))).toBeCloseTo(8, 1); // 8 m north of the north wall
    expect(distanceOutsideMeters({ kind: 'outline', points: HALL }, at(23, 16))).toBeCloseTo(5, 1); // 3 m east, 4 m north of a corner
    expect(distanceOutsideMeters({ kind: 'circle', center: ORIGIN, radiusMeters: 25 }, at(0, 40))).toBeCloseTo(15, 1);
  });

  it('handles L-shaped (concave) buildings', () => {
    const lShape = [at(0, 0), at(30, 0), at(30, 10), at(10, 10), at(10, 30), at(0, 30)];
    expect(outlineProblem(lShape)).toBeNull();
    expect(distanceOutsideMeters({ kind: 'outline', points: lShape }, at(5, 25))).toBe(0);
    expect(distanceOutsideMeters({ kind: 'outline', points: lShape }, at(20, 20))).toBeCloseTo(10, 1); // in the notch
  });

  it('explains outlines that cannot be used', () => {
    expect(outlineProblem(HALL.slice(0, 2))).toBe('too_few_points');
    expect(outlineProblem([HALL[0]!, HALL[2]!, HALL[1]!, HALL[3]!])).toBe('crossing_edges');
    expect(outlineProblem([HALL[0]!, HALL[0]!, HALL[1]!, HALL[2]!])).toBe('repeated_point');
    expect(outlineProblem([at(0, 0), at(1, 0), at(1, 1)])).toBe('too_small');
    expect(outlineProblem([at(0, 0), at(5000, 0), at(5000, 10)])).toBe('too_large');
    expect(outlineProblem([{ latitude: 95, longitude: 0 }, at(10, 0), at(10, 10)])).toBe('invalid_coordinate');
    expect(outlineProblem(Array.from({ length: 25 }, (_, index) => at(Math.cos(index / 4) * 30, Math.sin(index / 4) * 30)))).toBe('too_many_points');
  });
});

describe('presence decisions', () => {
  it('accepts a student anywhere inside the hall', () => {
    expect(evaluatePresence(hall(0), reading(at(18, -11), 12))).toMatchObject({ outcome: 'within', reason: 'inside' });
  });

  it('accepts a reading that drifted just outside the walls, within the allowance', () => {
    const result = evaluatePresence(hall(15), reading(at(0, 22), 14)); // 10 m outside
    expect(result).toMatchObject({ outcome: 'within', reason: 'within_allowance' });
    expect(result.outsideMeters).toBeCloseTo(10, 0);
  });

  it('refuses a student standing 30 m from the hall, however imprecise the phone says it is', () => {
    // The old rule accepted this: 30 m outside, minus ±25 m accuracy, looked "inconclusive".
    const result = evaluatePresence(hall(15), reading(at(0, 42), 25));
    expect(result.outcome).toBe('outside');
    expect(result.reason).toBe('outside_uncertain');
    expect(result.beyondAllowanceMeters).toBeCloseTo(15, 0);
  });

  it('says clearly outside when even the error radius cannot reach the venue', () => {
    expect(evaluatePresence(hall(15), reading(at(0, 150), 10))).toMatchObject({ outcome: 'outside', reason: 'outside' });
    // Far away beats "imprecise": a ±300 m reading 2 km away is still outside.
    expect(evaluatePresence(hall(15), reading(at(0, 2000), 300))).toMatchObject({ outcome: 'outside', reason: 'outside' });
  });

  it('asks for Precise Location when the phone only shares an approximate position', () => {
    expect(evaluatePresence(hall(15), reading(at(0, 0), 4_200))).toMatchObject({ outcome: 'inconclusive', reason: 'approximate' });
  });

  it('never confirms presence from a coarse or missing accuracy', () => {
    expect(evaluatePresence(hall(15), reading(at(0, 0), 140))).toMatchObject({ outcome: 'inconclusive', reason: 'coarse' });
    expect(evaluatePresence(hall(15), reading(at(0, 0), null))).toMatchObject({ outcome: 'inconclusive', reason: 'coarse' });
  });

  it('ignores old readings (a cached position from before the student moved)', () => {
    expect(evaluatePresence(hall(15), reading(at(0, 0), 8, 121_000))).toMatchObject({ outcome: 'inconclusive', reason: 'stale' });
    expect(evaluatePresence(hall(15), reading(at(0, 0), 8, -31_000))).toMatchObject({ reason: 'stale' });
    expect(evaluatePresence(hall(15), reading(at(0, 0), 8, -5_000))).toMatchObject({ outcome: 'within' });
  });

  it('works for circles too, with the allowance beyond the radius', () => {
    const circle: VenueArea = { shape: { kind: 'circle', center: ORIGIN, radiusMeters: 20 }, allowanceMeters: 10 };
    expect(evaluatePresence(circle, reading(at(0, 28), 8))).toMatchObject({ outcome: 'within', reason: 'within_allowance' });
    expect(evaluatePresence(circle, reading(at(0, 36), 8))).toMatchObject({ outcome: 'outside', reason: 'outside_uncertain' });
    expect(evaluatePresence(circle, reading(at(0, 36), 8)).fromCenterMeters).toBeCloseTo(36, 0);
  });

  it('rejects impossible coordinates', () => {
    expect(() => evaluatePresence(hall(15), reading({ latitude: Number.NaN, longitude: 3 }, 5))).toThrow(RangeError);
  });
});

describe('combining readings', () => {
  it('waits for the sharp GPS fix and ignores the early network guess', () => {
    const fixes = [
      { ...at(60, 40), accuracyMeters: 80, receivedAt: 0 },
      { ...at(4, 2), accuracyMeters: 9, receivedAt: 2_000 },
      { ...at(2, 1), accuracyMeters: 7, receivedAt: 3_000 },
      { ...at(3, 3), accuracyMeters: 8, receivedAt: 4_000 },
    ];
    const fix = combineFixes(fixes, 4_500)!;
    expect(fix.accuracyMeters).toBe(7);
    expect(fix.sampleCount).toBe(3);
    expect(distanceMeters(fix, at(3, 2))).toBeLessThan(1.5);
    expect(fix.spreadMeters).toBeLessThan(3);
  });

  it('drops a jump that disagrees with the sharp readings', () => {
    const fix = combineFixes([
      { ...at(0, 0), accuracyMeters: 6, receivedAt: 1_000 },
      { ...at(40, 0), accuracyMeters: 8, receivedAt: 1_500 },
    ], 2_000)!;
    expect(fix.sampleCount).toBe(1);
    expect(distanceMeters(fix, at(0, 0))).toBeLessThan(0.01);
  });

  it('forgets readings older than the window, so a student who walks in is seen inside', () => {
    const fixes = [
      { ...at(0, 60), accuracyMeters: 5, receivedAt: 0 }, // outside, very sharp, but 12 s old
      { ...at(0, 0), accuracyMeters: 12, receivedAt: 11_000 },
    ];
    const fix = combineFixes(fixes, 12_000)!;
    expect(distanceMeters(fix, at(0, 0))).toBeLessThan(0.01);
    expect(combineFixes(fixes, 30_000)).toBeNull();
  });
});

describe('suggestions and wording', () => {
  it('suggests an allowance of about one accuracy radius', () => {
    expect(recommendedAllowanceMeters(4)).toBe(10);
    expect(recommendedAllowanceMeters(17)).toBe(20);
    expect(recommendedAllowanceMeters(90)).toBe(40);
    expect(recommendedAllowanceMeters(null)).toBe(15);
  });

  it('rounds for people', () => {
    expect(formatAccuracy(6.4)).toBe('±6 m');
    expect(formatAccuracy(23)).toBe('±25 m');
    expect(formatAccuracy(4_200)).toBe('±4.2 km');
    expect(formatMeters(0.2)).toBe('1 m');
    expect(formatMeters(1_000)).toBe('1 km');
  });
});

describe('surveying a point', () => {
  it('averages a stand-still capture and drops a multipath jump', () => {
    const fixes = [
      { ...at(40, 0), accuracyMeters: 60, receivedAt: 0 }, // first coarse Wi-Fi guess: too vague, left out
      { ...at(3, 1), accuracyMeters: 8, receivedAt: 1_000 },
      { ...at(-2, 2), accuracyMeters: 7, receivedAt: 2_000 },
      { ...at(1, -3), accuracyMeters: 6, receivedAt: 3_000 },
      { ...at(-1, -1), accuracyMeters: 6, receivedAt: 4_000 },
      { ...at(25, 20), accuracyMeters: 7, receivedAt: 5_000 }, // bounced off a wall
      { ...at(0, 2), accuracyMeters: 8, receivedAt: 6_000 },
    ];
    const point = surveyPoint(fixes)!;
    expect(point.sampleCount).toBe(5);
    expect(distanceMeters(point, at(0, 0))).toBeLessThan(2);
    expect(point.accuracyMeters).toBe(6);
    expect(point.spreadMeters).toBeLessThan(3);
  });

  it('reports the scatter when it is worse than the phone claims', () => {
    const fixes = [
      { ...at(-9, 0), accuracyMeters: 5, receivedAt: 0 },
      { ...at(9, 0), accuracyMeters: 5, receivedAt: 1_000 },
      { ...at(0, 9), accuracyMeters: 5, receivedAt: 2_000 },
    ];
    const point = surveyPoint(fixes)!;
    expect(point.accuracyMeters).toBeGreaterThan(8);
    expect(surveyPoint([])).toBeNull();
  });
});

describe('fitting imported building shapes', () => {
  it('drops the closing point and straight-line corners, keeping the real ones', () => {
    // 40 m × 20 m hall mapped with extra points along its long walls, closed like OSM.
    const mapped = [at(0, 0), at(10, 0), at(20, 0.05), at(30, 0), at(40, 0), at(40, 20), at(20, 20), at(0, 20), at(0, 0)];
    const outline = simplifyOutline(mapped)!;
    expect(outline).toHaveLength(4);
    expect(outlineAreaSquareMeters(outline)).toBeGreaterThan(790);
    expect(outlineAreaSquareMeters(outline)).toBeLessThan(810);
  });

  it('fits a detailed footprint into 24 corners without losing its shape', () => {
    // A round auditorium mapped with 60 points, radius 30 m.
    const round = Array.from({ length: 60 }, (_, index) => {
      const angle = (index / 60) * Math.PI * 2;
      return at(Math.cos(angle) * 30, Math.sin(angle) * 30);
    });
    const outline = simplifyOutline([...round, round[0]!])!;
    expect(outline.length).toBeLessThanOrEqual(24);
    const full = Math.PI * 30 * 30;
    expect(outlineAreaSquareMeters(outline) / full).toBeGreaterThan(0.95);
  });

  it('keeps the notches of a concave hall and knows what is inside', () => {
    // An arrow-like hall: the notch at the left must survive.
    const hall = [at(0, 0), at(30, 0), at(30, -15), at(60, 10), at(30, 35), at(30, 20), at(0, 20), at(10, 10)];
    const outline = simplifyOutline(hall)!;
    expect(outline).toHaveLength(8);
    expect(outlineContains(outline, at(40, 10))).toBe(true);
    expect(outlineContains(outline, at(3, 10))).toBe(false); // inside the notch
  });

  it('rejects shapes that cannot be an outline', () => {
    expect(simplifyOutline([at(0, 0), at(10, 0), at(0, 0)])).toBeNull();
    expect(simplifyOutline([at(0, 0), at(10, 10), at(10, 0), at(0, 10)])).toBeNull(); // crosses itself
  });
});
