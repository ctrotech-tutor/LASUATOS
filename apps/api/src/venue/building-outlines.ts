import {
  distanceOutsideMeters,
  outlineAreaSquareMeters,
  outlineContains,
  simplifyOutline,
  type Coordinate,
} from '@lasuatos/verification/venue-area';

/**
 * Building footprints from OpenStreetMap, for drawing a venue's outline.
 *
 * Mapped footprints are traced from aerial imagery and usually line up with
 * the real walls to within a few metres, far better than phone GPS indoors
 * (10–30 m off), so they are the most accurate outline an administrator can
 * start from. Lookups go through the Overpass API from the server, so the
 * site's content security policy stays same-origin, the request identifies
 * us as Overpass's usage policy asks, and repeated taps are cached.
 */

export interface BuildingOutline {
  readonly name: string | null;
  readonly osmUrl: string;
  readonly outline: Coordinate[];
  /** Whether the tapped point is inside the building. */
  readonly containsPoint: boolean;
  /** Distance from the tapped point to the building's walls (0 inside), metres. */
  readonly distanceMeters: number;
  readonly areaSquareMeters: number;
}

export type BuildingOutlineResult =
  | { readonly status: 'ok'; readonly buildings: BuildingOutline[] }
  | { readonly status: 'unavailable'; readonly buildings: [] };

export interface BuildingOutlineLookup {
  find(point: Coordinate): Promise<BuildingOutlineResult>;
}

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
];
const SEARCH_RADIUS_METERS = 60;
const MAX_RESULTS = 5;
const REQUEST_TIMEOUT_MILLISECONDS = 12_000;
const CACHE_MILLISECONDS = 10 * 60_000;
const CACHE_LIMIT = 200;
const USER_AGENT = 'LASUATOS venue setup (Lagos State University attendance; https://lasuatos.vercel.app)';

interface OverpassPoint {
  readonly lat: number;
  readonly lon: number;
}

interface OverpassElement {
  readonly type: string;
  readonly id: number;
  readonly tags?: Record<string, string>;
  readonly geometry?: readonly OverpassPoint[];
  readonly members?: readonly { readonly type: string; readonly role: string; readonly geometry?: readonly OverpassPoint[] }[];
}

function overpassQuery(point: Coordinate): string {
  const at = `${point.latitude.toFixed(7)},${point.longitude.toFixed(7)}`;
  return `[out:json][timeout:10];(way["building"](around:${SEARCH_RADIUS_METERS},${at});relation["building"]["type"="multipolygon"](around:${SEARCH_RADIUS_METERS},${at}););out geom tags;`;
}

function toRing(geometry: readonly OverpassPoint[] | undefined): Coordinate[] | null {
  if (!geometry || geometry.length < 4) return null;
  const ring = geometry
    .filter((node) => Number.isFinite(node?.lat) && Number.isFinite(node?.lon))
    .map((node) => ({ latitude: node.lat, longitude: node.lon }));
  const first = ring[0];
  const last = ring.at(-1);
  // Only closed rings are footprints.
  if (!first || !last || first.latitude !== last.latitude || first.longitude !== last.longitude) return null;
  return ring;
}

/** A building's outer wall: a way's ring, or a multipolygon's largest closed outer ring. */
function outerRing(element: OverpassElement): Coordinate[] | null {
  if (element.type === 'way') return toRing(element.geometry);
  if (element.type !== 'relation') return null;
  const rings = (element.members ?? [])
    .filter((member) => member.type === 'way' && (member.role === 'outer' || member.role === ''))
    .map((member) => toRing(member.geometry))
    .filter((ring): ring is Coordinate[] => ring != null);
  if (!rings.length) return null;
  return rings.reduce((largest, ring) => (outlineAreaSquareMeters(ring.slice(0, -1)) > outlineAreaSquareMeters(largest.slice(0, -1)) ? ring : largest));
}

function buildingName(tags: Record<string, string> | undefined): string | null {
  const name = tags?.name ?? tags?.['building:name'] ?? tags?.official_name ?? tags?.alt_name ?? null;
  return name ? name.trim().slice(0, 160) || null : null;
}

/**
 * Overpass JSON → candidate outlines, best first: buildings containing the
 * point (smallest first, so a hall inside a complex wins), then the nearest.
 */
export function parseBuildingOutlines(payload: unknown, point: Coordinate): BuildingOutline[] {
  const elements = (payload as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return [];
  const buildings: BuildingOutline[] = [];
  for (const element of elements as OverpassElement[]) {
    if (!element || typeof element.id !== 'number') continue;
    const ring = outerRing(element);
    if (!ring) continue;
    const outline = simplifyOutline(ring);
    if (!outline) continue;
    const raw = ring.slice(0, -1);
    buildings.push({
      name: buildingName(element.tags),
      osmUrl: `https://www.openstreetmap.org/${element.type}/${element.id}`,
      outline,
      containsPoint: outlineContains(raw, point),
      distanceMeters: Math.round(distanceOutsideMeters({ kind: 'outline', points: raw }, point) * 10) / 10,
      areaSquareMeters: Math.round(outlineAreaSquareMeters(raw)),
    });
  }
  buildings.sort((a, b) =>
    a.containsPoint !== b.containsPoint
      ? (a.containsPoint ? -1 : 1)
      : a.containsPoint
        ? a.areaSquareMeters - b.areaSquareMeters
        : a.distanceMeters - b.distanceMeters,
  );
  return buildings.slice(0, MAX_RESULTS);
}

type Fetch = (input: string, init: RequestInit) => Promise<Response>;

export function createOverpassBuildingLookup(fetchImpl: Fetch = (input, init) => fetch(input, init), now: () => number = Date.now): BuildingOutlineLookup {
  const cache = new Map<string, { at: number; result: BuildingOutlineResult }>();
  return {
    async find(point) {
      // ~1 m buckets: repeated taps on the same spot reuse the answer.
      const key = `${point.latitude.toFixed(5)},${point.longitude.toFixed(5)}`;
      const cached = cache.get(key);
      if (cached && now() - cached.at < CACHE_MILLISECONDS) return cached.result;
      for (const endpoint of ENDPOINTS) {
        try {
          const response = await fetchImpl(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/x-www-form-urlencoded',
              accept: 'application/json',
              'user-agent': USER_AGENT,
            },
            body: new URLSearchParams({ data: overpassQuery(point) }).toString(),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
          });
          if (!response.ok) continue;
          const result: BuildingOutlineResult = { status: 'ok', buildings: parseBuildingOutlines(await response.json(), point) };
          if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
          cache.set(key, { at: now(), result });
          return result;
        } catch {
          // Try the next mirror.
        }
      }
      return { status: 'unavailable', buildings: [] };
    },
  };
}
