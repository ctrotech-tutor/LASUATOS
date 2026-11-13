import { describe, expect, it, vi } from 'vitest';
import { createOverpassBuildingLookup, osmApiBox, osmApiToOverpass, parseBuildingOutlines } from './building-outlines.js';

const ORIGIN = { latitude: 6.4672, longitude: 3.2004 };
const M = 111_195;
const node = (east: number, north: number) => ({
  lat: ORIGIN.latitude + north / M,
  lon: ORIGIN.longitude + east / (M * Math.cos((ORIGIN.latitude * Math.PI) / 180)),
});
const point = (east: number, north: number) => {
  const { lat, lon } = node(east, north);
  return { latitude: lat, longitude: lon };
};
const closed = (nodes: { lat: number; lon: number }[]) => [...nodes, nodes[0]!];

// Shaped like the Engineering Hall footprint: concave, 12 corners.
const engineeringHall = closed([
  node(-10, 45), node(5, 45), node(3, 33), node(20, 18), node(32, 10), node(28, -5),
  node(8, -30), node(-8, -30), node(-8, -5), node(-30, -5), node(-32, 10), node(-15, 15),
]);
const annex = closed([node(50, 0), node(70, 0), node(70, 15), node(50, 15)]);
const room = closed([node(-5, 0), node(5, 0), node(5, 8), node(-5, 8)]);

const payload = {
  elements: [
    { type: 'way', id: 11, tags: { building: 'yes' }, geometry: annex },
    { type: 'way', id: 22, tags: { building: 'university', name: 'Engineering Hall' }, geometry: engineeringHall },
    { type: 'way', id: 33, tags: { building: 'yes', name: 'Room 1' }, geometry: room },
    { type: 'way', id: 44, tags: { building: 'yes' }, geometry: [node(0, 0), node(1, 1)] }, // not closed
    { type: 'relation', id: 55, tags: { building: 'yes', type: 'multipolygon', name: 'Complex' }, members: [
      { type: 'way', role: 'outer', geometry: closed([node(-100, -100), node(100, -100), node(100, 100), node(-100, 100)]) },
      { type: 'way', role: 'inner', geometry: closed([node(-90, -90), node(-80, -90), node(-80, -80)]) },
    ] },
  ],
};

// Real OpenStreetMap API reply (trimmed) for a tap in LASU Epe's Engineering
// Hall, way 1503995544. Data © OpenStreetMap contributors, ODbL.
const engineeringHallMap = { version: '0.6', elements: [
  { type: 'node', id: 5394952131, lat: 6.5930917, lon: 3.9960315 },
  { type: 'node', id: 5812880646, lat: 6.5930275, lon: 3.9957523 },
  { type: 'node', id: 5812880645, lat: 6.5929625, lon: 3.9955842 },
  { type: 'node', id: 13763434190, lat: 6.5935645, lon: 3.9954776 },
  { type: 'node', id: 13763434191, lat: 6.593514, lon: 3.9954869 },
  { type: 'node', id: 13763434192, lat: 6.5934451, lon: 3.995436 },
  { type: 'node', id: 13763434193, lat: 6.5934436, lon: 3.9953744 },
  { type: 'node', id: 13763434194, lat: 6.5933717, lon: 3.995376 },
  { type: 'node', id: 13763434195, lat: 6.5932967, lon: 3.9955362 },
  { type: 'node', id: 13763434196, lat: 6.5932125, lon: 3.9955269 },
  { type: 'node', id: 13763434197, lat: 6.5932125, lon: 3.9956086 },
  { type: 'node', id: 13763434198, lat: 6.5933472, lon: 3.9957257 },
  { type: 'node', id: 13763434199, lat: 6.5934176, lon: 3.9957149 },
  { type: 'node', id: 13763434200, lat: 6.5934237, lon: 3.9956656 },
  { type: 'node', id: 13763485001, lat: 6.5935247, lon: 3.9955408 },
  { type: 'node', id: 13763485002, lat: 6.5935676, lon: 3.9955362 },
  { type: 'way', id: 614529496, nodes: [5394952131, 5812880646, 5812880645], tags: { highway: 'unclassified' } },
  { type: 'way', id: 1503995544, nodes: [13763434190, 13763434191, 13763434192, 13763434193, 13763434194, 13763434195, 13763434196, 13763434197, 13763434198, 13763434199, 13763434200, 13763485001, 13763485002, 13763434190],
    tags: { 'addr:city': 'Epe', building: 'school', height: '10', name: 'Engineering Hall', 'roof:colour': 'Red' } },
] };

describe('OpenStreetMap building outlines', () => {
  it('puts the smallest building containing the tap first, then the nearest others', () => {
    const tap = point(0, 4);
    const buildings = parseBuildingOutlines(payload, tap);
    expect(buildings.map((b) => b.name)).toEqual(['Room 1', 'Engineering Hall', 'Complex', null]);
    expect(buildings[0]).toMatchObject({ containsPoint: true, distanceMeters: 0, osmUrl: 'https://www.openstreetmap.org/way/33' });
    expect(buildings[3]).toMatchObject({ containsPoint: false });
    expect(buildings[3]!.distanceMeters).toBeGreaterThan(45);
    expect(buildings[2]!.osmUrl).toBe('https://www.openstreetmap.org/relation/55');
  });

  it('keeps every real corner of the hall', () => {
    const [hall] = parseBuildingOutlines(payload, point(20, 10));
    expect(hall!.name).toBe('Engineering Hall');
    expect(hall!.outline).toHaveLength(12);
    expect(hall!.areaSquareMeters).toBeGreaterThan(2000);
  });

  it('ignores junk, non-buildings and buildings beyond the search circle', () => {
    expect(parseBuildingOutlines(null, point(0, 0))).toEqual([]);
    expect(parseBuildingOutlines({ elements: 'x' }, point(0, 0))).toEqual([]);
    const far = closed([node(90, 0), node(100, 0), node(100, 10), node(90, 10)]);
    expect(parseBuildingOutlines({ elements: [
      { type: 'way', id: 1, tags: { landuse: 'grass' }, geometry: room },
      { type: 'way', id: 2, tags: { building: 'no' }, geometry: room },
      { type: 'way', id: 3, tags: { building: 'yes' }, geometry: far },
    ] }, point(0, 4))).toEqual([]);
  });

  it('reads the OpenStreetMap API map format (node ids, not geometry)', () => {
    let nextId = 1000;
    const nodes: { type: 'node'; id: number; lat: number; lon: number }[] = [];
    const way = (id: number, ring: { lat: number; lon: number }[], tags: Record<string, string>) => {
      const ids = ring.slice(0, -1).map((at) => {
        nextId += 1;
        nodes.push({ type: 'node', id: nextId, ...at });
        return nextId;
      });
      return { type: 'way', id, nodes: [...ids, ids[0]!], tags };
    };
    const map = { version: '0.6', elements: [
      ...[] as unknown[],
      way(22, engineeringHall, { building: 'university', name: 'Engineering Hall' }),
      way(77, closed([node(-40, -40), node(40, -40), node(40, -41)]), { highway: 'service' }),
      way(88, annex, {}),
      { type: 'way', id: 99, nodes: [1, 2, 3, 1], tags: { building: 'yes' } }, // nodes missing
      { type: 'relation', id: 55, tags: { type: 'multipolygon', building: 'yes', name: 'Annex block' }, members: [
        { type: 'way', ref: 88, role: 'outer' }, { type: 'way', ref: 12345, role: 'outer' },
      ] },
    ] };
    map.elements.unshift(...nodes);
    const converted = osmApiToOverpass(map);
    expect(converted.elements.map((e) => `${e.type}/${e.id}`)).toEqual(['way/22', 'relation/55']);
    const buildings = parseBuildingOutlines(converted, point(20, 10));
    expect(buildings[0]).toMatchObject({ name: 'Engineering Hall', containsPoint: true, osmUrl: 'https://www.openstreetmap.org/way/22' });
    expect(buildings[0]!.outline).toHaveLength(12);
    expect(buildings[1]).toMatchObject({ name: 'Annex block', containsPoint: false });
    expect(osmApiToOverpass(null)).toEqual({ elements: [] });
  });

  it('loads the real Engineering Hall footprint from an OpenStreetMap API reply', () => {
    const [hall, ...others] = parseBuildingOutlines(osmApiToOverpass(engineeringHallMap), { latitude: 6.5933947, longitude: 3.995547 });
    expect(others).toEqual([]);
    expect(hall).toMatchObject({ name: 'Engineering Hall', containsPoint: true, distanceMeters: 0, osmUrl: 'https://www.openstreetmap.org/way/1503995544' });
    expect(hall!.outline).toHaveLength(13);
    expect(hall!.outline[0]).toEqual({ latitude: 6.5935645, longitude: 3.9954776 });
    expect(hall!.areaSquareMeters).toBeGreaterThan(400);
    expect(hall!.areaSquareMeters).toBeLessThan(1500);
  });

  it('asks for a box of about 120 m around the tap', () => {
    const [left, bottom, right, top] = osmApiBox(ORIGIN).split(',').map(Number) as [number, number, number, number];
    expect((top - bottom) * 111_320).toBeCloseTo(120, 0);
    expect((right - left) * 111_320 * Math.cos((ORIGIN.latitude * Math.PI) / 180)).toBeCloseTo(120, 0);
    expect(left).toBeLessThan(ORIGIN.longitude);
    expect(top).toBeGreaterThan(ORIGIN.latitude);
  });

  it('asks Overpass first and caches the answer', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    const lookup = createOverpassBuildingLookup(fetchImpl);
    const first = await lookup.find(point(20, 10));
    expect(first.status).toBe('ok');
    expect(first.buildings[0]!.name).toBe('Engineering Hall');
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe('https://overpass-api.de/api/interpreter');
    expect(String(init.body)).toContain('way%5B%22building%22%5D%28around%3A60');
    expect(init.headers['user-agent']).toContain('LASUATOS');
    await lookup.find(point(20, 10));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('falls back to the OpenStreetMap API when Overpass is at capacity', async () => {
    const map = { elements: [
      { type: 'node', id: 1, ...node(-5, 0) }, { type: 'node', id: 2, ...node(5, 0) },
      { type: 'node', id: 3, ...node(5, 8) }, { type: 'node', id: 4, ...node(-5, 8) },
      { type: 'way', id: 33, nodes: [1, 2, 3, 4, 1], tags: { building: 'yes', name: 'Room 1' } },
    ] };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('This Overpass API server is currently at capacity.', { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(map), { status: 200 }));
    const result = await createOverpassBuildingLookup(fetchImpl).find(point(0, 4));
    expect(result.status).toBe('ok');
    expect(result.buildings[0]).toMatchObject({ name: 'Room 1', containsPoint: true });
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toMatch(/^https:\/\/api\.openstreetmap\.org\/api\/0\.6\/map\.json\?bbox=3\.\d{7},6\.\d{7},3\.\d{7},6\.\d{7}$/);
    expect(init.method).toBe('GET');
    expect(init.headers['user-agent']).toContain('LASUATOS');
  });

  it('treats an Overpass reply without elements as no answer and tries the mirror last', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ remark: 'runtime error: Query timed out' }), { status: 200 }))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    const result = await createOverpassBuildingLookup(fetchImpl).find(point(20, 10));
    expect(result.buildings[0]!.name).toBe('Engineering Hall');
    expect(fetchImpl.mock.calls.map(([url]) => new URL(url as string).hostname)).toEqual(['overpass-api.de', 'api.openstreetmap.org', 'overpass.private.coffee']);
  });

  it('reports unavailable when no mirror answers', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('offline'));
    const lookup = createOverpassBuildingLookup(fetchImpl);
    expect(await lookup.find(point(0, 0))).toEqual({ status: 'unavailable', buildings: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // Failures are not cached: the next tap tries again.
    await lookup.find(point(0, 0));
    expect(fetchImpl).toHaveBeenCalledTimes(6);
  });
});
