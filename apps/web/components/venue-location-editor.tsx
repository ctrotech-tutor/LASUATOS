'use client';

import type { AdminVenue, BuildingOutline, RegisterVenueLocationRequest } from '@lasuatos/contracts';
import {
  DEFAULT_ALLOWANCE_METERS,
  MAX_ALLOWANCE_METERS,
  OUTLINE_MAX_POINTS,
  OUTLINE_PROBLEM_TEXT,
  formatAccuracy,
  outlineAreaSquareMeters,
  outlineCentroid,
  outlineProblem,
  outlineReachMeters,
  recommendedAllowanceMeters,
} from '@lasuatos/verification/venue-area';
import dynamic from 'next/dynamic';
import { Building2, Circle, Crosshair, ExternalLink, Hexagon, Info, LoaderCircle, MapPinned, MousePointerClick, Plus, RotateCcw, Square, Trash2, Undo2, X } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { locationSettingsHelp, phonePlatform, useLocationSurvey } from '../lib/location';
import { loadBuildingOutlines } from '../lib/venue-api';
import { NumberField } from './ui/number-field';
import type { VenueMapSelection } from './venue-map';

const VenueMap = dynamic(() => import('./venue-map'), {
  ssr: false,
  loading: () => (
    <div className="venue-map venue-map-placeholder skeleton-block" role="status">
      <span className="sr-only">Preparing the map…</span>
    </div>
  ),
});

type ShapeMode = 'circle' | 'outline';

/** A sensible first radius for a circle: most halls fit within 25 m of their centre. */
const DEFAULT_RADIUS_METERS = 25;

/** Readings (about one a second) before a capture is worth using, unless 10 s have passed. */
const MIN_CAPTURE_SAMPLES = 5;

/** Captures vaguer than this would place the venue in the wrong building. */
const MAX_CAPTURE_ACCURACY_METERS = 60;

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** A nearby (not containing) building is offered only if the tap was this close to it. */
const NEAREST_BUILDING_METERS = 15;

type BuildingPick =
  | { readonly kind: 'idle' }
  | { readonly kind: 'picking' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly building: BuildingOutline; readonly others: readonly BuildingOutline[]; readonly previous: readonly VenueMapSelection[] }
  | { readonly kind: 'error'; readonly text: string };

function buildingLabel(building: BuildingOutline): string {
  return building.name ? `“${building.name}”` : 'the building';
}

function quality(accuracy: number | null): { label: string; tone: 'good' | 'fair' | 'poor' } | null {
  if (accuracy == null) return null;
  if (accuracy <= 10) return { label: 'Excellent', tone: 'good' };
  if (accuracy <= 20) return { label: 'Good', tone: 'good' };
  if (accuracy <= 35) return { label: 'Fair', tone: 'fair' };
  return { label: 'Poor', tone: 'poor' };
}

export function VenueLocationEditor({
  venue,
  campusCenter,
  submitting,
  onSubmit,
  actions,
}: Readonly<{
  venue: AdminVenue;
  campusCenter: VenueMapSelection | null;
  submitting: boolean;
  onSubmit: (request: RegisterVenueLocationRequest) => void;
  actions: ReactNode;
}>) {
  const registered = venue.locationRegisteredAt != null;
  const [mode, setMode] = useState<ShapeMode>(venue.geofenceOutline ? 'outline' : 'circle');
  const [latitude, setLatitude] = useState(venue.latitude != null && !venue.geofenceOutline ? String(venue.latitude) : '');
  const [longitude, setLongitude] = useState(venue.longitude != null && !venue.geofenceOutline ? String(venue.longitude) : '');
  const [radius, setRadius] = useState(String(!venue.geofenceOutline && venue.geofenceRadiusMeters ? venue.geofenceRadiusMeters : DEFAULT_RADIUS_METERS));
  const [corners, setCorners] = useState<VenueMapSelection[]>(venue.geofenceOutline ? [...venue.geofenceOutline] : []);
  const [allowance, setAllowance] = useState(String(registered && venue.geofenceAllowanceMeters > 0 ? venue.geofenceAllowanceMeters : DEFAULT_ALLOWANCE_METERS));
  const [measured, setMeasured] = useState<{ accuracy: number | null; samples: number | null }>({
    accuracy: venue.locationAccuracyMeters,
    samples: venue.locationSampleCount,
  });
  const [capturing, setCapturing] = useState(false);
  const [captureKey, setCaptureKey] = useState(0);
  const survey = useLocationSurvey(capturing, captureKey);
  const platform = phonePlatform();
  const [buildingPick, setBuildingPick] = useState<BuildingPick>({ kind: 'idle' });
  // Bumped when a whole shape is swapped in, so the map refits to it.
  const [shapeFrame, setShapeFrame] = useState(0);
  const mapRef = useRef<HTMLDivElement>(null);

  function applyBuilding(building: BuildingOutline, others: readonly BuildingOutline[], previous: readonly VenueMapSelection[]) {
    setCorners(building.outline.map((corner) => ({ latitude: corner.latitude, longitude: corner.longitude })));
    // Traced from imagery, not measured with this phone.
    setMeasured({ accuracy: null, samples: null });
    setBuildingPick({ kind: 'loaded', building, others, previous });
    setShapeFrame((current) => current + 1);
  }

  async function pickBuilding(selection: VenueMapSelection) {
    const previous = corners;
    setBuildingPick({ kind: 'loading' });
    try {
      const result = await loadBuildingOutlines(selection.latitude, selection.longitude);
      if (result.status === 'unavailable') {
        setBuildingPick({ kind: 'error', text: 'OpenStreetMap’s servers are busy right now. Wait a few seconds and try again, or tap the corners yourself.' });
        return;
      }
      const containing = result.buildings.filter((building) => building.containsPoint);
      const nearest = result.buildings.find((building) => !building.containsPoint && building.distanceMeters <= NEAREST_BUILDING_METERS);
      const best = containing[0] ?? nearest;
      if (!best) {
        setBuildingPick({ kind: 'error', text: 'OpenStreetMap has no building shape at that spot. Tap nearer the middle of the building, or tap its corners yourself.' });
        return;
      }
      applyBuilding(best, containing.filter((building) => building !== best), previous);
    } catch {
      setBuildingPick({ kind: 'error', text: 'The building shape could not be loaded. Try again, or tap the corners yourself.' });
    }
  }

  const parsedLatitude = parseNumber(latitude);
  const parsedLongitude = parseNumber(longitude);
  const parsedRadius = parseNumber(radius);
  const parsedAllowance = parseNumber(allowance);
  const allowanceValid = parsedAllowance != null && Number.isInteger(parsedAllowance) && parsedAllowance >= 0 && parsedAllowance <= MAX_ALLOWANCE_METERS;
  const circleValid =
    parsedLatitude != null && Math.abs(parsedLatitude) <= 90 &&
    parsedLongitude != null && Math.abs(parsedLongitude) <= 180 &&
    parsedRadius != null && Number.isInteger(parsedRadius) && parsedRadius >= 5 && parsedRadius <= 2000;
  const problem = corners.length >= 3 ? outlineProblem(corners) : null;
  const outlineValid = corners.length >= 3 && problem == null;
  const valid = allowanceValid && (mode === 'circle' ? circleValid : outlineValid);

  const outlineFacts = useMemo(() => {
    if (corners.length < 3 || outlineProblem(corners)) return null;
    const centre = outlineCentroid(corners);
    return { area: outlineAreaSquareMeters(corners), reach: outlineReachMeters(corners, centre) };
  }, [corners]);

  const circleCentre: VenueMapSelection | null = parsedLatitude != null && parsedLongitude != null && circleValid
    ? { latitude: parsedLatitude, longitude: parsedLongitude }
    : null;
  const livePoint = capturing && survey.point ? survey.point : null;
  const captureReady =
    livePoint != null &&
    livePoint.accuracyMeters <= MAX_CAPTURE_ACCURACY_METERS &&
    (survey.readings >= MIN_CAPTURE_SAMPLES || (survey.startedAt != null && survey.updatedAt - survey.startedAt >= 10_000));
  const captureQuality = quality(livePoint?.accuracyMeters ?? null);
  const suggestedAllowance = recommendedAllowanceMeters(livePoint?.accuracyMeters ?? measured.accuracy);

  function startCapture() {
    setCaptureKey((key) => key + 1);
    setCapturing(true);
  }

  function useCapture() {
    const point = survey.point;
    if (!point) return;
    if (mode === 'circle') {
      setLatitude(point.latitude.toFixed(7));
      setLongitude(point.longitude.toFixed(7));
      setMeasured({ accuracy: point.accuracyMeters, samples: point.sampleCount });
      setCapturing(false);
    } else {
      setCorners((current) => (current.length >= OUTLINE_MAX_POINTS ? current : [...current, { latitude: point.latitude, longitude: point.longitude }]));
      setMeasured((current) => ({
        accuracy: current.accuracy == null ? point.accuracyMeters : Math.max(current.accuracy, point.accuracyMeters),
        samples: (current.samples ?? 0) + point.sampleCount,
      }));
      // Fresh capture for the next corner.
      setCaptureKey((key) => key + 1);
    }
  }

  function pick(selection: VenueMapSelection) {
    if (mode === 'outline' && buildingPick.kind === 'picking') {
      void pickBuilding(selection);
      return;
    }
    if (buildingPick.kind === 'loading') return;
    if (mode === 'circle') {
      setLatitude(selection.latitude.toFixed(7));
      setLongitude(selection.longitude.toFixed(7));
      setMeasured({ accuracy: null, samples: null });
    } else {
      setCorners((current) => (current.length >= OUTLINE_MAX_POINTS ? current : [...current, selection]));
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || submitting) return;
    setCapturing(false);
    const common = {
      allowanceMeters: parsedAllowance as number,
      reportedAccuracyMeters: measured.accuracy,
      sampleCount: measured.samples,
    };
    onSubmit(
      mode === 'circle'
        ? { ...common, latitude: parsedLatitude as number, longitude: parsedLongitude as number, geofenceRadiusMeters: parsedRadius as number }
        : { ...common, outline: corners },
    );
  }

  const captureMessage = (() => {
    switch (survey.status) {
      case 'unsupported':
        return 'This browser cannot read GPS. Use a phone, or place the venue on the map.';
      case 'denied':
        return locationSettingsHelp(platform, 'denied');
      case 'unavailable':
        return locationSettingsHelp(platform, 'off');
      case 'waiting':
        return 'Waiting for GPS… keep the phone still, screen on.';
      default:
        if (livePoint && livePoint.accuracyMeters >= 1000) return locationSettingsHelp(platform, 'approximate');
        return null;
    }
  })();

  return (
    <form className="venue-location-grid" onSubmit={submit}>
      <div className="venue-map-column">
        <div className="rg-segment venue-shape-toggle" role="group" aria-label="Boundary shape">
          <button type="button" className={mode === 'outline' ? 'is-selected' : ''} aria-pressed={mode === 'outline'} onClick={() => setMode('outline')}>
            <Hexagon size={14} aria-hidden="true" /> Outline the hall
          </button>
          <button type="button" className={mode === 'circle' ? 'is-selected' : ''} aria-pressed={mode === 'circle'} onClick={() => { setMode('circle'); setBuildingPick((current) => (current.kind === 'picking' ? { kind: 'idle' } : current)); }}>
            <Circle size={14} aria-hidden="true" /> Circle around a point
          </button>
        </div>
        <div ref={mapRef} className={buildingPick.kind === 'picking' ? 'venue-map-picking' : undefined}>
        <VenueMap
          center={campusCenter}
          marker={mode === 'circle' ? livePoint ?? circleCentre : livePoint}
          radiusMeters={mode === 'circle' && parsedRadius && parsedRadius >= 5 ? parsedRadius : null}
          outline={mode === 'outline' ? corners : null}
          allowanceMeters={allowanceValid ? (parsedAllowance as number) : 0}
          accuracyMeters={livePoint?.accuracyMeters ?? null}
          mode={mode === 'outline' ? 'outline' : 'point'}
          frameKey={`${venue.id}:${shapeFrame}`}
          onPick={pick}
          onMoveCorner={(index, selection) => setCorners((current) => current.map((corner, at) => (at === index ? selection : corner)))}
        />
        </div>
        <p className="venue-map-caption">
          <Info size={13} aria-hidden="true" />
          <span>
            {mode === 'outline'
              ? buildingPick.kind === 'picking'
                ? 'Tap anywhere inside the building to load its shape.'
                : 'Easiest: “Use building shape from map”, then tap the building. Or tap each corner of the hall in order around it, or stand in each corner and capture it with GPS. Drag a numbered corner to adjust it. The lighter band is the allowance.'
              : 'The dot is the centre and the darker circle the venue; the lighter ring is the allowance. Capture the centre with GPS standing in the middle of the hall, or tap the map.'}
          </span>
        </p>
      </div>

      <div className="venue-location-form">
        {mode === 'outline' ? (
          <section className={`venue-osm is-${buildingPick.kind}`} aria-label="Building shape from the map" aria-live="polite">
            <div className="venue-capture-head">
              <Building2 size={16} aria-hidden="true" />
              <strong>Use the building’s shape from the map</strong>
            </div>
            {buildingPick.kind === 'picking' ? (
              <div className="venue-osm-row">
                <MousePointerClick size={15} aria-hidden="true" />
                <span>Now tap inside the building on the map.</span>
                <button type="button" className="venue-osm-cancel" onClick={() => setBuildingPick({ kind: 'idle' })} aria-label="Cancel">
                  <X size={14} aria-hidden="true" />
                </button>
              </div>
            ) : buildingPick.kind === 'loading' ? (
              <div className="venue-osm-row"><LoaderCircle size={15} className="venue-spin" aria-hidden="true" /> <span>Loading the building shape from OpenStreetMap…</span></div>
            ) : (
              <>
                {buildingPick.kind === 'loaded' ? (
                  <div className="venue-osm-result">
                    <p>
                      Loaded {buildingLabel(buildingPick.building)}: {buildingPick.building.outline.length} corners,
                      ≈ {buildingPick.building.areaSquareMeters.toLocaleString('en-NG')} m²
                      {buildingPick.building.containsPoint ? '' : ` (the nearest building, ${Math.round(buildingPick.building.distanceMeters)} m from your tap)`}.
                      Check it lines up with the hall, drag any corner to adjust, then save.
                    </p>
                    <div className="venue-osm-links">
                      <a href={buildingPick.building.osmUrl} target="_blank" rel="noreferrer">View on OpenStreetMap <ExternalLink size={12} aria-hidden="true" /></a>
                      {buildingPick.previous.length ? (
                        <button type="button" className="venue-inline-button" onClick={() => { setCorners([...buildingPick.previous]); setBuildingPick({ kind: 'idle' }); setShapeFrame((current) => current + 1); }}>Put back my corners</button>
                      ) : null}
                    </div>
                    {buildingPick.others.length ? (
                      <div className="venue-osm-others">
                        <span>Not the right shape? Also here:</span>
                        {buildingPick.others.map((other) => (
                          <button key={other.osmUrl} type="button" className="venue-osm-chip" onClick={() => applyBuilding(other, [buildingPick.building, ...buildingPick.others.filter((item) => item !== other)], buildingPick.previous)}>
                            {other.name ?? 'Unnamed building'} · {other.areaSquareMeters.toLocaleString('en-NG')} m²
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : buildingPick.kind === 'error' ? (
                  <p className="venue-field-error">{buildingPick.text}</p>
                ) : (
                  <p className="venue-field-hint">Buildings drawn on OpenStreetMap are traced from aerial photos and are usually accurate to a few metres, better than phone GPS indoors.</p>
                )}
                <div className="venue-device-row">
                  <button type="button" className="button button-secondary" onClick={() => { setCapturing(false); setBuildingPick({ kind: 'picking' }); mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }}>
                    <MousePointerClick size={14} aria-hidden="true" /> {buildingPick.kind === 'loaded' ? 'Pick another building' : 'Use building shape from map'}
                  </button>
                </div>
              </>
            )}
          </section>
        ) : null}

        <section className="venue-capture" aria-label="GPS capture">
          <div className="venue-capture-head">
            <MapPinned size={16} aria-hidden="true" />
            <strong>{mode === 'circle' ? 'Measure the centre with GPS' : `Capture corner ${Math.min(corners.length + 1, OUTLINE_MAX_POINTS)} with GPS`}</strong>
          </div>
          {capturing ? (
            <>
              <div className={`venue-capture-meter is-${captureQuality?.tone ?? 'wait'}`} role="status" aria-live="polite">
                <span className="venue-capture-accuracy">{livePoint ? formatAccuracy(livePoint.accuracyMeters) : '—'}</span>
                <span className="venue-capture-meta">
                  {captureQuality ? `${captureQuality.label} · ` : ''}
                  {survey.readings} reading{survey.readings === 1 ? '' : 's'}
                  {livePoint && livePoint.sampleCount > 1 ? ` · ${livePoint.sampleCount} averaged` : ''}
                </span>
              </div>
              {captureMessage ? <p className="venue-field-hint">{captureMessage}</p> : null}
              {captureQuality?.tone === 'poor' ? (
                <p className="venue-field-hint">Indoors GPS is weak. Wait 20–30 seconds, stand near a window or doorway, or trace the outline on the map instead.</p>
              ) : null}
              <div className="venue-device-row">
                <button type="button" className="button button-primary" disabled={!captureReady} onClick={useCapture}>
                  {mode === 'circle' ? <Crosshair size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
                  {mode === 'circle' ? 'Use this position' : `Add as corner ${corners.length + 1}`}
                </button>
                <button type="button" className="button button-secondary" onClick={() => setCapturing(false)}>Stop</button>
              </div>
            </>
          ) : (
            <div className="venue-device-row">
              <button type="button" className="button button-secondary" onClick={startCapture}>
                <Crosshair size={14} aria-hidden="true" /> Start GPS capture
              </button>
              <span className="venue-field-hint">Hold the phone still for 10–20 seconds; readings are averaged.</span>
            </div>
          )}
        </section>

        {mode === 'circle' ? (
          <div className="venue-field-pair">
            <label>
              Latitude
              <input value={latitude} onChange={(event) => { setLatitude(event.target.value); setMeasured({ accuracy: null, samples: null }); }} inputMode="decimal" placeholder="6.4672000" required />
            </label>
            <label>
              Longitude
              <input value={longitude} onChange={(event) => { setLongitude(event.target.value); setMeasured({ accuracy: null, samples: null }); }} inputMode="decimal" placeholder="3.2004000" required />
            </label>
            <label className="venue-field-wide">
              Venue radius (metres) <span className="venue-field-hint">centre to the furthest seat</span>
              <NumberField value={radius} onChange={(event) => setRadius(event.target.value)} min={5} max={2000} step={1} nudge={5} unit="m" required />
            </label>
          </div>
        ) : (
          <div className="venue-corners">
            <div className="venue-corners-head">
              <strong>{corners.length} corner{corners.length === 1 ? '' : 's'}</strong>
              {outlineFacts ? <span>≈ {Math.round(outlineFacts.area).toLocaleString('en-NG')} m² · {Math.round(outlineFacts.reach)} m centre to furthest corner</span> : <span>At least 3 needed</span>}
            </div>
            {problem ? <p className="venue-field-error">{OUTLINE_PROBLEM_TEXT[problem]}</p> : null}
            <div className="venue-device-row">
              <button type="button" className="button button-secondary" disabled={!corners.length} onClick={() => setCorners((current) => current.slice(0, -1))}>
                <Undo2 size={14} aria-hidden="true" /> Undo last corner
              </button>
              <button type="button" className="button button-secondary" disabled={!corners.length} onClick={() => setCorners([])}>
                <Trash2 size={14} aria-hidden="true" /> Clear
              </button>
              {venue.geofenceOutline ? (
                <button type="button" className="button button-secondary" onClick={() => setCorners([...(venue.geofenceOutline ?? [])])}>
                  <RotateCcw size={14} aria-hidden="true" /> Saved outline
                </button>
              ) : null}
            </div>
          </div>
        )}

        <label>
          Allowance (metres) <span className="venue-field-hint">how far outside the {mode === 'circle' ? 'circle' : 'walls'} a phone reading may land</span>
          <NumberField value={allowance} onChange={(event) => setAllowance(event.target.value)} min={0} max={MAX_ALLOWANCE_METERS} step={1} nudge={5} unit="m" required />
        </label>
        <p className="venue-map-caption">
          <Square size={12} aria-hidden="true" />
          <span>
            Phone GPS inside buildings is usually off by 10–30 m. An allowance of 15–25 m lets students inside the hall
            check in while keeping people far outside out.
            {suggestedAllowance !== parsedAllowance ? (
              <> Suggested from your measurement: <button type="button" className="venue-inline-button" onClick={() => setAllowance(String(suggestedAllowance))}>{suggestedAllowance} m</button>.</>
            ) : null}
          </span>
        </p>

        {measured.accuracy != null ? (
          <p className="venue-field-hint">
            Measured accuracy {formatAccuracy(measured.accuracy)}{measured.samples ? ` from ${measured.samples} readings` : ''}.
          </p>
        ) : null}

        <div className="venue-form-actions">
          <button className="button button-primary" type="submit" disabled={!valid || submitting}>
            {submitting ? <LoaderCircle size={14} className="venue-spin" aria-hidden="true" /> : null}
            {registered ? 'Update location and boundary' : 'Register location and boundary'}
          </button>
          {actions}
        </div>
      </div>
    </form>
  );
}
