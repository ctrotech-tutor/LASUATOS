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
 * start from. Lookups run on the server, so the site's content security
 * policy stays same-origin, requests identify us as the OSM usage policies
 * ask, and repeated taps are cached.
 *
 * Sources, in order: the main Overpass instance (built for reads, but often
 * "at capacity"), then the OpenStreetMap API's map call for a ~120 m box
 * (the same database the map tiles are drawn from, and reliably fast for a
 * box this small), then an Overpass mirror.
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

const OVERPASS_MAIN = 'https://overpass-api.de/api/interpreter';
const OVERPASS_MIRROR = 'https://overpass.private.coffee/api/interpreter';
const OSM_API_MAP = 'https://api.openstreetmap.org/api/0.6/map.json';
const SEARCH_RADIUS_METERS = 60;
const MAX_RESULTS = 5;
const OVERPASS_TIMEOUT_MILLISECONDS = 6_000;
const OSM_API_TIMEOUT_MILLISECONDS = 10_000;
const METERS_PER_DEGREE = 111_320;
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

function isBuilding(tags: Record<string, string> | undefined): boolean {
  const value = tags?.building;
  return typeof value === 'string' && value !== '' && value !== 'no';
}

interface OsmApiElement {
  readonly type: string;
  readonly id: number;
  readonly lat?: number;
  readonly lon?: number;
  readonly nodes?: readonly number[];
  readonly tags?: Record<string, string>;
  readonly members?: readonly { readonly type: string; readonly ref: number; readonly role: string }[];
}

/** A ~120 m box around the point, as the API's `bbox=left,bottom,right,top`. */
export function osmApiBox(point: Coordinate): string {
  const dLat = SEARCH_RADIUS_METERS / METERS_PER_DEGREE;
  const dLng = SEARCH_RADIUS_METERS / (METERS_PER_DEGREE * Math.max(Math.cos((point.latitude * Math.PI) / 180), 0.01));
  return [point.longitude - dLng, point.latitude - dLat, point.longitude + dLng, point.latitude + dLat]
    .map((value) => value.toFixed(7))
    .join(',');
}

/**
 * OpenStreetMap API map JSON (bare nodes, ways listing node ids, relations
 * listing members) → the Overpass `out geom` shape, buildings only.
 * Multipolygon buildings use their closed outer ways that reached the box.
 */
export function osmApiToOverpass(payload: unknown): { elements: OverpassElement[] } {
  const elements = (payload as { elements?: unknown })?.elements;
  if (!Array.isArray(elements)) return { elements: [] };
  const nodes = new Map<number, OverpassPoint>();
  const ways = new Map<number, OverpassPoint[]>();
  for (const element of elements as OsmApiElement[]) {
    if (element?.type === 'node' && Number.isFinite(element.lat) && Number.isFinite(element.lon)) {
      nodes.set(element.id, { lat: element.lat as number, lon: element.lon as number });
    }
  }
  const geometryOf = (ids: readonly number[] | undefined): OverpassPoint[] | undefined => {
    if (!Array.isArray(ids)) return undefined;
    const points = ids.map((id) => nodes.get(id));
    return points.every((node): node is OverpassPoint => node != null) ? points : undefined;
  };
  const out: OverpassElement[] = [];
  for (const element of elements as OsmApiElement[]) {
    if (element?.type !== 'way') continue;
    const geometry = geometryOf(element.nodes);
    if (!geometry) continue;
    ways.set(element.id, geometry);
    if (isBuilding(element.tags)) out.push({ type: 'way', id: element.id, tags: element.tags ?? {}, geometry });
  }
  for (const element of elements as OsmApiElement[]) {
    if (element?.type !== 'relation' || element.tags?.type !== 'multipolygon' || !isBuilding(element.tags)) continue;
    const members = (element.members ?? [])
      .filter((member) => member.type === 'way' && ways.has(member.ref))
      .map((member) => ({ type: 'way', role: member.role, geometry: ways.get(member.ref) as OverpassPoint[] }));
    if (members.length) out.push({ type: 'relation', id: element.id, tags: element.tags, members });
  }
  return { elements: out };
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
    if (!element || typeof element.id !== 'number' || !isBuilding(element.tags)) continue;
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
  // The API's box reaches past the search circle at its corners.
  const nearby = buildings.filter((building) => building.distanceMeters <= SEARCH_RADIUS_METERS);
  buildings.length = 0;
  buildings.push(...nearby);
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
      const overpass = (endpoint: string) => async () => {
        const response = await fetchImpl(endpoint, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': USER_AGENT },
          body: new URLSearchParams({ data: overpassQuery(point) }).toString(),
          signal: AbortSignal.timeout(OVERPASS_TIMEOUT_MILLISECONDS),
        });
        return response.ok ? (await response.json()) as unknown : null;
      };
      const osmApi = async () => {
        const response = await fetchImpl(`${OSM_API_MAP}?bbox=${osmApiBox(point)}`, {
          method: 'GET',
          headers: { accept: 'application/json', 'user-agent': USER_AGENT },
          signal: AbortSignal.timeout(OSM_API_TIMEOUT_MILLISECONDS),
        });
        return response.ok ? osmApiToOverpass(await response.json()) : null;
      };
      for (const source of [overpass(OVERPASS_MAIN), osmApi, overpass(OVERPASS_MIRROR)]) {
        try {
          const payload = await source();
          // An overloaded Overpass can answer 200 with a "remark" and no
          // elements; only an elements list counts as an answer.
          if (!Array.isArray((payload as { elements?: unknown } | null)?.elements)) continue;
          const result: BuildingOutlineResult = { status: 'ok', buildings: parseBuildingOutlines(payload, point) };
          if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
          cache.set(key, { at: now(), result });
          return result;
        } catch {
          // Unreachable, timed out or not JSON: try the next source.
        }
      }
      return { status: 'unavailable', buildings: [] };
    },
  };
}
