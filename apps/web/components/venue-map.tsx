'use client';

import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

export interface VenueMapSelection {
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * Interactive venue boundary preview using OpenStreetMap tiles via Leaflet.
 * Loaded as a client-only dynamic chunk from the venue directory page, so it
 * never ships to unrelated screens.
 *
 * The dot shows the proposed venue coordinate and the shaded circle shows the
 * proposed geofence. Clicking the map moves the coordinate; the owning form
 * keeps the numeric fields authoritative. Map tiles are (c) OpenStreetMap
 * contributors and are used for registration review only.
 */
export function VenueMap({
  center,
  marker,
  radiusMeters,
  onPick,
}: Readonly<{
  center: VenueMapSelection | null;
  marker: VenueMapSelection | null;
  radiusMeters: number | null;
  onPick: (selection: VenueMapSelection) => void;
}>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const onPickRef = useRef(onPick);
  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

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
          maxZoom: 20,
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

      const anchor = marker ?? center;
      if (anchor) {
        map.setView([anchor.latitude, anchor.longitude], Math.max(map.getZoom(), 16));
      }
      if (center) {
        leaflet.circleMarker([center.latitude, center.longitude], {
          radius: 7,
          color: '#7a8a95',
          weight: 2,
          fillColor: '#aeb9c0',
          fillOpacity: 0.7,
        }).addTo(layerGroup).bindTooltip('Campus reference point');
      }
      if (marker) {
        leaflet.circleMarker([marker.latitude, marker.longitude], {
          radius: 7,
          color: '#1d4733',
          weight: 2,
          fillColor: '#3d9460',
          fillOpacity: 0.9,
        }).addTo(layerGroup).bindTooltip('Proposed venue coordinate');
        if (radiusMeters) {
          leaflet
            .circle([marker.latitude, marker.longitude], {
              radius: radiusMeters,
              color: '#2f6b4f',
              fillColor: '#3d9460',
              fillOpacity: 0.12,
              weight: 1.5,
            })
            .addTo(layerGroup);
        }
      }
    }

    void renderLayers();
    return () => {
      cancelled = true;
    };
  }, [center, marker, radiusMeters]);

  return (
    <div
      className="venue-map"
      ref={containerRef}
      role="application"
      aria-label="Venue location map. Click the map to set the venue coordinate."
    />
  );
}

export default VenueMap;
