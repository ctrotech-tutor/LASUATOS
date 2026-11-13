'use client';

import dynamic from 'next/dynamic';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Building2,
  Crosshair,
  Info,
  Layers,
  LoaderCircle,
  MapPin,
  Plus,
  ShieldCheck,
  ToggleLeft,
  ToggleRight,
} from 'lucide-react';
import {
  type AdminBuilding,
  type AdminCampus,
  type AdminVenue,
  type AuthAdministrator,
} from '@lasuatos/contracts';
import type { ApiFailure } from '../lib/course-api';
import { lookupAdministrator } from '../lib/current-account';
import {
  createBuilding,
  createVenue,
  loadAdminBuildings,
  loadAdminCampuses,
  loadAdminVenues,
  registerVenueLocation,
  setVenueStatus,
  updateBuilding,
  updateVenue,
} from '../lib/venue-api';
import type { VenueMapSelection } from './venue-map';
import { useFeedback } from './feedback';
import { Select } from './ui/select';
import { NumberField } from './ui/number-field';
import { ManagementSkeleton } from './ui/skeleton';
import { EditButton, EditDialog, formText } from './ui/edit-dialog';

const VenueMap = dynamic(() => import('./venue-map'), {
  ssr: false,
  loading: () => (
    <div className="venue-map venue-map-placeholder skeleton-block" role="status">
      <span className="sr-only">Preparing the map…</span>
    </div>
  ),
});

interface VenueDirectoryData {
  account: AuthAdministrator;
  campuses: AdminCampus[];
  buildings: AdminBuilding[];
  venues: AdminVenue[];
}

const defaultRadius = 80;

const venueStatusLabels: Record<AdminVenue['status'], string> = {
  pending_review: 'Pending review',
  active: 'Active',
  inactive: 'Inactive',
};

const venueTypeLabels: Record<AdminVenue['venueType'], string> = {
  lecture_theatre: 'Lecture theatre',
  classroom: 'Classroom',
  laboratory: 'Laboratory',
  hall: 'Hall',
  seminar_room: 'Seminar room',
  workshop: 'Workshop',
  outdoor: 'Outdoor space',
  other: 'Other',
};

function parseCoordinate(value: string): number | null {
  if (!value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function VenueWorkspace() {
  const dialogs = useFeedback();
  const [state, setState] = useState<{
    kind: 'loading' | 'error' | 'ready';
    data: VenueDirectoryData | null;
    error: string;
  }>({ kind: 'loading', data: null, error: '' });
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Venue creation form.
  const [venueForm, setVenueForm] = useState({
    campusId: '',
    code: '',
    name: '',
    venueType: 'lecture_theatre' as AdminVenue['venueType'],
    capacity: '',
    notes: '',
  });

  // Location registration form state.
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radius, setRadius] = useState(String(defaultRadius));
  const [accuracy, setAccuracy] = useState('');
  const [useBrowserLocation, setUseBrowserLocation] = useState(true);

  const [feedback, setFeedback] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState('');
  const [editingVenue, setEditingVenue] = useState<AdminVenue | null>(null);
  const [editingBuilding, setEditingBuilding] = useState<AdminBuilding | null>(null);
  const geolocationWatch = useRef<number | null>(null);

  const refresh = useCallback(() => {
    setReloadKey((key) => key + 1);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const session = await lookupAdministrator('manage venues');
        if (controller.signal.aborted) return;
        if (session.kind === 'error') {
          setState({ kind: 'error', data: null, error: session.message });
          return;
        }
        const [campuses, buildings, venues] = await Promise.all([
          loadAdminCampuses(controller.signal),
          loadAdminBuildings(controller.signal),
          loadAdminVenues(controller.signal),
        ]);
        setState({
          kind: 'ready',
          data: {
            account: session.account,
            campuses: campuses.campuses,
            buildings: buildings.buildings,
            venues: venues.venues,
          },
          error: '',
        });
      } catch (caught) {
        if (caught instanceof DOMException && caught.name === 'AbortError') return;
        setState({
          kind: 'error',
          data: null,
          error: caught instanceof Error
            ? caught.message
            : (caught as ApiFailure)?.message ?? 'The venue directory is temporarily unavailable.',
        });
      }
    }
    void load();
    return () => controller.abort();
  }, [reloadKey]);

  const data = state.kind === 'ready' ? state.data : null;
  const campuses = useMemo(() => data?.campuses ?? [], [data]);
  const venues = useMemo(() => data?.venues ?? [], [data]);
  const buildings = useMemo(() => data?.buildings ?? [], [data]);
  const campusNames = useMemo(() => new Map(campuses.map((campus) => [campus.id, campus.name])), [campuses]);
  const venueCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const venue of venues) if (venue.buildingId) counts.set(venue.buildingId, (counts.get(venue.buildingId) ?? 0) + 1);
    return counts;
  }, [venues]);
  const canManage = data?.account.role === 'institution_administrator';

  const selectedVenue = useMemo(
    () => venues.find((venue) => venue.id === selectedVenueId) ?? null,
    [venues, selectedVenueId],
  );

  const campusForSelection = useMemo(() => {
    if (selectedVenue) return campuses.find((campus) => campus.id === selectedVenue.campusId) ?? null;
    if (venueForm.campusId) return campuses.find((campus) => campus.id === venueForm.campusId) ?? null;
    return campuses.find((campus) => campus.latitude != null && campus.longitude != null) ?? null;
  }, [campuses, selectedVenue, venueForm.campusId]);

  const mapCenter: VenueMapSelection | null =
    campusForSelection && campusForSelection.latitude != null && campusForSelection.longitude != null
      ? { latitude: campusForSelection.latitude, longitude: campusForSelection.longitude }
      : null;

  const parsedLatitude = parseCoordinate(latitude);
  const parsedLongitude = parseCoordinate(longitude);
  const parsedRadius = radius.trim() ? Number(radius) : null;
  const mapMarker: VenueMapSelection | null =
    parsedLatitude != null && !Number.isNaN(parsedLatitude) &&
    parsedLongitude != null && !Number.isNaN(parsedLongitude)
      ? { latitude: parsedLatitude, longitude: parsedLongitude }
      : selectedVenue && selectedVenue.latitude != null && selectedVenue.longitude != null
        ? { latitude: selectedVenue.latitude, longitude: selectedVenue.longitude }
        : null;
  const mapRadius =
    parsedRadius != null && Number.isInteger(parsedRadius) && parsedRadius >= 5 && parsedRadius <= 2000
      ? parsedRadius
      : selectedVenue?.geofenceRadiusMeters ?? null;

  const isAdministratorView = state.kind === 'ready';
  const locationValid =
    parsedLatitude != null && !Number.isNaN(parsedLatitude) && Math.abs(parsedLatitude) <= 90 &&
    parsedLongitude != null && !Number.isNaN(parsedLongitude) && Math.abs(parsedLongitude) <= 180 &&
    parsedRadius != null && Number.isInteger(parsedRadius) && parsedRadius >= 5 && parsedRadius <= 2000;
  const reportedAccuracy = accuracy.trim() ? Number(accuracy) : null;

  function selectVenue(nextVenueId: string | null) {
    setSelectedVenueId(nextVenueId);
    const nextVenue = venues.find((venue) => venue.id === nextVenueId) ?? null;
    setLatitude(nextVenue && nextVenue.latitude != null ? String(nextVenue.latitude) : '');
    setLongitude(nextVenue && nextVenue.longitude != null ? String(nextVenue.longitude) : '');
    setRadius(String(nextVenue?.geofenceRadiusMeters ?? defaultRadius));
    setAccuracy('');
    setFeedback(null);
  }

  useEffect(() => {
    if (!useBrowserLocation || !selectedVenue || typeof navigator === 'undefined' || !navigator.geolocation) return;
    geolocationWatch.current = navigator.geolocation.watchPosition(
      (position) => {
        setLatitude(position.coords.latitude.toFixed(7));
        setLongitude(position.coords.longitude.toFixed(7));
        if (Number.isFinite(position.coords.accuracy) && position.coords.accuracy > 0) {
          setAccuracy(position.coords.accuracy.toFixed(1));
        }
      },
      () => {
        setUseBrowserLocation(false);
      },
      { enableHighAccuracy: true, maximumAge: 15_000 },
    );
    return () => {
      if (geolocationWatch.current != null) {
        navigator.geolocation.clearWatch(geolocationWatch.current);
        geolocationWatch.current = null;
      }
    };
  }, [useBrowserLocation, selectedVenue]);

  function reportError(caught: unknown, fallback: string) {
    const failure = caught as ApiFailure;
    const message =
      failure && typeof failure.status === 'number' && typeof failure.message === 'string'
        ? failure.status === 403
          ? 'Only institution administrators can change the venue directory. Ask an institution administrator to make this change.'
          : failure.message
        : fallback;
    setFeedback({ kind: 'error', text: message });
  }

  async function submitVenue(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    setSubmitting('venue');
    setFeedback(null);
    try {
      const created = await createVenue({
        campusId: venueForm.campusId,
        code: venueForm.code,
        name: venueForm.name,
        venueType: venueForm.venueType,
        capacity: venueForm.capacity.trim() ? Number(venueForm.capacity) : null,
        notes: venueForm.notes.trim() ? venueForm.notes.trim() : null,
      });
      setFeedback({ kind: 'success', text: `Venue ${created.venue.name} was added and is pending review.` });
      setVenueForm({ campusId: venueForm.campusId, code: '', name: '', venueType: venueForm.venueType, capacity: '', notes: '' });
      setSelectedVenueId(created.venue.id);
      refresh();
    } catch (caught) {
      reportError(caught, 'The venue could not be created. Try again.');
    } finally {
      setSubmitting('');
    }
  }

  async function submitBuilding(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !venueForm.campusId) return;
    const raw = await dialogs.prompt({
      title: 'Add a building',
      label: 'Building name',
      placeholder: 'e.g. Engineering Complex',
      confirmLabel: 'Next',
      maxLength: 160,
    });
    if (!raw?.trim()) return;
    const buildingCode = await dialogs.prompt({
      title: `Code for ${raw.trim()}`,
      label: 'Building code',
      placeholder: 'e.g. ENG-CMPX',
      confirmLabel: 'Add building',
      maxLength: 40,
    });
    if (!buildingCode?.trim()) return;
    setSubmitting('building');
    setFeedback(null);
    try {
      await createBuilding({ campusId: venueForm.campusId, code: buildingCode.trim(), name: raw.trim() });
      setFeedback({ kind: 'success', text: 'The building was added to the directory.' });
      refresh();
    } catch (caught) {
      reportError(caught, 'The building could not be added. The code may already exist for this campus.');
    } finally {
      setSubmitting('');
    }
  }

  async function submitLocation(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage || !selectedVenue || !locationValid) return;
    setSubmitting('location');
    setFeedback(null);
    try {
      await registerVenueLocation(selectedVenue.id, {
        latitude: parsedLatitude as number,
        longitude: parsedLongitude as number,
        geofenceRadiusMeters: parsedRadius as number,
        reportedAccuracyMeters: reportedAccuracy != null && Number.isFinite(reportedAccuracy) ? reportedAccuracy : null,
      });
      setFeedback({
        kind: 'success',
        text: `Location registered for ${selectedVenue.name}. Review the boundary, then activate the venue when it is correct.`,
      });
      refresh();
    } catch (caught) {
      reportError(caught, 'The venue location could not be registered. Check the values and try again.');
    } finally {
      setSubmitting('');
    }
  }

  async function toggleStatus(venue: AdminVenue, target: 'active' | 'inactive') {
    if (!canManage) return;
    setSubmitting(`status-${venue.id}`);
    setFeedback(null);
    try {
      const updated = await setVenueStatus(venue.id, target);
      setFeedback({
        kind: 'success',
        text: target === 'active'
          ? `${updated.venue.name} is now active for attendance verification.`
          : `${updated.venue.name} has been made inactive. New verification will pause for this venue.`,
      });
      refresh();
    } catch (caught) {
      reportError(caught, target === 'active'
        ? 'Register and confirm this venue’s location and geofence before activating it.'
        : 'The venue status could not be changed. Try again.');
    } finally {
      setSubmitting('');
    }
  }

  if (state.kind === 'loading') return <ManagementSkeleton label="Loading the venue directory…" rows={5} />;

  if (!isAdministratorView) {
    return (
      <section className="workspace-message" role="alert">
        <span className="workspace-message-icon" aria-hidden="true">!</span>
        <div>
          <h2>The venue directory is unavailable</h2>
          <p>{state.error || 'The venue directory is temporarily unavailable.'}</p>
          <div className="workspace-message-actions">
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                setState({ kind: 'loading', data: null, error: '' });
                refresh();
              }}
            >
              Try again
            </button>
            <Link className="button button-secondary" href="/admin">Back to administration overview</Link>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="venue-workspace">
      <div className="venue-workspace-heading">
        <Link className="text-link" href="/admin">
          <ArrowLeft size={14} aria-hidden="true" /> Administration overview
        </Link>
        <div className="admin-overview-heading venue-heading-row">
          <div>
            <p className="section-kicker">VENUES · ACADEMIC RESOURCES</p>
            <h1>Venue directory</h1>
            <p>
              Register where each venue is on campus and how large its attendance area is. A venue
              becomes available for attendance verification only after its boundary is confirmed on
              site and reviewed.
            </p>
          </div>
          <span className="admin-live-indicator"><i aria-hidden="true" />Access verified</span>
        </div>

        <div className="admin-scope-card venue-scope-card" aria-label="Venue management access">
          <div className="admin-scope-symbol"><ShieldCheck size={23} strokeWidth={1.7} aria-hidden="true" /></div>
          <div className="admin-scope-copy">
            <p className="section-kicker">{canManage ? 'VENUE ADMINISTRATION' : 'READ-ONLY ACCESS'}</p>
            <h2>{canManage ? data?.account.scope.label : data?.account.scope.label}</h2>
            <p>
              {canManage
                ? `${data?.account.institutionName} · University-wide venue management`
                : `Your role can review the venue directory. Venue boundaries and status changes are handled by institution administrators in ${data?.account.institutionName}.`}
            </p>
          </div>
          <span className="admin-role-tag">{data?.account.displayName}</span>
        </div>
      </div>

      {feedback ? (
        <p className={`venue-feedback venue-feedback-${feedback.kind}`} role="status">
          {feedback.text}
        </p>
      ) : null}

      <section className="venue-panel" aria-labelledby="venue-directory-heading">
        <div className="venue-panel-heading">
          <Layers size={16} aria-hidden="true" />
          <div>
            <h3 id="venue-directory-heading">Venues in your institution</h3>
            <p>Click a venue to register or review its location and boundary.</p>
          </div>
        </div>
        {venues.length ? (
          <ul className="venue-list">
            {venues.map((venue) => (
              <li key={venue.id}>
                <button
                  type="button"
                  className={`venue-list-item${venue.id === selectedVenueId ? ' venue-list-item-selected' : ''}`}
                  onClick={() => selectVenue(venue.id)}
                >
                  <div className="venue-list-title">
                    <strong>{venue.code}</strong>
                    <span className={`venue-status venue-status-${venue.status}`}>
                      {venueStatusLabels[venue.status]}
                    </span>
                  </div>
                  <span className="venue-list-subtitle">
                    {venue.name} · {venue.campusName}
                    {venue.buildingName ? ` · ${venue.buildingName}` : ''}
                  </span>
                  <span className="venue-list-meta">
                    {venueTypeLabels[venue.venueType]}
                    {venue.capacity ? ` · seats ${venue.capacity}` : ''}
                    {' · '}
                    {venue.latitude != null && venue.longitude != null
                      ? `boundary ${venue.geofenceRadiusMeters ?? '—'}m, registered ${venue.locationRegisteredAt ? new Date(venue.locationRegisteredAt).toLocaleString('en-NG') : ''}`
                      : 'location not registered'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="venue-empty">No venues have been added yet. Create the first venue below.</p>
        )}
      </section>

      {canManage && buildings.length ? (
        <section className="venue-panel" aria-labelledby="venue-buildings-heading">
          <div className="venue-panel-heading">
            <Building2 size={16} aria-hidden="true" />
            <div>
              <h3 id="venue-buildings-heading">Buildings</h3>
              <p>Correct a building&apos;s code or name. Venues inside it pick up the change straight away.</p>
            </div>
          </div>
          <ul className="staff-list">
            {buildings.map((building) => (
              <li key={building.id} className="staff-row">
                <div className="staff-row-main">
                  <strong>{building.name}</strong>
                  <span className="venue-list-subtitle">
                    {building.code}
                    {campusNames.get(building.campusId) ? ` · ${campusNames.get(building.campusId)}` : ''}
                    {` · ${venueCounts.get(building.id) ?? 0} venue${venueCounts.get(building.id) === 1 ? '' : 's'}`}
                  </span>
                </div>
                <div className="staff-row-actions">
                  <EditButton label={`Edit ${building.name}`} onClick={() => setEditingBuilding(building)} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {canManage ? (
        <section className="venue-panel" aria-labelledby="venue-create-heading">
          <div className="venue-panel-heading">
            <Plus size={16} aria-hidden="true" />
            <div>
              <h3 id="venue-create-heading">Add a venue</h3>
              <p>New venues start pending review and cannot accept attendance verification until you register a boundary on site.</p>
            </div>
          </div>
          <form className="venue-form" onSubmit={submitVenue}>
            <div className="venue-form-grid">
              <label>
                Campus
                <Select
                  value={venueForm.campusId}
                  required
                  placeholder="Select a campus…"
                  onValueChange={(next) => setVenueForm((form) => ({ ...form, campusId: next }))}
                  options={campuses.filter((campus) => campus.isActive).map((campus) => ({ value: campus.id, label: campus.name }))}
                />
              </label>
              <label>
                Venue code
                <input
                  value={venueForm.code}
                  onChange={(event) => setVenueForm((form) => ({ ...form, code: event.target.value.toUpperCase() }))}
                  placeholder="LT-01"
                  pattern="[A-Z0-9][A-Z0-9._\-]*"
                  data-pattern-message="Use capital letters and numbers, optionally with . _ or -, like LT-01."
                  required
                />
              </label>
              <label>
                Venue name
                <input
                  value={venueForm.name}
                  onChange={(event) => setVenueForm((form) => ({ ...form, name: event.target.value }))}
                  placeholder="Lecture Theatre 1"
                  required
                />
              </label>
              <label>
                Venue type
                <Select
                  value={venueForm.venueType}
                  onValueChange={(next) => setVenueForm((form) => ({ ...form, venueType: next as AdminVenue['venueType'] }))}
                  options={Object.entries(venueTypeLabels).map(([value, label]) => ({ value, label }))}
                />
              </label>
              <label>
                Capacity <span className="venue-field-hint">(optional)</span>
                <input
                  value={venueForm.capacity}
                  onChange={(event) => setVenueForm((form) => ({ ...form, capacity: event.target.value }))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  placeholder="400"
                />
              </label>
              <label>
                Notes <span className="venue-field-hint">(optional)</span>
                <input
                  value={venueForm.notes}
                  onChange={(event) => setVenueForm((form) => ({ ...form, notes: event.target.value }))}
                  placeholder="Access route, adjoining halls, anything examiners should know"
                />
              </label>
            </div>
            <div className="venue-form-actions">
              <button
                className="button button-primary"
                type="submit"
                disabled={submitting === 'venue'}
              >
                {submitting === 'venue' && <LoaderCircle size={14} className="venue-spin" aria-hidden="true" />}
                Add venue
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={!venueForm.campusId || submitting === 'building'}
                onClick={submitBuilding}
              >
                <Building2 size={14} aria-hidden="true" /> Add building to this campus
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="venue-panel" aria-labelledby="venue-location-heading">
        <div className="venue-panel-heading">
          <MapPin size={16} aria-hidden="true" />
          <div className="venue-panel-heading-copy">
            <h3 id="venue-location-heading">
              {selectedVenue ? `Location for ${selectedVenue.code} · ${selectedVenue.name}` : 'Venue location and boundary'}
            </h3>
            <p>
              Venue coordinates must be measured at the venue with this device, never copied from a map.
              The boundary tells the system how close a student must realistically be before attendance
              can proceed; a smaller boundary is more precise but only works where GPS is reliable.
            </p>
          </div>
          {selectedVenue && canManage ? (
            <EditButton label={`Edit ${selectedVenue.code} details`} onClick={() => setEditingVenue(selectedVenue)} />
          ) : null}
        </div>

        {selectedVenue ? (
          canManage ? (
            <form className="venue-location-grid" onSubmit={submitLocation}>
              <div className="venue-map-column">
                <VenueMap
                  center={mapCenter}
                  marker={mapMarker}
                  radiusMeters={mapRadius}
                  onPick={(selection) => {
                    setLatitude(selection.latitude.toFixed(7));
                    setLongitude(selection.longitude.toFixed(7));
                    setUseBrowserLocation(false);
                  }}
                />
                <p className="venue-map-caption">
                  Map tiles (c) OpenStreetMap contributors, used for review only. The dot is the venue
                  coordinate and the shaded circle is the boundary. Clicking the map moves the coordinate,
                  but only GPS measured at the venue should be used for real venues.
                </p>
              </div>
              <div className="venue-location-form">
                <label>
                  Latitude
                  <input
                    value={latitude}
                    onChange={(event) => { setLatitude(event.target.value); setUseBrowserLocation(false); }}
                    inputMode="decimal"
                    placeholder="6.5942550"
                    required
                  />
                </label>
                <label>
                  Longitude
                  <input
                    value={longitude}
                    onChange={(event) => { setLongitude(event.target.value); setUseBrowserLocation(false); }}
                    inputMode="decimal"
                    placeholder="3.9959480"
                    required
                  />
                </label>
                <label>
                  Boundary radius (metres)
                  <NumberField
                    value={radius}
                    onChange={(event) => setRadius(event.target.value)}
                    min={5}
                    max={2000}
                    step={1}
                    nudge={5}
                    unit="m"
                    required
                  />
                </label>
                <label>
                  Device accuracy reported (metres) <span className="venue-field-hint">(optional)</span>
                  <input
                    value={accuracy}
                    onChange={(event) => setAccuracy(event.target.value)}
                    inputMode="decimal"
                    placeholder="Recorded from your device"
                  />
                </label>
                <div className="venue-device-row">
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={typeof navigator !== 'undefined' && !navigator.geolocation}
                    onClick={() => setUseBrowserLocation(true)}
                  >
                    <Crosshair size={14} aria-hidden="true" /> Use this device’s GPS
                  </button>
                  {useBrowserLocation
                    ? <span className="venue-field-hint">Watching device location — keep steady for a few seconds.</span>
                    : (typeof navigator !== 'undefined' && !navigator.geolocation)
                      ? <span className="venue-field-hint">This device does not provide GPS. Enter coordinates manually.</span>
                      : <span className="venue-field-hint">GPS capture paused. Resume it at the venue for the most reliable reading.</span>}
                </div>
                <p className="venue-map-caption">
                  <Info size={13} aria-hidden="true" />{' '}
                  Indoors, GPS accuracy can drop significantly. If your reported accuracy is above about
                  30 metres, step near the entrance or wait with a clear sky view before registering.
                </p>
                <div className="venue-form-actions">
                  <button
                    className="button button-primary"
                    type="submit"
                    disabled={!locationValid || submitting === 'location'}
                  >
                    {submitting === 'location' && <LoaderCircle size={14} className="venue-spin" aria-hidden="true" />}
                    Register location and boundary
                  </button>
                  {selectedVenue.status !== 'active' ? (
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={
                        selectedVenue.latitude == null ||
                        submitting === `status-${selectedVenue.id}`
                      }
                      onClick={() => toggleStatus(selectedVenue, 'active')}
                    >
                      <ToggleRight size={14} aria-hidden="true" /> Activate venue
                    </button>
                  ) : (
                    <button
                      className="button button-secondary"
                      type="button"
                      disabled={submitting === `status-${selectedVenue.id}`}
                      onClick={() => toggleStatus(selectedVenue, 'inactive')}
                    >
                      <ToggleLeft size={14} aria-hidden="true" /> Deactivate venue
                    </button>
                  )}
                </div>
                {selectedVenue.status !== 'active' && selectedVenue.latitude == null ? (
                  <p className="venue-field-hint">
                    This venue cannot be activated until its location and boundary are registered and reviewed.
                  </p>
                ) : null}
              </div>
            </form>
          ) : (
            <div className="venue-location-grid">
              <div className="venue-map-column">
                <VenueMap
                  center={mapCenter}
                  marker={mapMarker}
                  radiusMeters={mapRadius}
                  onPick={() => {}}
                />
                <p className="venue-map-caption">
                  Registered boundary preview. Changes are made by institution administrators on site.
                </p>
              </div>
              <dl className="venue-detail-list">
                <div><dt>Coordinate</dt><dd>{selectedVenue.latitude != null ? `${selectedVenue.latitude.toFixed(7)}, ${selectedVenue.longitude?.toFixed(7)}` : 'Not registered'}</dd></div>
                <div><dt>Boundary radius</dt><dd>{selectedVenue.geofenceRadiusMeters ? `${selectedVenue.geofenceRadiusMeters} metres` : 'Not set'}</dd></div>
                <div><dt>Registered</dt><dd>{selectedVenue.locationRegisteredAt ? new Date(selectedVenue.locationRegisteredAt).toLocaleString('en-NG') : 'Not yet'}</dd></div>
                <div><dt>Status</dt><dd>{venueStatusLabels[selectedVenue.status]}</dd></div>
              </dl>
            </div>
          )
        ) : (
          <p className="venue-empty">Select a venue from the directory to register or review its boundary.</p>
        )}
      </section>

      {editingVenue ? (
        <EditVenueDialog
          venue={editingVenue}
          buildings={buildings.filter((building) => building.campusId === editingVenue.campusId)}
          onClose={() => setEditingVenue(null)}
          onSaved={(updated) => {
            setEditingVenue(null);
            setFeedback({ kind: 'success', text: `${updated.code} · ${updated.name} was updated.` });
            dialogs.toast('Venue details updated.');
            refresh();
          }}
        />
      ) : null}
      {editingBuilding ? (
        <EditBuildingDialog
          building={editingBuilding}
          onClose={() => setEditingBuilding(null)}
          onSaved={(updated) => {
            setEditingBuilding(null);
            setFeedback({ kind: 'success', text: `${updated.name} was updated.` });
            dialogs.toast('Building updated.');
            refresh();
          }}
        />
      ) : null}
    </div>
  );
}

function editFailure(caught: unknown, fallback: string): string {
  const failure = caught as ApiFailure;
  if (failure && typeof failure.status === 'number' && typeof failure.message === 'string') {
    return failure.status === 403
      ? 'Only institution administrators can change the venue directory.'
      : failure.message;
  }
  if (caught && typeof caught === 'object' && 'issues' in caught) return 'Check the highlighted values and try again.';
  return fallback;
}

/** Sends only the fields that changed; returns null when nothing did. */
function changedFields<T extends Record<string, unknown>>(next: T, current: Record<string, unknown>): Partial<T> | null {
  const changed = Object.fromEntries(Object.entries(next).filter(([key, value]) => value !== current[key])) as Partial<T>;
  return Object.keys(changed).length ? changed : null;
}

function EditVenueDialog({
  venue,
  buildings,
  onClose,
  onSaved,
}: Readonly<{ venue: AdminVenue; buildings: AdminBuilding[]; onClose: () => void; onSaved: (venue: AdminVenue) => void }>) {
  const [venueType, setVenueType] = useState<AdminVenue['venueType']>(venue.venueType);
  const [buildingId, setBuildingId] = useState(venue.buildingId ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(form: HTMLFormElement) {
    const capacityText = formText(form, 'capacity');
    const changes = changedFields({
      code: formText(form, 'code').toUpperCase(),
      name: formText(form, 'name').replace(/\s+/g, ' '),
      venueType,
      buildingId: buildingId || null,
      floorLabel: formText(form, 'floorLabel') || null,
      sectionLabel: formText(form, 'sectionLabel') || null,
      capacity: capacityText ? Number(capacityText) : null,
    }, venue);
    if (!changes) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await updateVenue(venue.id, changes);
      onSaved(result.venue);
    } catch (caught) {
      setError(editFailure(caught, 'The venue could not be saved. Try again.'));
      setBusy(false);
    }
  }

  return (
    <EditDialog
      title={`Edit ${venue.code}`}
      description={`${venue.campusName}. The registered location and boundary are changed in the location panel, on site.`}
      busy={busy}
      error={error}
      onClose={onClose}
      onSubmit={save}
      wide
    >
      <div className="ui-edit-row">
        <label className="account-field">
          <span>Venue code</span>
          <input name="code" defaultValue={venue.code} required maxLength={40} autoCapitalize="characters"
            pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" data-pattern-message="Use letters and numbers, optionally with . _ or -, like LT-01." />
        </label>
        <label className="account-field">
          <span>Venue name</span>
          <input name="name" defaultValue={venue.name} required maxLength={160} />
        </label>
      </div>
      <div className="ui-edit-row">
        <label className="account-field">
          <span>Venue type</span>
          <Select
            value={venueType}
            onValueChange={(next) => setVenueType(next as AdminVenue['venueType'])}
            options={Object.entries(venueTypeLabels).map(([value, label]) => ({ value, label }))}
          />
        </label>
        <label className="account-field">
          <span>Building <small>optional</small></span>
          <Select
            value={buildingId}
            onValueChange={setBuildingId}
            options={[
              { value: '', label: 'Not in a building' },
              ...buildings.map((building) => ({ value: building.id, label: building.name, description: building.code })),
            ]}
          />
        </label>
      </div>
      <div className="ui-edit-row is-three">
        <label className="account-field">
          <span>Floor <small>optional</small></span>
          <input name="floorLabel" defaultValue={venue.floorLabel ?? ''} maxLength={40} placeholder="e.g. Ground floor" />
        </label>
        <label className="account-field">
          <span>Section <small>optional</small></span>
          <input name="sectionLabel" defaultValue={venue.sectionLabel ?? ''} maxLength={80} placeholder="e.g. East wing" />
        </label>
        <label className="account-field">
          <span>Capacity <small>optional</small></span>
          <NumberField name="capacity" defaultValue={venue.capacity ?? ''} min={1} max={20000} step={1} nudge={10} placeholder="400" />
        </label>
      </div>
    </EditDialog>
  );
}

function EditBuildingDialog({
  building,
  onClose,
  onSaved,
}: Readonly<{ building: AdminBuilding; onClose: () => void; onSaved: (building: AdminBuilding) => void }>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(form: HTMLFormElement) {
    const changes = changedFields({
      code: formText(form, 'code').toUpperCase(),
      name: formText(form, 'name').replace(/\s+/g, ' '),
    }, building);
    if (!changes) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const result = await updateBuilding(building.id, changes);
      onSaved(result.building);
    } catch (caught) {
      setError(editFailure(caught, 'The building could not be saved. The code may already be used on this campus.'));
      setBusy(false);
    }
  }

  return (
    <EditDialog title={`Edit ${building.name}`} busy={busy} error={error} onClose={onClose} onSubmit={save}>
      <label className="account-field">
        <span>Building name</span>
        <input name="name" defaultValue={building.name} required maxLength={160} />
      </label>
      <label className="account-field">
        <span>Building code</span>
        <input name="code" defaultValue={building.code} required maxLength={40} autoCapitalize="characters"
          pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" data-pattern-message="Use letters and numbers, optionally with . _ or -, like ENG-CMPX." />
      </label>
    </EditDialog>
  );
}
