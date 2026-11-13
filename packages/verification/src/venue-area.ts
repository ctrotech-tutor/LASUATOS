/**
 * Venue presence: is this phone inside the venue?
 *
 * A venue is a shape on the ground plus an allowance:
 * - an outline (the building's footprint, traced corner by corner), or a
 *   circle around a centre point (for open spaces and older registrations);
 * - an allowance in metres: how far outside the shape a reading may land and
 *   still count. Phone positions wander by 5–15 m outdoors and 10–30 m
 *   indoors, so a zero allowance refuses honest students at the walls.
 *
 * A phone reading is a point with an accuracy radius. Android reports that
 * radius at 68% confidence, the W3C spec asks for 95%, and iOS does not say,
 * so the decision never assumes it is better than "about one accuracy radius".
 *
 * Geometry uses a local tangent-plane (equirectangular) projection centred
 * on the venue. Venues are at most a couple of kilometres across, where that
 * projection is accurate to millimetres; no GIS library is needed.
 *
 * This module is pure: the API decides with it, and the check-in page uses
 * the same code to tell the student live whether they will be accepted.
 */

export const EARTH_RADIUS_METERS = 6_371_008.8;

/** An outline needs at least a triangle; 24 corners is plenty for any hall. */
export const OUTLINE_MIN_POINTS = 3;
export const OUTLINE_MAX_POINTS = 24;
/** The largest distance from a venue's centre to any part of its shape. */
export const MAX_VENUE_RADIUS_METERS = 2_000;
export const MIN_CIRCLE_RADIUS_METERS = 5;
/** Allowance beyond the shape: 0 (strict) to 100 m (very forgiving). */
export const MAX_ALLOWANCE_METERS = 100;
/** Used when an administrator has not chosen an allowance. */
export const DEFAULT_ALLOWANCE_METERS = 15;

/** Readings older than this are not evidence of where the student is now. */
export const MAX_READING_AGE_MILLISECONDS = 120_000;
/** Phone clocks drift: allow a reading to look slightly "from the future". */
const MAX_FUTURE_SKEW_MILLISECONDS = 30_000;
/** Above this, the position is network-based or deliberately blurred. */
export const MAX_CONFIRMING_ACCURACY_METERS = 100;
/**
 * iPhones with Precise Location off report ±3–9 km; Android "approximate"
 * location reports about ±2 km. Anything this coarse is a privacy setting,
 * not bad signal, and the student can fix it.
 */
export const APPROXIMATE_LOCATION_METERS = 1_000;

export interface Coordinate {
  /** Degrees, WGS84. */
  readonly latitude: number;
  /** Degrees, WGS84. */
  readonly longitude: number;
}

export type VenueShape =
  | { readonly kind: 'circle'; readonly center: Coordinate; readonly radiusMeters: number }
  | { readonly kind: 'outline'; readonly points: readonly Coordinate[] };

export interface VenueArea {
  readonly shape: VenueShape;
  readonly allowanceMeters: number;
}

interface Planar {
  readonly x: number;
  readonly y: number;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const degrees = (value: number) => (value * 180) / Math.PI;

export function isValidCoordinate(coordinate: Coordinate): boolean {
  return (
    Number.isFinite(coordinate.latitude) &&
    Math.abs(coordinate.latitude) <= 90 &&
    Number.isFinite(coordinate.longitude) &&
    Math.abs(coordinate.longitude) <= 180
  );
}

/** Great-circle distance in metres (haversine on the WGS84 mean radius). */
export function distanceMeters(a: Coordinate, b: Coordinate): number {
  const dLat = radians(b.latitude - a.latitude);
  const dLng = radians(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.latitude)) * Math.cos(radians(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

function longitudeDelta(from: number, to: number): number {
  let delta = to - from;
  if (delta > 180) delta -= 360;
  if (delta < -180) delta += 360;
  return delta;
}

/** Metres east (x) and north (y) of `origin`. */
function project(origin: Coordinate, point: Coordinate): Planar {
  return {
    x: EARTH_RADIUS_METERS * radians(longitudeDelta(origin.longitude, point.longitude)) * Math.cos(radians(origin.latitude)),
    y: EARTH_RADIUS_METERS * radians(point.latitude - origin.latitude),
  };
}

function unproject(origin: Coordinate, point: Planar): Coordinate {
  const latitude = origin.latitude + degrees(point.y / EARTH_RADIUS_METERS);
  let longitude = origin.longitude + degrees(point.x / (EARTH_RADIUS_METERS * Math.cos(radians(origin.latitude))));
  if (longitude > 180) longitude -= 360;
  if (longitude < -180) longitude += 360;
  return { latitude, longitude };
}

/** A projection origin near the shape: the plain average of its corners. */
function roughCenter(points: readonly Coordinate[]): Coordinate {
  const first = points[0]!;
  let x = 0;
  let y = 0;
  for (const point of points) {
    const planar = project(first, point);
    x += planar.x;
    y += planar.y;
  }
  return unproject(first, { x: x / points.length, y: y / points.length });
}

function signedArea(points: readonly Planar[]): number {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const a = points[index]!;
    const b = points[(index + 1) % points.length]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/** Footprint area in square metres. */
export function outlineAreaSquareMeters(points: readonly Coordinate[]): number {
  if (points.length < 3) return 0;
  const origin = roughCenter(points);
  return Math.abs(signedArea(points.map((point) => project(origin, point))));
}

/** The outline's centre of area (what a student would call "the middle"). */
export function outlineCentroid(points: readonly Coordinate[]): Coordinate {
  const origin = roughCenter(points);
  const planar = points.map((point) => project(origin, point));
  const area = signedArea(planar);
  if (Math.abs(area) < 1e-6) return origin;
  let cx = 0;
  let cy = 0;
  for (let index = 0; index < planar.length; index += 1) {
    const a = planar[index]!;
    const b = planar[(index + 1) % planar.length]!;
    const cross = a.x * b.y - b.x * a.y;
    cx += (a.x + b.x) * cross;
    cy += (a.y + b.y) * cross;
  }
  return unproject(origin, { x: cx / (6 * area), y: cy / (6 * area) });
}

/** Distance from `center` to the furthest corner. */
export function outlineReachMeters(points: readonly Coordinate[], center: Coordinate): number {
  return points.reduce((furthest, point) => Math.max(furthest, distanceMeters(center, point)), 0);
}

function segmentsCross(a: Planar, b: Planar, c: Planar, d: Planar): boolean {
  const orientation = (p: Planar, q: Planar, r: Planar) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = orientation(c, d, a);
  const d2 = orientation(c, d, b);
  const d3 = orientation(a, b, c);
  const d4 = orientation(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export type OutlineProblem =
  | 'too_few_points'
  | 'too_many_points'
  | 'invalid_coordinate'
  | 'repeated_point'
  | 'crossing_edges'
  | 'too_small'
  | 'too_large';

/** Why an outline cannot be used as a venue boundary, or null when it can. */
export function outlineProblem(points: readonly Coordinate[]): OutlineProblem | null {
  if (points.length < OUTLINE_MIN_POINTS) return 'too_few_points';
  if (points.length > OUTLINE_MAX_POINTS) return 'too_many_points';
  if (!points.every(isValidCoordinate)) return 'invalid_coordinate';
  const origin = roughCenter(points);
  const planar = points.map((point) => project(origin, point));
  for (let index = 0; index < planar.length; index += 1) {
    const a = planar[index]!;
    const b = planar[(index + 1) % planar.length]!;
    if (Math.hypot(a.x - b.x, a.y - b.y) < 0.5) return 'repeated_point';
  }
  for (let i = 0; i < planar.length; i += 1) {
    for (let j = i + 1; j < planar.length; j += 1) {
      // Neighbouring edges share a corner; that is not a crossing.
      if (j === i + 1 || (i === 0 && j === planar.length - 1)) continue;
      const a1 = planar[i]!;
      const a2 = planar[(i + 1) % planar.length]!;
      const b1 = planar[j]!;
      const b2 = planar[(j + 1) % planar.length]!;
      if (segmentsCross(a1, a2, b1, b2)) return 'crossing_edges';
    }
  }
  if (Math.abs(signedArea(planar)) < 4) return 'too_small';
  if (outlineReachMeters(points, outlineCentroid(points)) > MAX_VENUE_RADIUS_METERS) return 'too_large';
  return null;
}

export const OUTLINE_PROBLEM_TEXT: Record<OutlineProblem, string> = {
  too_few_points: `An outline needs at least ${OUTLINE_MIN_POINTS} corners.`,
  too_many_points: `An outline can have at most ${OUTLINE_MAX_POINTS} corners.`,
  invalid_coordinate: 'One of the corners is not a valid map position.',
  repeated_point: 'Two neighbouring corners are in the same place. Remove one of them.',
  crossing_edges: 'The outline crosses itself. Place the corners in order around the building.',
  too_small: 'The outline is too small to be a venue. Check the corners.',
  too_large: `The outline is too large: no part may be more than ${MAX_VENUE_RADIUS_METERS / 1000} km from its centre.`,
};

function insidePolygon(point: Planar, polygon: readonly Planar[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function distanceToSegment(point: Planar, a: Planar, b: Planar): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** The shape's centre: the circle centre, or the outline's centre of area. */
export function shapeCenter(shape: VenueShape): Coordinate {
  return shape.kind === 'circle' ? shape.center : outlineCentroid(shape.points);
}

/** How far `point` is outside the shape, in metres; 0 when it is inside. */
export function distanceOutsideMeters(shape: VenueShape, point: Coordinate): number {
  if (shape.kind === 'circle') return Math.max(0, distanceMeters(shape.center, point) - shape.radiusMeters);
  const origin = roughCenter(shape.points);
  const planar = shape.points.map((corner) => project(origin, corner));
  const target = project(origin, point);
  if (insidePolygon(target, planar)) return 0;
  let nearest = Number.POSITIVE_INFINITY;
  for (let index = 0; index < planar.length; index += 1) {
    nearest = Math.min(nearest, distanceToSegment(target, planar[index]!, planar[(index + 1) % planar.length]!));
  }
  return nearest;
}

export interface PresenceReading extends Coordinate {
  /** The phone's accuracy radius in metres; null when it gave none. */
  readonly accuracyMeters: number | null;
  /** How old the reading was when it was evaluated. */
  readonly ageMilliseconds: number;
}

export type PresenceOutcome = 'within' | 'outside' | 'inconclusive';

export type PresenceReason =
  /** The reading is inside the shape. */
  | 'inside'
  /** Outside the shape, but within the allowance. */
  | 'within_allowance'
  /** Beyond the allowance by more than the reading's own accuracy. */
  | 'outside'
  /** Beyond the allowance, but by less than the reading's accuracy: a better reading may land inside. */
  | 'outside_uncertain'
  /** The phone is sharing an approximate (privacy-blurred) location. */
  | 'approximate'
  /** The reading is too imprecise to confirm presence. */
  | 'coarse'
  /** The reading is too old, or its time is impossible. */
  | 'stale';

export interface PresenceEvaluation {
  readonly outcome: PresenceOutcome;
  readonly reason: PresenceReason;
  /** Distance outside the shape (0 when inside), metres. */
  readonly outsideMeters: number;
  /** Distance beyond shape + allowance (0 when within it), metres. */
  readonly beyondAllowanceMeters: number;
  /** Distance from the shape's centre, metres. */
  readonly fromCenterMeters: number;
  readonly accuracyMeters: number | null;
}

/**
 * Decides whether a reading places the phone at the venue.
 *
 * In order:
 * 1. a reading older than two minutes (or from the future) → inconclusive, `stale`;
 * 2. further outside than the allowance plus the whole accuracy radius → outside, `outside`
 *    (even the most generous reading of the error cannot put it at the venue);
 * 3. accuracy ≥ 1 km → inconclusive, `approximate` (Precise Location is off);
 * 4. accuracy > 100 m, or none → inconclusive, `coarse`;
 * 5. inside the shape → within, `inside`;
 * 6. outside the shape by no more than the allowance → within, `within_allowance`;
 * 7. otherwise → outside, `outside_uncertain`.
 *
 * Where location is required, only `within` is accepted. The allowance is the
 * single, visible tolerance; the accuracy radius is never added on top of it,
 * which is what let readings well outside the hall through before.
 */
export function evaluatePresence(area: VenueArea, reading: PresenceReading): PresenceEvaluation {
  if (!isValidCoordinate(reading)) throw new RangeError('The reading is not a valid map position.');
  const allowance = Math.max(0, Math.min(MAX_ALLOWANCE_METERS, area.allowanceMeters));
  const accuracy = reading.accuracyMeters != null && Number.isFinite(reading.accuracyMeters) && reading.accuracyMeters >= 0
    ? reading.accuracyMeters
    : null;
  const outsideMeters = distanceOutsideMeters(area.shape, reading);
  const beyondAllowanceMeters = Math.max(0, outsideMeters - allowance);
  const base = {
    outsideMeters,
    beyondAllowanceMeters,
    fromCenterMeters: distanceMeters(shapeCenter(area.shape), reading),
    accuracyMeters: accuracy,
  };
  if (
    !Number.isFinite(reading.ageMilliseconds) ||
    reading.ageMilliseconds > MAX_READING_AGE_MILLISECONDS ||
    reading.ageMilliseconds < -MAX_FUTURE_SKEW_MILLISECONDS
  ) {
    return { ...base, outcome: 'inconclusive', reason: 'stale' };
  }
  if (accuracy != null && beyondAllowanceMeters > accuracy) return { ...base, outcome: 'outside', reason: 'outside' };
  if (accuracy != null && accuracy >= APPROXIMATE_LOCATION_METERS) return { ...base, outcome: 'inconclusive', reason: 'approximate' };
  if (accuracy == null || accuracy > MAX_CONFIRMING_ACCURACY_METERS) return { ...base, outcome: 'inconclusive', reason: 'coarse' };
  if (outsideMeters === 0) return { ...base, outcome: 'within', reason: 'inside' };
  if (beyondAllowanceMeters === 0) return { ...base, outcome: 'within', reason: 'within_allowance' };
  return { ...base, outcome: 'outside', reason: 'outside_uncertain' };
}

/**
 * A suggested allowance from the accuracy measured at the venue: about one
 * accuracy radius, rounded up to 5 m, between 10 and 40 m.
 */
export function recommendedAllowanceMeters(typicalAccuracyMeters: number | null): number {
  if (typicalAccuracyMeters == null || !Number.isFinite(typicalAccuracyMeters)) return DEFAULT_ALLOWANCE_METERS;
  return Math.min(40, Math.max(10, Math.ceil(typicalAccuracyMeters / 5) * 5));
}

/* ------------------------------------------------------------------ */
/* Combining several readings into one fix                             */
/* ------------------------------------------------------------------ */

export interface RawFix extends Coordinate {
  readonly accuracyMeters: number;
  /** When the reading arrived, in milliseconds on the caller's clock. */
  readonly receivedAt: number;
}

export interface CombinedFix extends Coordinate {
  /** Accuracy of the combined fix: the best contributing reading's (never shrunk). */
  readonly accuracyMeters: number;
  /** Arrival time of the newest contributing reading. */
  readonly receivedAt: number;
  /** Readings that went into the fix. */
  readonly sampleCount: number;
  /** Furthest contributing reading from the combined point, metres. */
  readonly spreadMeters: number;
}

/** How long readings stay in the mix: long enough to smooth, short enough to follow a walking student. */
export const FIX_WINDOW_MILLISECONDS = 10_000;

/**
 * Combines recent readings into one position.
 *
 * Phone fixes start coarse (cell, Wi-Fi) and sharpen as GPS locks on, and
 * indoors they jitter. This keeps readings from the last 10 seconds, takes
 * the sharpest one, and averages it with the others that are nearly as sharp
 * and agree with it (weighted by 1/accuracy²). Consecutive GPS errors are
 * strongly correlated, so averaging steadies the point but is not claimed to
 * improve accuracy: the reported accuracy is the best single reading's.
 */
export function combineFixes(fixes: readonly RawFix[], now: number, windowMilliseconds = FIX_WINDOW_MILLISECONDS): CombinedFix | null {
  const recent = fixes.filter(
    (fix) => now - fix.receivedAt <= windowMilliseconds && Number.isFinite(fix.accuracyMeters) && fix.accuracyMeters > 0 && isValidCoordinate(fix),
  );
  if (!recent.length) return null;
  const best = recent.reduce((sharpest, fix) => (fix.accuracyMeters < sharpest.accuracyMeters ? fix : sharpest));
  const peers = recent.filter(
    (fix) =>
      fix.accuracyMeters <= best.accuracyMeters * 1.5 + 2 &&
      distanceMeters(best, fix) <= best.accuracyMeters + fix.accuracyMeters,
  );
  const origin: Coordinate = best;
  let weight = 0;
  let x = 0;
  let y = 0;
  for (const fix of peers) {
    const w = 1 / (fix.accuracyMeters * fix.accuracyMeters);
    const planar = project(origin, fix);
    x += planar.x * w;
    y += planar.y * w;
    weight += w;
  }
  const center = unproject(origin, { x: x / weight, y: y / weight });
  return {
    ...center,
    accuracyMeters: best.accuracyMeters,
    receivedAt: peers.reduce((newest, fix) => Math.max(newest, fix.receivedAt), 0),
    sampleCount: peers.length,
    spreadMeters: peers.reduce((furthest, fix) => Math.max(furthest, distanceMeters(center, fix)), 0),
  };
}

/** Rounds an accuracy for people: "±7 m", "±40 m", "±3 km". */
export function formatAccuracy(meters: number): string {
  if (meters >= 1000) return `±${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0).replace(/\.0$/, '')} km`;
  if (meters >= 20) return `±${Math.round(meters / 5) * 5} m`;
  return `±${Math.max(1, Math.round(meters))} m`;
}

/** Rounds a distance for people: "8 m", "35 m", "1.2 km". */
export function formatMeters(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0).replace(/\.0$/, '')} km`;
  if (meters >= 20) return `${Math.round(meters / 5) * 5} m`;
  return `${Math.max(1, Math.round(meters))} m`;
}

export interface SurveyedPoint extends Coordinate {
  /**
   * How far the registered point may be from the truth, metres: the sharpest
   * reading's accuracy, or the scatter of the readings if that is larger.
   */
  readonly accuracyMeters: number;
  /** Readings averaged into the point. */
  readonly sampleCount: number;
  /** Root-mean-square distance of the averaged readings from the point. */
  readonly spreadMeters: number;
}

/**
 * Turns a stand-still capture (an administrator holding the phone at one spot
 * for 10–30 seconds) into one surveyed point.
 *
 * Unlike combineFixes, which must follow a walking student, this can use the
 * whole capture: it keeps readings nearly as sharp as the best one, averages
 * them by 1/accuracy², drops readings that disagree with that average (a
 * multipath jump off a wall), and averages again. The result is a steadier
 * point than any single reading, and it does not claim to be more accurate
 * than the best of them.
 */
export function surveyPoint(fixes: readonly RawFix[]): SurveyedPoint | null {
  const valid = fixes.filter((fix) => Number.isFinite(fix.accuracyMeters) && fix.accuracyMeters > 0 && isValidCoordinate(fix));
  if (!valid.length) return null;
  const best = valid.reduce((sharpest, fix) => Math.min(sharpest, fix.accuracyMeters), Infinity);
  let kept = valid.filter((fix) => fix.accuracyMeters <= Math.max(best * 1.5, best + 5));

  const average = (points: readonly RawFix[]): Coordinate => {
    const origin = points[0] as Coordinate;
    let weight = 0;
    let x = 0;
    let y = 0;
    for (const fix of points) {
      const w = 1 / (fix.accuracyMeters * fix.accuracyMeters);
      const planar = project(origin, fix);
      x += planar.x * w;
      y += planar.y * w;
      weight += w;
    }
    return unproject(origin, { x: x / weight, y: y / weight });
  };

  let center = average(kept);
  if (kept.length >= 4) {
    const distances = kept.map((fix) => distanceMeters(center, fix)).sort((a, b) => a - b);
    const median = distances[Math.floor(distances.length / 2)] as number;
    const limit = Math.max(best, median * 2.5);
    const agreeing = kept.filter((fix) => distanceMeters(center, fix) <= limit);
    if (agreeing.length >= 2 && agreeing.length < kept.length) {
      kept = agreeing;
      center = average(kept);
    }
  }
  const spread = Math.sqrt(kept.reduce((sum, fix) => sum + distanceMeters(center, fix) ** 2, 0) / kept.length);
  return {
    latitude: Number(center.latitude.toFixed(7)),
    longitude: Number(center.longitude.toFixed(7)),
    accuracyMeters: Math.round(Math.max(best, spread) * 10) / 10,
    sampleCount: kept.length,
    spreadMeters: Math.round(spread * 10) / 10,
  };
}

/* ------------------------------------------------------------------ */
/* Imported building shapes                                            */
/* ------------------------------------------------------------------ */

/** Corners less than this far off the line between their neighbours are mapping noise. */
const NEGLIGIBLE_CORNER_METERS = 0.25;

/**
 * Fits a building footprint (e.g. from OpenStreetMap) into an outline:
 * removes the repeated closing point and corners less than 25 cm off the
 * line between their neighbours (duplicates, points along a straight wall),
 * then, if it still has more than `maxPoints` corners, keeps removing
 * the corner whose removal changes the area least (Visvalingam–Whyatt) until
 * it fits. Returns null when the result is not a usable outline.
 */
export function simplifyOutline(points: readonly Coordinate[], maxPoints = OUTLINE_MAX_POINTS): Coordinate[] | null {
  let ring = points.filter(isValidCoordinate);
  if (ring.length > 1) {
    const first = ring[0]!;
    const last = ring.at(-1)!;
    if (distanceMeters(first, last) < 0.05) ring = ring.slice(0, -1);
  }
  if (ring.length < OUTLINE_MIN_POINTS) return null;
  const origin = roughCenter(ring);
  let planar = ring.map((point) => ({ point, at: project(origin, point) }));

  const cornerArea = (list: typeof planar, index: number): number => {
    const a = list[(index - 1 + list.length) % list.length]!.at;
    const b = list[index]!.at;
    const c = list[(index + 1) % list.length]!.at;
    return Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2;
  };

  /** How far the corner sits off the straight line joining its neighbours. */
  const cornerOffset = (list: typeof planar, index: number): number => {
    const a = list[(index - 1 + list.length) % list.length]!.at;
    const c = list[(index + 1) % list.length]!.at;
    const base = Math.hypot(c.x - a.x, c.y - a.y);
    return base === 0 ? 0 : (2 * cornerArea(list, index)) / base;
  };

  while (planar.length > OUTLINE_MIN_POINTS) {
    // First drop noise (any corner barely off the line), then, if still too
    // many, the corner that changes the area least.
    let smallest = -1;
    let smallestOffset = Number.POSITIVE_INFINITY;
    for (let index = 0; index < planar.length; index += 1) {
      const offset = cornerOffset(planar, index);
      if (offset < smallestOffset) {
        smallestOffset = offset;
        smallest = index;
      }
    }
    if (smallestOffset >= NEGLIGIBLE_CORNER_METERS) {
      if (planar.length <= maxPoints) break;
      let smallestArea = Number.POSITIVE_INFINITY;
      for (let index = 0; index < planar.length; index += 1) {
        const area = cornerArea(planar, index);
        if (area < smallestArea) {
          smallestArea = area;
          smallest = index;
        }
      }
    }
    planar = [...planar.slice(0, smallest), ...planar.slice(smallest + 1)];
  }

  const outline = planar.map(({ point }) => ({
    latitude: Number(point.latitude.toFixed(7)),
    longitude: Number(point.longitude.toFixed(7)),
  }));
  return outlineProblem(outline) ? null : outline;
}

/** True when `point` is inside the outline (or on its edge). */
export function outlineContains(points: readonly Coordinate[], point: Coordinate): boolean {
  return distanceOutsideMeters({ kind: 'outline', points }, point) === 0;
}
