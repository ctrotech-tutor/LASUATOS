'use client';

import { VENUE_USAGE_DAYS, type AdminVenue, type VenueEvidence, type VenueUsage } from '@lasuatos/contracts';
import { formatAccuracy } from '@lasuatos/verification/venue-area';
import { Crosshair, LocateFixed, MapPinned, MoreHorizontal, Pencil, Power, PowerOff, Shapes, TriangleAlert } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useCallback, useState } from 'react';
import { locationSettingsHelp, phonePlatform, requestLocationSample } from '../../lib/location';
import { useResource } from '../../lib/resource';
import { loadVenueEvidence, setVenueStatus } from '../../lib/venue-api';
import { Badge, Button, Menu } from '../ds';
import { useFeedback } from '../feedback';
import { shortDate, whenLabel } from '../staff/format';
import {
  areaSquareMeters,
  changeDetail,
  changeTitle,
  classes,
  concernText,
  evidenceKey,
  isLocated,
  kindLine,
  percent,
  placeLine,
  shapeLabel,
  spotVerdict,
  STATUS_LABEL,
  STATUS_TONE,
  usageFacts,
  venueArea,
  type Concern,
  type SpotVerdict,
} from './format';

const VenueMap = dynamic(() => import('../venue-map'), {
  ssr: false,
  loading: () => <div className="venue-map vnu-map-loading ds-skeleton" role="status" aria-label="Preparing the map" />,
});

function fixKind(concern: Concern): string {
  if (concern.kind === 'no_location' || concern.kind === 'ready_to_activate' || concern.kind === 'often_by_hand') return concern.kind;
  return 'boundary';
}

type Spot =
  | { readonly kind: 'idle' }
  | { readonly kind: 'locating' }
  | { readonly kind: 'failed'; readonly text: string }
  | { readonly kind: 'done'; readonly verdict: SpotVerdict; readonly you: { latitude: number; longitude: number; accuracyMeters: number } };

/** One venue: what to fix, its map and boundary, and how check-ins there have gone. */
export function VenueDetail({ venue, usage, concerns, canManage, campusCenter, now, inSheet, onEditBoundary, onEditDetails, onChanged }: Readonly<{
  venue: AdminVenue;
  usage: VenueUsage | undefined;
  concerns: readonly Concern[];
  canManage: boolean;
  campusCenter: { latitude: number; longitude: number } | null;
  now: number;
  inSheet: boolean;
  onEditBoundary: () => void;
  onEditDetails: () => void;
  onChanged: (venue: AdminVenue) => void;
}>) {
  const feedback = useFeedback();
  const loadEvidence = useCallback((signal: AbortSignal) => loadVenueEvidence(venue.id, signal), [venue.id]);
  const evidence = useResource(evidenceKey(venue.id), loadEvidence, { maxAge: 60_000 });
  const [showPoints, setShowPoints] = useState(true);
  const [spot, setSpot] = useState<Spot>({ kind: 'idle' });
  const [busy, setBusy] = useState(false);
  const facts = usageFacts(usage);
  const located = isLocated(venue);
  const area = venueArea(venue);
  const points = evidence.data?.points ?? [];

  async function testSpot() {
    if (!area) return;
    setSpot({ kind: 'locating' });
    const reading = await requestLocationSample({ maxWaitMilliseconds: 15_000, goodEnoughMeters: 15 });
    if (!reading) {
      setSpot({ kind: 'failed', text: locationSettingsHelp(phonePlatform(), 'denied') });
      return;
    }
    const verdict = spotVerdict(area, {
      latitude: reading.latitude,
      longitude: reading.longitude,
      accuracyMeters: reading.accuracyMeters,
      ageMilliseconds: Date.now() - Date.parse(reading.capturedAt),
    });
    setSpot({ kind: 'done', verdict, you: { latitude: reading.latitude, longitude: reading.longitude, accuracyMeters: reading.accuracyMeters ?? 0 } });
  }

  async function changeStatus(target: 'active' | 'inactive') {
    if (target === 'inactive') {
      const sure = await feedback.confirm({
        title: `Make ${venue.code} inactive?`,
        body: 'Lecturers can no longer pick it when they open attendance. Past attendance and its boundary are kept, and you can activate it again.',
        confirmLabel: 'Make inactive',
        tone: 'danger',
      });
      if (!sure) return;
    }
    setBusy(true);
    try {
      const result = await setVenueStatus(venue.id, target);
      onChanged(result.venue);
      feedback.toast(target === 'active' ? `${venue.code} is active. Lecturers can pick it now.` : `${venue.code} is inactive.`);
    } catch (caught) {
      const failure = caught as { message?: string };
      feedback.toast(failure.message ?? 'The venue could not be changed. Try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  const fixFor = (concern: Concern) => {
    if (!canManage && concern.kind !== 'often_by_hand') return null;
    switch (concern.kind) {
      case 'no_location': return <Button size="sm" onClick={onEditBoundary} icon={<Shapes size={16} aria-hidden="true" />}>Set location</Button>;
      case 'ready_to_activate': return <Button size="sm" busy={busy} onClick={() => void changeStatus('active')} icon={<Power size={16} aria-hidden="true" />}>Activate</Button>;
      case 'often_by_hand': return located ? <Button size="sm" variant="tinted" onClick={() => void testSpot()} icon={<Crosshair size={16} aria-hidden="true" />}>Test this spot</Button> : null;
      default: return <Button size="sm" variant="tinted" onClick={onEditBoundary} icon={<Shapes size={16} aria-hidden="true" />}>Edit boundary</Button>;
    }
  };

  return (
    <div className={`vnu-detail${inSheet ? ' is-sheet' : ''}`}>
      <header className="vnu-detail-head">
        <div className="vnu-detail-tags">
          {inSheet ? null : <span className="vnu-code is-large">{venue.code}</span>}
          <Badge tone={STATUS_TONE[venue.status]} dot>{STATUS_LABEL[venue.status]}</Badge>
          {facts.openSessions ? <Badge tone="tint">{facts.openSessions === 1 ? 'Class open now' : `${facts.openSessions} classes open now`}</Badge> : null}
        </div>
        <h2 className="vnu-detail-title">{venue.name}</h2>
        <p className="vnu-detail-sub">{[placeLine(venue), kindLine(venue)].filter(Boolean).join(' · ')}</p>
      </header>

      {concerns.length ? (
        <ul className="vnu-concerns" aria-label="Needs attention">
          {concerns.map((concern, index) => {
            const text = concernText(concern);
            // One button per kind of fix: two boundary problems share one Edit boundary.
            const kind = fixKind(concern);
            const fix = concerns.slice(0, index).some((earlier) => fixKind(earlier) === kind) ? null : fixFor(concern);
            return (
              <li key={concern.kind} className={`vnu-concern is-${text.tone}`}>
                {text.tone === 'warning' ? <TriangleAlert className="vnu-concern-icon" size={18} strokeWidth={2.2} aria-hidden="true" /> : <MapPinned className="vnu-concern-icon" size={18} strokeWidth={2.2} aria-hidden="true" />}
                <div className="vnu-concern-text">
                  <strong>{text.title}</strong>
                  <span>{text.detail}</span>
                </div>
                {fix ? <div className="vnu-concern-fix">{fix}</div> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="vnu-actions">
        {canManage ? (
          <Button variant={located ? 'gray' : 'filled'} onClick={onEditBoundary} icon={<Shapes size={18} aria-hidden="true" />}>
            {located ? 'Edit boundary' : 'Set location'}
          </Button>
        ) : null}
        {located ? (
          <Button variant="gray" busy={spot.kind === 'locating'} onClick={() => void testSpot()} icon={<Crosshair size={18} aria-hidden="true" />}>
            Test this spot
          </Button>
        ) : null}
        {canManage && venue.status === 'inactive' && located ? (
          <Button variant="gray" busy={busy} onClick={() => void changeStatus('active')} icon={<Power size={18} aria-hidden="true" />}>Activate again</Button>
        ) : null}
        {canManage ? (
          <Menu
            label={`More actions for ${venue.code}`}
            title={`${venue.code} · ${venue.name}`}
            icon={<MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" />}
            items={[
              { label: 'Edit details and notes', icon: <Pencil size={18} aria-hidden="true" />, onSelect: onEditDetails },
              venue.status === 'active' ? { label: 'Make inactive', icon: <PowerOff size={18} aria-hidden="true" />, destructive: true, onSelect: () => void changeStatus('inactive') } : null,
            ]}
          />
        ) : null}
      </div>

      {spot.kind === 'locating' ? <p className="vnu-spot is-waiting" role="status"><LocateFixed size={18} aria-hidden="true" /> Finding where you are… hold the phone still.</p> : null}
      {spot.kind === 'failed' ? <p className="vnu-spot is-warning" role="alert"><LocateFixed size={18} aria-hidden="true" /> <span><strong>Location is off or blocked.</strong> {spot.text}</span></p> : null}
      {spot.kind === 'done' ? (
        <div className={`vnu-spot is-${spot.verdict.tone}`} role="status">
          <LocateFixed size={18} aria-hidden="true" />
          <span><strong>{spot.verdict.title}.</strong> {spot.verdict.detail}</span>
        </div>
      ) : null}

      {located ? (
        <section className="vnu-block" aria-label="Map">
          <VenueMap
            className="vnu-detail-map"
            label={`Map of ${venue.code}`}
            center={campusCenter}
            marker={{ latitude: venue.latitude, longitude: venue.longitude }}
            radiusMeters={venue.geofenceOutline ? null : venue.geofenceRadiusMeters}
            outline={venue.geofenceOutline}
            allowanceMeters={venue.geofenceAllowanceMeters}
            mode="view"
            frameKey={venue.id + (venue.locationRegisteredAt ?? '')}
            points={showPoints ? points : null}
            you={spot.kind === 'done' ? spot.you : null}
          />
          <div className="vnu-map-foot">
            <span className="vnu-key"><i className="is-area" aria-hidden="true" />Boundary</span>
            {venue.geofenceAllowanceMeters > 0 ? <span className="vnu-key"><i className="is-allowance" aria-hidden="true" />{venue.geofenceAllowanceMeters} m allowance</span> : null}
            {points.length ? (
              <label className="vnu-switch">
                <input type="checkbox" checked={showPoints} onChange={(event) => setShowPoints(event.target.checked)} />
                <span>Check-ins ({points.length.toLocaleString('en-NG')})</span>
              </label>
            ) : null}
          </div>
          {points.length && showPoints ? (
            <div className="vnu-map-foot is-points" aria-label="Check-in colours">
              <span className="vnu-key"><i className="is-dot is-within" aria-hidden="true" />Inside</span>
              <span className="vnu-key"><i className="is-dot is-outside" aria-hidden="true" />Outside</span>
              <span className="vnu-key"><i className="is-dot is-inconclusive" aria-hidden="true" />Unclear</span>
            </div>
          ) : null}
        </section>
      ) : (
        <div className="vnu-nomap">
          <MapPinned size={24} strokeWidth={1.9} aria-hidden="true" />
          <strong>Not on the map yet</strong>
          <span>{canManage ? 'Set its location: tap the building on the map, trace the room, or stand in it with your phone.' : 'An institution administrator sets its location.'}</span>
        </div>
      )}

      <section className="vnu-block" aria-labelledby={`vnu-usage-${venue.id}`}>
        <h3 className="vnu-block-title" id={`vnu-usage-${venue.id}`}>Last {VENUE_USAGE_DAYS} days</h3>
        {facts.sessions ? (
          <>
            <div className="vnu-figures">
              <div><strong>{facts.sessions.toLocaleString('en-NG')}</strong><span>{facts.sessions === 1 ? 'class' : 'classes'}</span></div>
              <div><strong>{facts.present.toLocaleString('en-NG')}</strong><span>marked present</span></div>
              <div><strong>{facts.insideShare == null ? '—' : percent(facts.insideShare)}</strong><span>landed inside</span></div>
            </div>
            {facts.present ? <OutcomeBar facts={facts} /> : null}
            <p className="vnu-fine">Last class {whenLabel(facts.lastSessionAt, now).replace(/^(Today|Yesterday|Just now)/, (word) => word.toLowerCase())}. Check-ins turned away for being outside aren’t recorded.</p>
          </>
        ) : <p className="vnu-fine">No classes here in the last {VENUE_USAGE_DAYS} days.</p>}
      </section>

      <Evidence evidence={evidence.data} error={evidence.error} loading={evidence.loading} now={now} canManage={canManage} />

      {located ? (
        <section className="vnu-block" aria-labelledby={`vnu-boundary-${venue.id}`}>
          <h3 className="vnu-block-title" id={`vnu-boundary-${venue.id}`}>Boundary</h3>
          <dl className="vnu-facts">
            <div><dt>Shape</dt><dd>{shapeLabel(venue)}</dd></div>
            <div><dt>Allowance</dt><dd>{venue.geofenceAllowanceMeters ? `${venue.geofenceAllowanceMeters} m beyond the ${venue.geofenceOutline ? 'walls' : 'circle'}` : 'None'}</dd></div>
            <div><dt>Area</dt><dd>≈ {(areaSquareMeters(venue) ?? 0).toLocaleString('en-NG')} m²</dd></div>
            <div><dt>Measured</dt><dd>{venue.locationAccuracyMeters != null ? `${formatAccuracy(venue.locationAccuracyMeters)}${venue.locationSampleCount ? ` from ${venue.locationSampleCount} readings` : ''}` : 'Drawn on the map'}</dd></div>
            <div><dt>Set</dt><dd>{venue.locationRegisteredAt ? `${shortDate(venue.locationRegisteredAt, now)}${venue.locationRegisteredByName ? ` by ${venue.locationRegisteredByName}` : ''}` : '—'}</dd></div>
          </dl>
        </section>
      ) : null}

      <section className="vnu-block" aria-labelledby={`vnu-notes-${venue.id}`}>
        <div className="vnu-block-head">
          <h3 className="vnu-block-title" id={`vnu-notes-${venue.id}`}>Notes</h3>
          {canManage ? <Button size="sm" variant="plain" onClick={onEditDetails}>{venue.notes ? 'Edit' : 'Add'}</Button> : null}
        </div>
        <p className={venue.notes ? 'vnu-notes' : 'vnu-fine'}>{venue.notes ?? 'No notes. Add how to get in, or which rooms share a wall.'}</p>
      </section>
    </div>
  );
}

function OutcomeBar({ facts }: Readonly<{ facts: ReturnType<typeof usageFacts> }>) {
  const parts = [
    { key: 'inside', label: 'Inside', count: facts.inside },
    { key: 'outside', label: 'Outside', count: facts.outside },
    { key: 'unclear', label: 'Unclear', count: facts.unclear },
    { key: 'none', label: 'No location', count: facts.noReading },
    { key: 'hand', label: 'Added by hand', count: facts.handAdded },
  ].filter((part) => part.count > 0);
  return (
    <div className="vnu-outcomes">
      <div className="vnu-bar" aria-hidden="true">
        {parts.map((part) => <span key={part.key} className={`is-${part.key}`} style={{ flexGrow: part.count }} />)}
      </div>
      <ul className="vnu-bar-key">
        {parts.map((part) => (
          <li key={part.key}><i className={`is-${part.key}`} aria-hidden="true" />{part.label} <strong>{part.count.toLocaleString('en-NG')}</strong></li>
        ))}
      </ul>
    </div>
  );
}

function Evidence({ evidence, error, loading, now, canManage }: Readonly<{ evidence: VenueEvidence | undefined; error: string | undefined; loading: boolean; now: number; canManage: boolean }>) {
  if (!evidence) {
    if (loading) return <div className="vnu-block" role="status" aria-label="Loading courses and history"><span className="ds-skeleton" style={{ width: '50%', height: 16 }} /><span className="ds-skeleton" style={{ width: '80%', height: 13, marginTop: 10 }} /></div>;
    return error ? <p className="vnu-fine" role="alert">Courses and history did not load: {error}</p> : null;
  }
  return (
    <>
      {evidence.courses.length ? (
        <section className="vnu-block" aria-label="Courses here">
          <h3 className="vnu-block-title">Courses here</h3>
          <ul className="vnu-rows">
            {evidence.courses.map((course) => (
              <li key={course.courseCode}>
                <span className="vnu-rows-main"><span className="vnu-code">{course.courseCode}</span> <span className="vnu-ellipsis">{course.courseTitle}</span></span>
                <span className="vnu-rows-aside">{classes(course.sessions)} · {shortDate(course.lastAt, now)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {!evidence.pointsShown && !canManage ? <p className="vnu-fine">Where phones checked in is shown to institution administrators only.</p> : null}
      {evidence.history.length ? (
        <section className="vnu-block" aria-label="Location history">
          <h3 className="vnu-block-title">Location history</h3>
          <ol className="vnu-rows vnu-history">
            {evidence.history.map((change, index) => (
              <li key={`${change.at}-${index}`}>
                <span className="vnu-rows-main">
                  <strong>{changeTitle(change)}</strong>
                  <span className="vnu-fine">{[changeDetail(change), change.actorName].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="vnu-rows-aside">{shortDate(change.at, now)}</span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}
    </>
  );
}
