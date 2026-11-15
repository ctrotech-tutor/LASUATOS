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
import { Building2, Circle, Crosshair, ExternalLink, Hexagon, MousePointerClick, Plus, RotateCcw, Trash2, Undo2, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useMemo, useState, type FormEvent } from 'react';
import { locationSettingsHelp, phonePlatform, useLocationSurvey } from '../../lib/location';
import { loadBuildingOutlines, registerVenueLocation } from '../../lib/venue-api';
import { Button, SegmentedControl, Sheet } from '../ds';
import { useFeedback } from '../feedback';
import { NumberField } from '../ui/number-field';
import type { VenueMapSelection } from '../venue-map';

const VenueMap = dynamic(() => import('../venue-map'), {
  ssr: false,
  loading: () => <div className="venue-map vnu-map-loading ds-skeleton" role="status" aria-label="Preparing the map" />,
});

type ShapeMode = 'circle' | 'outline';

/** A sensible first radius for a circle: most halls fit within 25 m of their centre. */
const DEFAULT_RADIUS_METERS = 25;
/** Readings (about one a second) before a capture is worth using, unless 10 s have passed. */
const MIN_CAPTURE_SAMPLES = 5;
/** Captures vaguer than this would place the venue in the wrong building. */
const MAX_CAPTURE_ACCURACY_METERS = 60;
/** A nearby (not containing) building is offered only if the tap was this close to it. */
const NEAREST_BUILDING_METERS = 15;

function parseNumber(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

type BuildingPick =
  | { readonly kind: 'idle' }
  | { readonly kind: 'picking' }
  | { readonly kind: 'loading' }
  | { readonly kind: 'loaded'; readonly building: BuildingOutline; readonly others: readonly BuildingOutline[]; readonly previous: readonly VenueMapSelection[] }
  | { readonly kind: 'error'; readonly text: string };

function quality(accuracy: number | null): { label: string; tone: 'good' | 'fair' | 'poor' } | null {
  if (accuracy == null) return null;
  if (accuracy <= 10) return { label: 'Excellent', tone: 'good' };
  if (accuracy <= 20) return { label: 'Good', tone: 'good' };
  if (accuracy <= 35) return { label: 'Fair', tone: 'fair' };
  return { label: 'Poor', tone: 'poor' };
}

/** The boundary editor in a full-size sheet: a large map beside the controls (above them on phones). */
export function BoundarySheet({ venue, campusCenter, onClose, onSaved }: Readonly<{
  venue: AdminVenue | null;
  campusCenter: VenueMapSelection | null;
  onClose: () => void;
  onSaved: (venue: AdminVenue) => void;
}>) {
  // Keep the last venue while the sheet animates closed.
  const [last, setLast] = useState(venue);
  if (venue && venue !== last) setLast(venue);
  const shown = venue ?? last;
  return (
    <Sheet open={venue !== null} onClose={onClose} title={shown ? `${shown.code} boundary` : ''} size="full">
      {shown && venue ? <BoundaryEditor key={shown.id} venue={shown} campusCenter={campusCenter} onCancel={onClose} onSaved={onSaved} /> : null}
    </Sheet>
  );
}

function BoundaryEditor({ venue, campusCenter, onCancel, onSaved }: Readonly<{
  venue: AdminVenue;
  campusCenter: VenueMapSelection | null;
  onCancel: () => void;
  onSaved: (venue: AdminVenue) => void;
}>) {
  const feedback = useFeedback();
  const registered = venue.locationRegisteredAt != null;
  const [mode, setMode] = useState<ShapeMode>(venue.geofenceOutline || !registered ? 'outline' : 'circle');
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
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
        setBuildingPick({ kind: 'error', text: 'OpenStreetMap is busy right now. Wait a few seconds and try again, or tap the corners yourself.' });
        return;
      }
      const containing = result.buildings.filter((building) => building.containsPoint);
      const nearest = result.buildings.find((building) => !building.containsPoint && building.distanceMeters <= NEAREST_BUILDING_METERS);
      const best = containing[0] ?? nearest;
      if (!best) {
        setBuildingPick({ kind: 'error', text: 'OpenStreetMap has no building at that spot. Tap nearer the middle of the building, or tap its corners yourself.' });
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
  const centreValid = parsedLatitude != null && Math.abs(parsedLatitude) <= 90 && parsedLongitude != null && Math.abs(parsedLongitude) <= 180;
  const radiusValid = parsedRadius != null && Number.isInteger(parsedRadius) && parsedRadius >= 5 && parsedRadius <= 2000;
  const problem = corners.length >= 3 ? outlineProblem(corners) : null;
  const outlineValid = corners.length >= 3 && problem == null;
  const valid = allowanceValid && (mode === 'circle' ? centreValid && radiusValid : outlineValid);

  const outlineFacts = useMemo(() => {
    if (corners.length < 3 || outlineProblem(corners)) return null;
    const centre = outlineCentroid(corners);
    return { area: outlineAreaSquareMeters(corners), reach: outlineReachMeters(corners, centre) };
  }, [corners]);

  const circleCentre: VenueMapSelection | null = centreValid ? { latitude: parsedLatitude as number, longitude: parsedLongitude as number } : null;
  const livePoint = capturing && survey.point ? survey.point : null;
  const captureReady =
    livePoint != null &&
    livePoint.accuracyMeters <= MAX_CAPTURE_ACCURACY_METERS &&
    (survey.readings >= MIN_CAPTURE_SAMPLES || (survey.startedAt != null && survey.updatedAt - survey.startedAt >= 10_000));
  const captureQuality = quality(livePoint?.accuracyMeters ?? null);
  const suggestedAllowance = recommendedAllowanceMeters(livePoint?.accuracyMeters ?? measured.accuracy);

  function startCapture() {
    setBuildingPick((current) => (current.kind === 'picking' ? { kind: 'idle' } : current));
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
      setShapeFrame((current) => current + 1);
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

  function switchMode(next: ShapeMode) {
    setMode(next);
    setBuildingPick((current) => (current.kind === 'picking' ? { kind: 'idle' } : current));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid || saving) return;
    setCapturing(false);
    const common = { allowanceMeters: parsedAllowance as number, reportedAccuracyMeters: measured.accuracy, sampleCount: measured.samples };
    const request: RegisterVenueLocationRequest = mode === 'circle'
      ? { ...common, latitude: parsedLatitude as number, longitude: parsedLongitude as number, geofenceRadiusMeters: parsedRadius as number }
      : { ...common, outline: corners };
    setSaving(true);
    setError('');
    try {
      const result = await registerVenueLocation(venue.id, request);
      feedback.toast(venue.status === 'pending_review' ? 'Boundary saved. Activate the venue when it looks right.' : 'Boundary saved. New check-ins use it straight away.');
      onSaved(result.venue);
    } catch (caught) {
      const failure = caught as { status?: number; message?: string };
      setError(failure.status === 403 ? 'Only institution administrators can change boundaries.' : failure.message ?? 'The boundary could not be saved. Try again.');
      setSaving(false);
    }
  }

  const captureMessage = (() => {
    switch (survey.status) {
      case 'unsupported': return 'This browser can’t read GPS. Use a phone, or place the venue on the map.';
      case 'denied': return locationSettingsHelp(platform, 'denied');
      case 'unavailable': return locationSettingsHelp(platform, 'off');
      case 'waiting': return 'Waiting for GPS… keep the phone still, screen on.';
      default:
        if (livePoint && livePoint.accuracyMeters >= 1000) return locationSettingsHelp(platform, 'approximate');
        return null;
    }
  })();

  const hint = mode === 'outline'
    ? buildingPick.kind === 'picking' ? 'Tap inside the building'
      : buildingPick.kind === 'loading' ? 'Loading the building…'
        : corners.length === 0 ? 'Tap each corner of the room, in order'
          : corners.length < 3 ? `Tap corner ${corners.length + 1}`
            : 'Drag a corner to move it, or tap to add one'
    : circleCentre ? 'Tap to move the centre' : 'Tap the middle of the room';

  return (
    <form className="vnu-editor" onSubmit={(event) => void submit(event)}>
      <div className={`vnu-editor-map${buildingPick.kind === 'picking' ? ' is-picking' : ''}`}>
        <VenueMap
          className="vnu-editor-leaflet"
          label={`Map for ${venue.code}`}
          center={campusCenter}
          marker={mode === 'circle' ? livePoint ?? circleCentre : livePoint}
          radiusMeters={mode === 'circle' && radiusValid ? parsedRadius : null}
          outline={mode === 'outline' ? corners : null}
          allowanceMeters={allowanceValid ? (parsedAllowance as number) : 0}
          accuracyMeters={livePoint?.accuracyMeters ?? null}
          mode={mode === 'outline' ? 'outline' : 'point'}
          frameKey={`${venue.id}:${shapeFrame}`}
          onPick={pick}
          onMoveCorner={(index, selection) => setCorners((current) => current.map((corner, at) => (at === index ? selection : corner)))}
        >
          <p className="vnu-map-hint" aria-live="polite">
            {buildingPick.kind === 'picking' ? <MousePointerClick size={15} strokeWidth={2.2} aria-hidden="true" /> : null}
            {hint}
          </p>
        </VenueMap>
      </div>

      <div className="vnu-editor-side">
        <SegmentedControl
          label="Boundary shape"
          block
          value={mode}
          onChange={switchMode}
          segments={[
            { value: 'outline', label: 'Outline', icon: <Hexagon size={15} strokeWidth={2.2} aria-hidden="true" /> },
            { value: 'circle', label: 'Circle', icon: <Circle size={15} strokeWidth={2.2} aria-hidden="true" /> },
          ]}
        />
        <p className="vnu-fine">
          {mode === 'outline'
            ? 'Best for halls and buildings: students count as in when they are inside the walls or within the allowance of them.'
            : 'For open spaces, or when the walls can’t be traced: a centre and how far the furthest seat is from it.'}
        </p>

        {mode === 'outline' ? (
          <section className="vnu-tool" aria-label="Building shape from the map">
            <h3 className="vnu-tool-title"><Building2 size={16} strokeWidth={2.2} aria-hidden="true" /> Building from the map</h3>
            {buildingPick.kind === 'picking' ? (
              <div className="vnu-tool-row">
                <span>Now tap inside the building on the map.</span>
                <Button size="sm" variant="gray" onClick={() => setBuildingPick({ kind: 'idle' })} icon={<X size={16} aria-hidden="true" />}>Cancel</Button>
              </div>
            ) : buildingPick.kind === 'loading' ? (
              <p className="vnu-fine" role="status">Loading the building shape from OpenStreetMap…</p>
            ) : (
              <>
                {buildingPick.kind === 'loaded' ? (
                  <div className="vnu-tool-result" role="status">
                    <p>
                      <strong>{buildingPick.building.name ?? 'Building'}</strong>: {buildingPick.building.outline.length} corners,
                      ≈ {buildingPick.building.areaSquareMeters.toLocaleString('en-NG')} m²
                      {buildingPick.building.containsPoint ? '' : `, the nearest building (${Math.round(buildingPick.building.distanceMeters)} m from your tap)`}.
                      Check it lines up with the room; drag a corner to adjust.
                    </p>
                    <div className="vnu-tool-links">
                      <a href={buildingPick.building.osmUrl} target="_blank" rel="noreferrer">View on OpenStreetMap <ExternalLink size={12} aria-hidden="true" /></a>
                      {buildingPick.previous.length ? (
                        <button type="button" className="vnu-link" onClick={() => { setCorners([...buildingPick.previous]); setBuildingPick({ kind: 'idle' }); setShapeFrame((current) => current + 1); }}>Put back my corners</button>
                      ) : null}
                    </div>
                    {buildingPick.others.length ? (
                      <div className="vnu-chips">
                        <span>Also here:</span>
                        {buildingPick.others.map((other) => (
                          <button key={other.osmUrl} type="button" className="vnu-chip" onClick={() => applyBuilding(other, [buildingPick.building, ...buildingPick.others.filter((item) => item !== other)], buildingPick.previous)}>
                            {other.name ?? 'Unnamed'} · {other.areaSquareMeters.toLocaleString('en-NG')} m²
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : buildingPick.kind === 'error' ? (
                  <p className="vnu-field-error" role="alert">{buildingPick.text}</p>
                ) : (
                  <p className="vnu-fine">Buildings on OpenStreetMap are traced from aerial photos, usually to within a few metres: better than phone GPS indoors.</p>
                )}
                <Button variant="tinted" size="sm" onClick={() => { setCapturing(false); setBuildingPick({ kind: 'picking' }); }} icon={<MousePointerClick size={16} aria-hidden="true" />}>
                  {buildingPick.kind === 'loaded' ? 'Pick another building' : 'Tap the building'}
                </Button>
              </>
            )}
          </section>
        ) : null}

        {mode === 'outline' ? (
          <section className="vnu-tool" aria-label="Corners">
            <h3 className="vnu-tool-title">
              <Hexagon size={16} strokeWidth={2.2} aria-hidden="true" /> {corners.length === 1 ? '1 corner' : `${corners.length} corners`}
              <span className="vnu-tool-aside">{outlineFacts ? `≈ ${Math.round(outlineFacts.area).toLocaleString('en-NG')} m² · ${Math.round(outlineFacts.reach)} m across from the middle` : 'At least 3'}</span>
            </h3>
            {problem ? <p className="vnu-field-error" role="alert">{OUTLINE_PROBLEM_TEXT[problem]}</p> : null}
            <div className="vnu-tool-buttons">
              <Button size="sm" variant="gray" disabled={!corners.length} onClick={() => setCorners((current) => current.slice(0, -1))} icon={<Undo2 size={16} aria-hidden="true" />}>Undo</Button>
              <Button size="sm" variant="gray" disabled={!corners.length} onClick={() => setCorners([])} icon={<Trash2 size={16} aria-hidden="true" />}>Clear</Button>
              {venue.geofenceOutline ? (
                <Button size="sm" variant="gray" onClick={() => { setCorners([...(venue.geofenceOutline ?? [])]); setShapeFrame((current) => current + 1); }} icon={<RotateCcw size={16} aria-hidden="true" />}>Saved</Button>
              ) : null}
            </div>
          </section>
        ) : (
          <section className="vnu-tool" aria-label="Centre and radius">
            <h3 className="vnu-tool-title"><Circle size={16} strokeWidth={2.2} aria-hidden="true" /> Centre and size</h3>
            <div className="vnu-pair is-tight">
              <label className="account-field">
                <span>Latitude</span>
                <input value={latitude} onChange={(event) => { setLatitude(event.target.value); setMeasured({ accuracy: null, samples: null }); }} inputMode="decimal" placeholder="6.4672000" required />
              </label>
              <label className="account-field">
                <span>Longitude</span>
                <input value={longitude} onChange={(event) => { setLongitude(event.target.value); setMeasured({ accuracy: null, samples: null }); }} inputMode="decimal" placeholder="3.2004000" required />
              </label>
            </div>
            <label className="account-field">
              <span>Radius <small>centre to the furthest seat</small></span>
              <NumberField value={radius} onChange={(event) => setRadius(event.target.value)} min={5} max={2000} step={1} nudge={5} unit="m" required />
            </label>
          </section>
        )}

        <section className="vnu-tool" aria-label="GPS">
          <h3 className="vnu-tool-title">
            <Crosshair size={16} strokeWidth={2.2} aria-hidden="true" />
            {mode === 'circle' ? 'Stand in the middle' : corners.length >= 3 ? 'Add a corner by standing in it' : `Stand in corner ${corners.length + 1}`}
          </h3>
          {capturing ? (
            <>
              <div className={`vnu-meter is-${captureQuality?.tone ?? 'wait'}`} role="status" aria-live="polite">
                <strong>{livePoint ? formatAccuracy(livePoint.accuracyMeters) : '—'}</strong>
                <span>
                  {captureQuality ? `${captureQuality.label} · ` : ''}
                  {survey.readings === 1 ? '1 reading' : `${survey.readings} readings`}
                  {livePoint && livePoint.sampleCount > 1 ? ` · ${livePoint.sampleCount} averaged` : ''}
                </span>
              </div>
              {captureMessage ? <p className="vnu-fine">{captureMessage}</p> : null}
              {captureQuality?.tone === 'poor' ? <p className="vnu-fine">GPS is weak indoors. Wait 20–30 seconds, stand near a window or door, or draw on the map instead.</p> : null}
              <div className="vnu-tool-buttons">
                <Button size="sm" disabled={!captureReady || (mode === 'outline' && corners.length >= OUTLINE_MAX_POINTS)} onClick={useCapture} icon={mode === 'circle' ? <Crosshair size={16} aria-hidden="true" /> : <Plus size={16} aria-hidden="true" />}>
                  {mode === 'circle' ? 'Use this spot' : `Add corner ${corners.length + 1}`}
                </Button>
                <Button size="sm" variant="gray" onClick={() => setCapturing(false)}>Stop</Button>
              </div>
            </>
          ) : (
            <>
              <p className="vnu-fine">On site with a phone: hold it still for 10–20 seconds; readings are averaged.</p>
              <Button size="sm" variant="tinted" onClick={startCapture} icon={<Crosshair size={16} aria-hidden="true" />}>Start GPS</Button>
            </>
          )}
        </section>

        <section className="vnu-tool" aria-label="Allowance">
          <label className="account-field">
            <span>Allowance <small>how far beyond the {mode === 'circle' ? 'circle' : 'walls'} a phone may land</small></span>
            <NumberField value={allowance} onChange={(event) => setAllowance(event.target.value)} min={0} max={MAX_ALLOWANCE_METERS} step={1} nudge={5} unit="m" required />
          </label>
          <p className="vnu-fine">
            Phones indoors are often 10–30 m off; 15–25 m lets students inside check in and keeps people far outside out.
            {allowanceValid && suggestedAllowance > parsedAllowance ? (
              <> <button type="button" className="vnu-link" onClick={() => setAllowance(String(suggestedAllowance))}>Use {suggestedAllowance} m</button>, suggested from {measured.accuracy != null || livePoint ? 'your measurement' : 'typical indoor GPS'}.</>
            ) : null}
          </p>
          {measured.accuracy != null ? <p className="vnu-fine">Measured {formatAccuracy(measured.accuracy)}{measured.samples ? ` from ${measured.samples} readings` : ''}.</p> : null}
        </section>

        <div className="vnu-editor-foot">
          {error ? <p className="vnu-field-error" role="alert">{error}</p> : null}
          <div className="vnu-form-actions">
            <Button variant="gray" onClick={onCancel}>Cancel</Button>
            <Button type="submit" busy={saving} disabled={!valid}>{registered ? 'Save boundary' : 'Set location'}</Button>
          </div>
        </div>
      </div>
    </form>
  );
}
