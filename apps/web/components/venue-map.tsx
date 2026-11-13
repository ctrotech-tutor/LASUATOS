'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export interface VenueMapSelection {
  readonly latitude: number;
  readonly longitude: number;
}

const METERS_PER_DEGREE = 111_195;

/** Points `meters` around a corner, for drawing the allowance band. */
function ring(center: VenueMapSelection, meters: number, steps = 20): [number, number][] {
  const cos = Math.cos((center.latitude * Math.PI) / 180) || 1e-9;
  return Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    return [
      center.latitude + (Math.sin(angle) * meters) / METERS_PER_DEGREE,
      center.longitude + (Math.cos(angle) * meters) / (METERS_PER_DEGREE * cos),
    ];
  });
}

/** Counter-clockwise version of a ring (x = longitude, y = latitude). */
function counterClockwise(points: [number, number][]): [number, number][] {
  let twiceArea = 0;
  points.forEach(([lat, lng], index) => {
    const [nextLat, nextLng] = points[(index + 1) % points.length] as [number, number];
    twiceArea += lng * nextLat - nextLng * lat;
  });
  return twiceArea < 0 ? [...points].reverse() : points;
}

/**
 * The outline grown by `meters` (its allowance), drawn as the union of a band
 * along each wall and a disc at each corner. All pieces wind the same way and
 * are filled with the nonzero rule, so overlaps do not darken.
 */
function allowanceBand(outline: readonly VenueMapSelection[], meters: number): [number, number][][] {
  if (meters <= 0 || outline.length < 2) return [];
  // The shape itself plus a disc at each corner and a band along each wall.
  const pieces: [number, number][][] = [
    outline.map((corner) => [corner.latitude, corner.longitude] as [number, number]),
    ...outline.map((corner) => ring(corner, meters)),
  ];
  outline.forEach((from, index) => {
    const to = outline[(index + 1) % outline.length] as VenueMapSelection;
    const cos = Math.cos((from.latitude * Math.PI) / 180) || 1e-9;
    const dx = (to.longitude - from.longitude) * METERS_PER_DEGREE * cos;
    const dy = (to.latitude - from.latitude) * METERS_PER_DEGREE;
    const length = Math.hypot(dx, dy);
    if (length === 0) return;
    // Unit normal, scaled to the allowance, in degrees.
    const nLat = ((-dx / length) * meters) / METERS_PER_DEGREE;
    const nLng = ((dy / length) * meters) / (METERS_PER_DEGREE * cos);
    pieces.push([
      [from.latitude - nLat, from.longitude - nLng],
      [to.latitude - nLat, to.longitude - nLng],
      [to.latitude + nLat, to.longitude + nLng],
      [from.latitude + nLat, from.longitude + nLng],
    ]);
  });
  // Nonzero filling only unites pieces that wind the same way.
  return pieces.map(counterClockwise);
}

/**
 * Venue boundary preview and editor on OpenStreetMap tiles (Leaflet). Loaded
 * as a client-only chunk from the venue directory page.
 *
 * Point mode: the dot is the venue centre and the shaded circle its radius;
 * clicking moves the centre. Outline mode: numbered corners trace the hall;
 * clicking adds a corner, dragging moves one. The lighter band around either
 * shape is the allowance (how far outside a phone reading may land and still
 * count), and a dashed ring shows the accuracy of the GPS capture.
 */
export function VenueMap({
  center,
  marker,
  radiusMeters,
  outline = null,
  allowanceMeters = 0,
  accuracyMeters = null,
  mode = 'point',
  frameKey = '',
  onPick,
  onMoveCorner,
}: Readonly<{
  center: VenueMapSelection | null;
  marker: VenueMapSelection | null;
  radiusMeters: number | null;
  outline?: readonly VenueMapSelection[] | null;
  allowanceMeters?: number;
  accuracyMeters?: number | null;
  mode?: 'point' | 'outline' | 'view';
  /** The map re-frames only when this (the venue) or the mode changes, never while editing. */
  frameKey?: string;
  onPick: (selection: VenueMapSelection) => void;
  onMoveCorner?: ((index: number, selection: VenueMapSelection) => void) | undefined;
}>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const framedRef = useRef<string>('');
  const onPickRef = useRef(onPick);
  const onMoveCornerRef = useRef(onMoveCorner);
  useEffect(() => {
    onPickRef.current = onPick;
    onMoveCornerRef.current = onMoveCorner;
  }, [onPick, onMoveCorner]);

  useEffect(() => {
    let cancelled = false;
    let mapInstance: import('leaflet').Map | null = null;

    async function mount() {
      const leaflet = await import('leaflet');
      if (cancelled || !containerRef.current || mapRef.current) return;

      const initialCenter: [number, number] = center
        ? [center.latitude, center.longitude]
        : [9.082, 8.6753]; // Neutral Nigeria viewport; venues recenter on their campus anchor.
      const map = leaflet.map(containerRef.current, {
        center: initialCenter,
        zoom: center ? 17 : 6,
        scrollWheelZoom: true,
      });
      mapInstance = map;
      mapRef.current = map;
      layerRef.current = leaflet.layerGroup().addTo(map);
      leaflet
        .tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 21,
          maxNativeZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
        })
        .addTo(map);
      map.on('click', (event) => {
        onPickRef.current({
          latitude: Number(event.latlng.lat.toFixed(7)),
          longitude: Number(event.latlng.lng.toFixed(7)),
        });
      });
    }

    void mount();
    return () => {
      cancelled = true;
      mapInstance?.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
    // The map mounts once; the initial viewport only matters at mount time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function renderLayers() {
      const leaflet = await import('leaflet');
      const map = mapRef.current;
      const layerGroup = layerRef.current;
      if (cancelled || !map || !layerGroup) return;
      layerGroup.clearLayers();

      const corners = outline ?? [];
      const showOutline = mode === 'outline' || (mode === 'view' && corners.length >= 3);

      // Frame the map when the venue or mode changes, never while corners
      // are being placed (a jump there would put the next tap in the wrong spot).
      const anchor = corners[0] ?? marker ?? center;
      const wantedFrame = `${frameKey}:${mode}`;
      if (anchor && wantedFrame !== framedRef.current) {
        framedRef.current = wantedFrame;
        if (showOutline && corners.length >= 2) {
          map.fitBounds(leaflet.latLngBounds(corners.map((corner) => [corner.latitude, corner.longitude])), { maxZoom: 19, padding: [40, 40] });
        } else {
          map.setView([anchor.latitude, anchor.longitude], Math.max(map.getZoom(), marker ? 18 : 16));
        }
      }

      if (center) {
        leaflet.circleMarker([center.latitude, center.longitude], {
          radius: 6,
          color: '#7a8a95',
          weight: 2,
          fillColor: '#aeb9c0',
          fillOpacity: 0.7,
        }).addTo(layerGroup).bindTooltip('Campus reference point');
      }

      if (showOutline) {
        if (corners.length >= 3 && allowanceMeters > 0) {
          leaflet.polygon(allowanceBand(corners, allowanceMeters), {
            stroke: false,
            fillColor: '#3d9460',
            fillOpacity: 0.1,
            fillRule: 'nonzero',
            interactive: false,
          }).addTo(layerGroup);
        }
        if (corners.length >= 2) {
          const path = corners.map((corner) => [corner.latitude, corner.longitude] as [number, number]);
          (corners.length >= 3
            ? leaflet.polygon(path, { color: '#2f6b4f', weight: 2, fillColor: '#3d9460', fillOpacity: 0.22, interactive: false })
            : leaflet.polyline(path, { color: '#2f6b4f', weight: 2, dashArray: '5 5', interactive: false })
          ).addTo(layerGroup);
        }
        corners.forEach((corner, index) => {
          const editable = mode === 'outline';
          const pin = leaflet.marker([corner.latitude, corner.longitude], {
            draggable: editable,
            keyboard: editable,
            title: `Corner ${index + 1}`,
            icon: leaflet.divIcon({
              className: 'venue-corner',
              html: `<span>${index + 1}</span>`,
              iconSize: [24, 24],
              iconAnchor: [12, 12],
            }),
          }).addTo(layerGroup);
          if (editable) {
            pin.on('dragend', () => {
              const moved = pin.getLatLng();
              onMoveCornerRef.current?.(index, { latitude: Number(moved.lat.toFixed(7)), longitude: Number(moved.lng.toFixed(7)) });
            });
          }
        });
        if (marker && mode === 'outline') {
          leaflet.circleMarker([marker.latitude, marker.longitude], {
            radius: 6,
            color: '#ffffff',
            weight: 2,
            fillColor: '#153b5b',
            fillOpacity: 1,
          }).addTo(layerGroup).bindTooltip('Your GPS position');
        }
      } else if (marker) {
        if (radiusMeters) {
          if (allowanceMeters > 0) {
            leaflet.circle([marker.latitude, marker.longitude], {
              radius: radiusMeters + allowanceMeters,
              stroke: false,
              fillColor: '#3d9460',
              fillOpacity: 0.1,
              interactive: false,
            }).addTo(layerGroup);
          }
          leaflet.circle([marker.latitude, marker.longitude], {
            radius: radiusMeters,
            color: '#2f6b4f',
            fillColor: '#3d9460',
            fillOpacity: 0.18,
            weight: 1.5,
            interactive: false,
          }).addTo(layerGroup);
        }
        leaflet.circleMarker([marker.latitude, marker.longitude], {
          radius: 7,
          color: '#1d4733',
          weight: 2,
          fillColor: '#3d9460',
          fillOpacity: 0.9,
        }).addTo(layerGroup).bindTooltip('Venue centre');
      }

      if (marker && accuracyMeters && accuracyMeters > 0 && mode !== 'view') {
        leaflet.circle([marker.latitude, marker.longitude], {
          radius: accuracyMeters,
          color: '#153b5b',
          weight: 1.5,
          dashArray: '4 5',
          fill: false,
          interactive: false,
        }).addTo(layerGroup).bindTooltip(`GPS accuracy ±${Math.round(accuracyMeters)} m`);
      }
    }

    void renderLayers();
    return () => {
      cancelled = true;
    };
  }, [center, marker, radiusMeters, outline, allowanceMeters, accuracyMeters, mode, frameKey]);

  return (
    // The mode class sits on a wrapper: Leaflet adds its own classes to the
    // map container, and React must never rewrite that element's className.
    <div className={`venue-map-frame venue-map-${mode}`}>
      <div
        className="venue-map"
        ref={containerRef}
        role="application"
        aria-label={
          mode === 'outline'
            ? 'Venue map. Click the map to add a corner of the hall; drag a numbered corner to move it.'
            : mode === 'point'
              ? 'Venue map. Click the map to set the venue centre.'
              : 'Venue boundary map.'
        }
      />
    </div>
  );
}

export default VenueMap;
