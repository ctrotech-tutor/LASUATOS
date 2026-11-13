import { describe, expect, it, vi } from 'vitest';
import { createOverpassBuildingLookup, parseBuildingOutlines } from './building-outlines.js';

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
const annex = closed([node(60, 0), node(80, 0), node(80, 15), node(60, 15)]);
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

describe('OpenStreetMap building outlines', () => {
  it('puts the smallest building containing the tap first, then the nearest others', () => {
    const tap = point(0, 4);
    const buildings = parseBuildingOutlines(payload, tap);
    expect(buildings.map((b) => b.name)).toEqual(['Room 1', 'Engineering Hall', 'Complex', null]);
    expect(buildings[0]).toMatchObject({ containsPoint: true, distanceMeters: 0, osmUrl: 'https://www.openstreetmap.org/way/33' });
    expect(buildings[3]).toMatchObject({ containsPoint: false });
    expect(buildings[3]!.distanceMeters).toBeGreaterThan(55);
    expect(buildings[2]!.osmUrl).toBe('https://www.openstreetmap.org/relation/55');
  });

  it('keeps every real corner of the hall', () => {
    const [hall] = parseBuildingOutlines(payload, point(20, 10));
    expect(hall!.name).toBe('Engineering Hall');
    expect(hall!.outline).toHaveLength(12);
    expect(hall!.areaSquareMeters).toBeGreaterThan(2000);
  });

  it('ignores junk', () => {
    expect(parseBuildingOutlines(null, point(0, 0))).toEqual([]);
    expect(parseBuildingOutlines({ elements: 'x' }, point(0, 0))).toEqual([]);
  });

  it('asks Overpass, falls back to the mirror, and caches the answer', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response('busy', { status: 429 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));
    const lookup = createOverpassBuildingLookup(fetchImpl);
    const first = await lookup.find(point(20, 10));
    expect(first.status).toBe('ok');
    expect(first.buildings[0]!.name).toBe('Engineering Hall');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(url).toContain('overpass');
    expect(String(init.body)).toContain('way%5B%22building%22%5D%28around%3A60');
    expect(init.headers['user-agent']).toContain('LASUATOS');
    await lookup.find(point(20, 10));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reports unavailable when no mirror answers', async () => {
    const lookup = createOverpassBuildingLookup(vi.fn().mockRejectedValue(new Error('offline')));
    expect(await lookup.find(point(0, 0))).toEqual({ status: 'unavailable', buildings: [] });
  });
});
