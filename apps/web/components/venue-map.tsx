'use client';

import 'leaflet/dist/leaflet.css';
import './venue-map.css';
import { Maximize2, Minimize2 } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';

export interface VenueMapSelection {
  readonly latitude: number;
  readonly longitude: number;
}

/** A venue on the overview map: its shape, and a tappable label. */
export interface VenueMapSite {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly radiusMeters: number | null;
  readonly outline: readonly VenueMapSelection[] | null;
  readonly tone: 'active' | 'pending' | 'inactive';
}

/** Where a student's phone said it was when they checked in. */
export interface VenueMapPoint extends VenueMapSelection {
  readonly outcome: 'within' | 'outside' | 'inconclusive';
}

const SITE_COLOURS: Record<VenueMapSite['tone'], string> = { active: '#2f6b4f', pending: '#85570a', inactive: '#6b7781' };
const POINT_COLOURS: Record<VenueMapPoint['outcome'], string> = { within: '#1f6b4a', outside: '#b0281f', inconclusive: '#c98a12' };

type FullscreenDocument = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => void };
type FullscreenElement = HTMLElement & { webkitRequestFullscreen?: () => void };

function fullscreenElement(): Element | null {
  const doc = document as FullscreenDocument;
  return doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null;
}

/**
 * The real Fullscreen API where the browser has it for any element (desktop, Android, iPad);
 * otherwise (iPhone Safari) the map covers the window instead. Resolves true when the API took.
 */
async function enterFullscreen(element: FullscreenElement): Promise<boolean> {
  const doc = document as FullscreenDocument;
  try {
    if (element.requestFullscreen && doc.fullscreenEnabled !== false) {
      await element.requestFullscreen({ navigationUI: 'hide' });
      return true;
    }
    if (element.webkitRequestFullscreen && doc.webkitFullscreenEnabled) {
      element.webkitRequestFullscreen();
      return true;
    }
  } catch {
    // Refused (an iframe without permission, or no user gesture): use the overlay.
  }
  return false;
}

function exitFullscreen() {
  const doc = document as FullscreenDocument;
  if (!fullscreenElement()) return;
  if (doc.exitFullscreen) void doc.exitFullscreen().catch(() => undefined);
  else doc.webkitExitFullscreen?.();
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
  sites = null,
  selectedSiteId = null,
  onSelectSite,
  points = null,
  you = null,
  expandable = true,
  label = 'Map',
  className = '',
  children,
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
  onPick?: ((selection: VenueMapSelection) => void) | undefined;
  onMoveCorner?: ((index: number, selection: VenueMapSelection) => void) | undefined;
  /** Every venue, for the overview map; tapping one calls onSelectSite. */
  sites?: readonly VenueMapSite[] | null;
  selectedSiteId?: string | null;
  onSelectSite?: ((id: string) => void) | undefined;
  /** Check-in positions, coloured by outcome. */
  points?: readonly VenueMapPoint[] | null;
  /** The viewer's own position (testing a spot), with its accuracy ring. */
  you?: (VenueMapSelection & { readonly accuracyMeters: number }) | null;
  /** Shows the full-screen button. */
  expandable?: boolean;
  /** Names the map for screen readers and in full screen. */
  label?: string;
  className?: string;
  /** Drawn over the map (a hint, say); stays visible in full screen. */
  children?: ReactNode;
}>) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState<'no' | 'fullscreen' | 'overlay'>('no');
  const onSelectSiteRef = useRef(onSelectSite);
  const mapRef = useRef<import('leaflet').Map | null>(null);
  const layerRef = useRef<import('leaflet').LayerGroup | null>(null);
  const framedRef = useRef<string>('');
  const refitRef = useRef<(() => void) | null>(null);
  const expandRef = useRef<HTMLButtonElement | null>(null);
  const touchedRef = useRef(false);
  const onPickRef = useRef(onPick);
  const onMoveCornerRef = useRef(onMoveCorner);
  useEffect(() => {
    onPickRef.current = onPick;
    onMoveCornerRef.current = onMoveCorner;
    onSelectSiteRef.current = onSelectSite;
  }, [onPick, onMoveCorner, onSelectSite]);

  // Leave the overlay with Escape (the Fullscreen API handles its own). Escape is claimed
  // first, so a sheet holding the map stays open; the page behind must not scroll meanwhile.
  useEffect(() => {
    if (expanded !== 'overlay') return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setExpanded('no');
      expandRef.current?.focus();
    };
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      root.style.overflow = overflow;
    };
  }, [expanded]);

  useEffect(() => {
    const frame = frameRef.current;
    const onChange = () => {
      if (fullscreenElement()) return;
      setExpanded((current) => (current === 'fullscreen' ? 'no' : current));
      if (frame?.contains(document.activeElement) || document.activeElement === document.body) expandRef.current?.focus();
    };
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => {
      document.removeEventListener('fullscreenchange', onChange);
      document.removeEventListener('webkitfullscreenchange', onChange);
      if (frame && fullscreenElement() === frame) exitFullscreen();
    };
  }, []);

  async function toggleExpanded() {
    if (expanded === 'fullscreen') {
      exitFullscreen();
      return;
    }
    if (expanded === 'overlay') {
      setExpanded('no');
      return;
    }
    const frame = frameRef.current;
    if (!frame) return;
    setExpanded((await enterFullscreen(frame)) ? 'fullscreen' : 'overlay');
  }

  useEffect(() => {
    let cancelled = false;
    let mapInstance: import('leaflet').Map | null = null;
    let resizeObserver: ResizeObserver | null = null;

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
      // Any change of size (a sheet opening, full screen, a rotated phone) re-measures the map.
      if (typeof ResizeObserver !== 'undefined') {
        // Until someone pans or zooms, keep the venue framed as the map grows
        // (a sheet animating open, full screen): framing once at the first
        // size would leave it small in the middle of a big map.
        resizeObserver = new ResizeObserver(() => {
          map.invalidateSize();
          if (!touchedRef.current) refitRef.current?.();
        });
        resizeObserver.observe(containerRef.current);
      }
      const markTouched = () => { touchedRef.current = true; };
      containerRef.current.addEventListener('pointerdown', markTouched);
      containerRef.current.addEventListener('wheel', markTouched, { passive: true });
      containerRef.current.addEventListener('keydown', markTouched);
      map.on('click', (event) => {
        onPickRef.current?.({
          latitude: Number(event.latlng.lat.toFixed(7)),
          longitude: Number(event.latlng.lng.toFixed(7)),
        });
      });
    }

    void mount();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
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
      const placed = sites ?? [];
      const anchor = corners[0] ?? marker ?? placed[0] ?? center;
      const wantedFrame = `${frameKey}:${mode}`;
      if (anchor && wantedFrame !== framedRef.current) {
        framedRef.current = wantedFrame;
        touchedRef.current = false;
        const reach = Math.max(allowanceMeters ?? 0, 5);
        // Small rooms need one step past the sharpest tiles to place corners accurately.
        const editing = mode !== 'view';
        let frame: () => void;
        if (!marker && !corners.length && placed.length > 1) {
          // Whole circles and outlines, so a big field at the edge isn't cut in half.
          const bounds = leaflet.latLngBounds([]);
          for (const site of placed) {
            bounds.extend(leaflet.latLng(site.latitude, site.longitude).toBounds((site.radiusMeters ?? 10) * 2));
            for (const corner of site.outline ?? []) bounds.extend([corner.latitude, corner.longitude]);
          }
          frame = () => map.fitBounds(bounds, { maxZoom: 18, padding: [36, 36] });
        } else if (!marker && !corners.length && placed.length === 1) {
          frame = () => map.setView([anchor.latitude, anchor.longitude], 17);
        } else if (showOutline && corners.length >= 2) {
          // The allowance band is part of what a check-in can land in, so show it whole.
          const bounds = leaflet.latLngBounds([]);
          for (const corner of corners) bounds.extend(leaflet.latLng(corner.latitude, corner.longitude).toBounds(reach * 2));
          frame = () => map.fitBounds(bounds, { maxZoom: editing ? 20 : 19, padding: [24, 24] });
        } else if (marker && radiusMeters) {
          const bounds = leaflet.latLng(marker.latitude, marker.longitude).toBounds((radiusMeters + reach) * 2);
          frame = () => map.fitBounds(bounds, { maxZoom: editing ? 20 : 19, padding: [24, 24] });
        } else {
          const zoom = Math.max(map.getZoom(), marker || editing ? 18 : 16);
          frame = () => map.setView([anchor.latitude, anchor.longitude], zoom);
        }
        refitRef.current = frame;
        frame();
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

      for (const site of placed) {
        const colour = SITE_COLOURS[site.tone];
        const selected = site.id === selectedSiteId;
        const style = { color: colour, weight: selected ? 3 : 1.5, fillColor: colour, fillOpacity: selected ? 0.28 : 0.14, interactive: false };
        if (site.outline && site.outline.length >= 3) {
          leaflet.polygon(site.outline.map((corner) => [corner.latitude, corner.longitude] as [number, number]), style).addTo(layerGroup);
        } else if (site.radiusMeters) {
          leaflet.circle([site.latitude, site.longitude], { ...style, radius: site.radiusMeters }).addTo(layerGroup);
        }
        const pin = leaflet.marker([site.latitude, site.longitude], {
          keyboard: true,
          title: `${site.code}, ${site.name}`,
          alt: `${site.code}, ${site.name}`,
          riseOnHover: true,
          zIndexOffset: selected ? 1000 : 0,
          icon: leaflet.divIcon({
            className: `venue-site is-${site.tone}${selected ? ' is-selected' : ''}`,
            html: `<span>${site.code.replace(/[<>&"]/g, '')}</span>`,
            iconSize: undefined as unknown as [number, number],
            iconAnchor: [0, 0],
          }),
        }).addTo(layerGroup);
        pin.on('click', () => onSelectSiteRef.current?.(site.id));
      }

      for (const point of points ?? []) {
        leaflet.circleMarker([point.latitude, point.longitude], {
          radius: 4,
          color: '#ffffff',
          weight: 1,
          fillColor: POINT_COLOURS[point.outcome],
          fillOpacity: 0.85,
          interactive: false,
        }).addTo(layerGroup);
      }

      if (you) {
        leaflet.circle([you.latitude, you.longitude], {
          radius: you.accuracyMeters,
          color: '#153b5b',
          weight: 1.5,
          dashArray: '4 5',
          fillColor: '#153b5b',
          fillOpacity: 0.06,
          interactive: false,
        }).addTo(layerGroup);
        leaflet.circleMarker([you.latitude, you.longitude], {
          radius: 7,
          color: '#ffffff',
          weight: 2.5,
          fillColor: '#153b5b',
          fillOpacity: 1,
        }).addTo(layerGroup).bindTooltip(`You, ±${Math.round(you.accuracyMeters)} m`);
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
  }, [center, marker, radiusMeters, outline, allowanceMeters, accuracyMeters, mode, frameKey, sites, selectedSiteId, points, you]);

  const isExpanded = expanded !== 'no';
  return (
    // The mode class sits on a wrapper: Leaflet adds its own classes to the
    // map container, and React must never rewrite that element's className.
    <div
      ref={frameRef}
      className={`venue-map-frame venue-map-${mode}${expanded === 'overlay' ? ' is-overlay' : ''}${isExpanded ? ' is-expanded' : ''}${className ? ` ${className}` : ''}`}
      role={expanded === 'overlay' ? 'dialog' : undefined}
      aria-modal={expanded === 'overlay' ? true : undefined}
      aria-label={expanded === 'overlay' ? label : undefined}
    >
      <div
        className="venue-map"
        ref={containerRef}
        role="application"
        aria-label={
          mode === 'outline'
            ? `${label}. Click the map to add a corner of the hall; drag a numbered corner to move it.`
            : mode === 'point'
              ? `${label}. Click the map to set the venue centre.`
              : label
        }
      />
      {children}
      {expandable ? (
        <button
          type="button"
          ref={expandRef}
          className="venue-map-expand"
          onClick={() => void toggleExpanded()}
          aria-label={isExpanded ? 'Leave full screen' : `Show ${label.toLowerCase()} full screen`}
          title={isExpanded ? 'Leave full screen (Esc)' : 'Full screen'}
        >
          {isExpanded ? <Minimize2 size={17} strokeWidth={2.2} aria-hidden="true" /> : <Maximize2 size={17} strokeWidth={2.2} aria-hidden="true" />}
          {isExpanded ? <span>Done</span> : null}
        </button>
      ) : null}
    </div>
  );
}

export default VenueMap;
