'use client';

import {
  VENUE_USAGE_DAYS,
  type AdminBuilding,
  type AdminCampus,
  type AdminVenue,
  type AuthAdministrator,
  type VenueUsage,
} from '@lasuatos/contracts';
import { Building2, ChevronRight, List as ListIcon, Map as MapIcon, MapPin, MapPinned, MoreHorizontal, Plus, TriangleAlert, X } from 'lucide-react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { lookupAdministrator } from '../../lib/current-account';
import { primeResource, staleResources, useResource } from '../../lib/resource';
import { loadAdminBuildings, loadAdminCampuses, loadAdminVenues } from '../../lib/venue-api';
import { Badge, Button, EmptyState, Menu, PageHeader, SegmentedControl, Sheet, Stat, Stats } from '../ds';
import { GuideButton } from '../shell/guide-button';
import { useClock } from '../take-attendance/hooks';
import { SearchField } from '../ui/search-field';
import { Select } from '../ui/select';
import type { VenueMapSite } from '../venue-map';
import { BoundarySheet } from './boundary-editor';
import {
  concernsOf,
  concernText,
  countVenues,
  findBySlug,
  isLocated,
  matchesQuery,
  matchesShow,
  PATH,
  percent,
  readView,
  SEARCH_FROM,
  sortVenues,
  STATUS_LABEL,
  STATUS_TONE,
  totalUsage,
  usageFacts,
  usageLine,
  venueSlug,
  VENUES_KEY,
  viewHref,
  type Concern,
  type Show,
  type View,
} from './format';
import { useWide } from './hooks';
import { AddVenueSheet, BuildingsSheet, EditVenueDialog } from './venue-forms';
import { VenueDetail } from './venue-detail';
import './venues.css';

const VenueMap = dynamic(() => import('../venue-map'), {
  ssr: false,
  loading: () => <div className="venue-map vnu-map-loading ds-skeleton" role="status" aria-label="Preparing the map" />,
});

export type Directory = {
  readonly account: AuthAdministrator;
  readonly campuses: readonly AdminCampus[];
  readonly buildings: readonly AdminBuilding[];
  readonly venues: readonly AdminVenue[];
  readonly usage: readonly VenueUsage[];
};

export type Answer = { readonly kind: 'ok'; readonly data: Directory } | { readonly kind: 'denied'; readonly message: string };

/** The API throws plain `{ status, message }` objects; the cache wants an Error to show. */
async function load(signal: AbortSignal): Promise<Answer> {
  const session = await lookupAdministrator('manage venues');
  if (session.kind === 'error') return { kind: 'denied', message: session.message };
  try {
    const [campuses, buildings, venues] = await Promise.all([loadAdminCampuses(signal), loadAdminBuildings(signal), loadAdminVenues(signal)]);
    return {
      kind: 'ok',
      data: { account: session.account, campuses: campuses.campuses, buildings: buildings.buildings, venues: venues.venues, usage: venues.usage },
    };
  } catch (caught) {
    if (caught instanceof DOMException) throw caught;
    const failure = caught as { status?: number; message?: string };
    if (failure.status === 403) return { kind: 'denied', message: failure.message ?? 'Your account can’t see venues.' };
    throw new Error(failure.message ?? 'Venues did not load. Try again.');
  }
}

/**
 * Venues: where each lecture room is, the boundary check-ins are measured against, and how
 * check-ins there have gone lately. Institution administrators add venues and set boundaries;
 * other administrators can look.
 */
export function Venues() {
  const resource = useResource(VENUES_KEY, load, { maxAge: 30_000 });
  const answer = resource.data;
  if (answer?.kind === 'denied') {
    return (
      <div className="vnu">
        <PageHeader title="Venues" />
        <div className="ds-card">
          <EmptyState
            icon={<MapPinned size={26} strokeWidth={1.9} />}
            title="Administrators look after venues"
            message={answer.message}
            action={<Button href="/" variant="tinted">Go home</Button>}
          />
        </div>
      </div>
    );
  }
  if (!answer) {
    return (
      <div className="vnu">
        <Header />
        {resource.error ? (
          <div className="ds-card">
            <EmptyState error title="Venues did not load" message={resource.error} action={<Button variant="tinted" onClick={resource.reload}>Try again</Button>} />
          </div>
        ) : <PageSkeleton />}
      </div>
    );
  }
  return <Directory data={answer.data} reload={resource.reload} />;
}

function Header({ subtitle, onAdd, onBuildings }: Readonly<{ subtitle?: string | undefined; onAdd?: (() => void) | undefined; onBuildings?: (() => void) | undefined }>) {
  return (
    <PageHeader
      title="Venues"
      subtitle={subtitle}
      actions={(
        <div className="vnu-head-actions">
          {onAdd ? (
            <>
              <Button className="vnu-add-wide" onClick={onAdd} icon={<Plus size={18} strokeWidth={2.2} aria-hidden="true" />}>Add venue</Button>
              <button className="ds-icon-btn is-filled vnu-add-narrow" type="button" aria-label="Add venue" data-tip="Add venue" onClick={onAdd}>
                <Plus size={18} strokeWidth={2.2} aria-hidden="true" />
              </button>
            </>
          ) : null}
          {onBuildings ? (
            <Menu
              label="More venue actions"
              icon={<MoreHorizontal size={18} strokeWidth={2.2} aria-hidden="true" />}
              items={[{ label: 'Buildings', icon: <Building2 size={18} aria-hidden="true" />, onSelect: onBuildings }]}
            />
          ) : null}
          <GuideButton page={PATH} label="Venues" />
        </div>
      )}
    />
  );
}

type Sheets =
  | { readonly kind: 'none' }
  | { readonly kind: 'add' }
  | { readonly kind: 'buildings' }
  | { readonly kind: 'details'; readonly venueId: string }
  | { readonly kind: 'boundary'; readonly venueId: string };

function Directory({ data, reload }: Readonly<{ data: Directory; reload: () => void }>) {
  const router = useRouter();
  const pathname = usePathname() ?? PATH;
  const params = useSearchParams();
  const view = readView(params);
  const wide = useWide();
  const now = useClock('fifteen');
  const [query, setQuery] = useState('');
  const [phoneView, setPhoneView] = useState<'list' | 'map'>('list');
  const [sheet, setSheet] = useState<Sheets>({ kind: 'none' });
  const canManage = data.account.role === 'institution_administrator';

  const usageById = useMemo(() => new Map(data.usage.map((item) => [item.venueId, item])), [data.usage]);
  const concerns = useMemo(() => new Map(data.venues.map((venue) => [venue.id, concernsOf(venue, usageFacts(usageById.get(venue.id)))])), [data.venues, usageById]);
  const campusesInUse = useMemo(() => data.campuses.filter((campus) => data.venues.some((venue) => venue.campusId === campus.id)), [data.campuses, data.venues]);
  const campus = view.campus ? campusesInUse.find((item) => item.code.toLowerCase() === view.campus) ?? null : null;
  const inCampus = useMemo(() => (campus ? data.venues.filter((venue) => venue.campusId === campus.id) : data.venues), [data.venues, campus]);
  const counts = useMemo(() => countVenues(inCampus, concerns), [inCampus, concerns]);
  const totals = useMemo(() => totalUsage(data.usage, new Set(inCampus.map((venue) => venue.id))), [data.usage, inCampus]);
  const shown = useMemo(
    () => sortVenues(inCampus.filter((venue) => matchesShow(view.show, venue, concerns.get(venue.id) ?? []) && matchesQuery(venue, query))),
    [inCampus, view.show, concerns, query],
  );
  const selected = findBySlug(view.venue, data.venues, data.campuses);

  function go(next: Partial<View>) {
    router.replace(viewHref(pathname, { ...view, ...next }), { scroll: false });
  }
  const open = (venue: AdminVenue | null) => go({ venue: venue ? venueSlug(venue, data.venues, data.campuses) : null });

  // A link to a venue that no longer exists (or another institution's) quietly drops it.
  useEffect(() => {
    if (view.venue && !selected) router.replace(viewHref(pathname, { ...view, venue: null }), { scroll: false });
  }, [view, selected, router, pathname]);

  /** Shows a change at once, then asks the server for the full picture. */
  function patch(change: (current: Directory) => Directory) {
    primeResource(VENUES_KEY, { kind: 'ok', data: change(data) } satisfies Answer);
    staleResources('venues:evidence:');
    reload();
  }
  const replaceVenue = (venue: AdminVenue) => patch((current) => ({ ...current, venues: current.venues.map((item) => (item.id === venue.id ? venue : item)) }));

  const sites = useMemo<VenueMapSite[]>(() => shown.filter(isLocated).map((venue) => ({
    id: venue.id,
    code: venue.code,
    name: venue.name,
    latitude: venue.latitude,
    longitude: venue.longitude,
    radiusMeters: venue.geofenceRadiusMeters,
    outline: venue.geofenceOutline,
    tone: venue.status === 'active' ? 'active' : venue.status === 'pending_review' ? 'pending' : 'inactive',
  })), [shown]);
  const mapCampus = campus ?? campusesInUse.find((item) => item.latitude != null) ?? data.campuses.find((item) => item.latitude != null) ?? null;
  const campusCenter = (venue: AdminVenue | null) => {
    const own = venue ? data.campuses.find((item) => item.id === venue.campusId) : mapCampus;
    return own?.latitude != null && own.longitude != null ? { latitude: own.latitude, longitude: own.longitude } : null;
  };

  const showSegments: Show[] = [
    'all',
    ...(counts.attention > 0 || view.show === 'attention' ? ['attention' as const] : []),
    ...(counts.pending > 0 || view.show === 'pending' ? ['pending' as const] : []),
    ...(counts.inactive > 0 || view.show === 'inactive' ? ['inactive' as const] : []),
  ];
  const segmentLabel: Record<Show, string> = { all: 'All', attention: 'Needs attention', active: 'Active', pending: 'Not active yet', inactive: 'Inactive' };
  const shortSegmentLabel: Record<Show, string> = { all: 'All', attention: 'Attention', active: 'Active', pending: 'Not active', inactive: 'Inactive' };
  const segmentCount: Record<Show, number> = { all: counts.total, attention: counts.attention, active: counts.active, pending: counts.pending, inactive: counts.inactive };
  const subtitle = data.venues.length
    ? [campus?.name ?? (campusesInUse.length === 1 ? campusesInUse[0]!.name : null), `${counts.active} of ${counts.total} active`].filter(Boolean).join(' · ')
    : undefined;

  const detailFor = (venue: AdminVenue, inSheet: boolean) => (
    <VenueDetail
      key={venue.id}
      venue={venue}
      usage={usageById.get(venue.id)}
      concerns={concerns.get(venue.id) ?? []}
      canManage={canManage}
      campusCenter={campusCenter(venue)}
      now={now}
      inSheet={inSheet}
      onEditBoundary={() => setSheet({ kind: 'boundary', venueId: venue.id })}
      onEditDetails={() => setSheet({ kind: 'details', venueId: venue.id })}
      onChanged={replaceVenue}
    />
  );

  const editing = sheet.kind === 'details' || sheet.kind === 'boundary' ? data.venues.find((venue) => venue.id === sheet.venueId) ?? null : null;
  const overview = (
    <OverviewMap
      sites={sites}
      selectedId={selected?.id ?? null}
      center={campusCenter(null)}
      frameKey={`${view.show}:${view.campus ?? ''}:${query}`}
      unlocated={shown.filter((venue) => !isLocated(venue)).length}
      onSelect={(id) => open(data.venues.find((venue) => venue.id === id) ?? null)}
    />
  );

  return (
    <div className="vnu">
      <Header
        subtitle={subtitle}
        onAdd={canManage && data.campuses.length ? () => setSheet({ kind: 'add' }) : undefined}
        onBuildings={canManage && data.campuses.length ? () => setSheet({ kind: 'buildings' }) : undefined}
      />

      {data.venues.length === 0 ? (
        <div className="ds-card">
          <EmptyState
            icon={<MapPinned size={26} strokeWidth={1.9} />}
            title={data.campuses.length ? 'No venues yet' : 'No campus yet'}
            message={data.campuses.length
              ? 'Add the lecture rooms students attend. Draw each one on the map so check-ins there can be confirmed.'
              : 'Venues belong to a campus, and none is set up for your institution yet. Contact LASUATOS support to add one.'}
            action={canManage && data.campuses.length ? <Button onClick={() => setSheet({ kind: 'add' })}>Add the first venue</Button> : undefined}
          />
        </div>
      ) : (
        <>
          <Stats label="Venues at a glance">
            <Stat label="Active" value={counts.active} hint={`of ${counts.total} venue${counts.total === 1 ? '' : 's'}`} tone={counts.active > 0 ? 'success' : undefined} />
            <Stat
              label="Need attention"
              value={counts.attention}
              hint={counts.unlocated ? `${counts.unlocated} without a location` : counts.attention ? 'boundary or check-ins' : 'all look right'}
              tone={counts.attention > 0 ? 'warning' : 'success'}
            />
            <Stat label="Classes held" value={totals.sessions.toLocaleString('en-NG')} hint={totals.openSessions ? `${totals.openSessions} open now` : `in ${VENUE_USAGE_DAYS} days`} />
            <Stat
              label="Landed inside"
              value={totals.insideShare == null ? '—' : percent(totals.insideShare)}
              hint={totals.readings ? `of ${totals.readings.toLocaleString('en-NG')} check-ins` : 'no check-ins yet'}
            />
          </Stats>

          <div className="vnu-tools">
            {showSegments.length > 1 ? (
              <SegmentedControl
                label="Show"
                value={view.show}
                onChange={(show) => go({ show })}
                segments={showSegments.map((value) => ({
                  value,
                  label: value === 'all' ? 'All' : (
                    <>
                      <span className="vnu-long">{segmentLabel[value]}</span>
                      <span className="vnu-short">{shortSegmentLabel[value]}</span>
                      <span className="vnu-count">{segmentCount[value]}</span>
                    </>
                  ),
                }))}
              />
            ) : null}
            {data.venues.length >= SEARCH_FROM ? (
              <SearchField className="vnu-find" value={query} onValueChange={setQuery} placeholder="Code, name or building" aria-label="Find a venue" />
            ) : null}
            {campusesInUse.length > 1 ? (
              <label className="vnu-campus">
                <span className="sr-only">Campus</span>
                <Select
                  value={campus ? campus.code.toLowerCase() : 'all'}
                  onValueChange={(value) => go({ campus: value === 'all' ? null : value, venue: null })}
                  options={[
                    { value: 'all', label: 'All campuses', description: `${campusesInUse.length} campuses` },
                    ...campusesInUse.map((item) => ({ value: item.code.toLowerCase(), label: item.name })),
                  ]}
                />
              </label>
            ) : null}
            {!wide ? (
              <div className="vnu-phone-view">
                <SegmentedControl
                  label="View"
                  value={phoneView}
                  onChange={setPhoneView}
                  segments={[
                    { value: 'list', label: 'List', icon: <ListIcon size={15} strokeWidth={2.2} aria-hidden="true" /> },
                    { value: 'map', label: 'Map', icon: <MapIcon size={15} strokeWidth={2.2} aria-hidden="true" /> },
                  ]}
                />
              </div>
            ) : null}
          </div>

          <div className={`vnu-split${wide ? ' is-wide' : ''}`}>
            {wide || phoneView === 'list' ? (
              <section className="vnu-list-col" aria-label="Venues">
                {shown.length === 0 ? (
                  <p className="vnu-quiet" role="status">
                    {query.trim() ? `No venue matches “${query.trim()}”.` : view.show === 'attention' ? 'Nothing needs attention. Every venue looks right.' : 'No venues here.'}
                  </p>
                ) : (
                  <ul className="ds-list vnu-list">
                    {shown.map((venue) => (
                      <VenueRow
                        key={venue.id}
                        venue={venue}
                        concerns={concerns.get(venue.id) ?? []}
                        line={usageLine(usageFacts(usageById.get(venue.id)))}
                        selected={wide && venue.id === selected?.id}
                        showCampus={campusesInUse.length > 1 && !campus}
                        onOpen={() => open(venue)}
                      />
                    ))}
                  </ul>
                )}
              </section>
            ) : (
              <div className="vnu-phone-map">{overview}</div>
            )}

            {wide ? (
              <aside className="vnu-pane" aria-label={selected ? `${selected.code}, ${selected.name}` : 'Map of venues'}>
                {selected ? (
                  <div className="vnu-pane-card">
                    <button className="ds-sheet-close vnu-pane-close" type="button" onClick={() => open(null)} aria-label="Close venue">
                      <X size={16} strokeWidth={2.4} aria-hidden="true" />
                    </button>
                    {detailFor(selected, false)}
                  </div>
                ) : overview}
              </aside>
            ) : null}
          </div>
        </>
      )}

      {!wide ? <PhoneVenueSheet venue={selected} onClose={() => open(null)} render={(venue) => detailFor(venue, true)} /> : null}

      <AddVenueSheet
        open={sheet.kind === 'add'}
        campuses={data.campuses}
        buildings={data.buildings}
        defaultCampusId={campus?.id ?? (data.campuses.length === 1 ? data.campuses[0]!.id : null)}
        onClose={() => setSheet({ kind: 'none' })}
        onCreated={(venue) => {
          setSheet({ kind: 'none' });
          patch((current) => ({ ...current, venues: [...current.venues.filter((item) => item.id !== venue.id), venue] }));
          // Show the new venue; its first job is a location.
          router.replace(viewHref(pathname, { show: 'all', campus: view.campus, venue: venueSlug(venue, [...data.venues, venue], data.campuses) }), { scroll: false });
        }}
        onBuildingCreated={(building) => patch((current) => ({ ...current, buildings: [...current.buildings, building] }))}
      />
      <BuildingsSheet
        open={sheet.kind === 'buildings'}
        campuses={data.campuses}
        buildings={data.buildings}
        venues={data.venues}
        onClose={() => setSheet({ kind: 'none' })}
        onSaved={(building) => patch((current) => ({
          ...current,
          buildings: [...current.buildings.filter((item) => item.id !== building.id), building],
          // Venues show their building's name: refresh it in place.
          venues: current.venues.map((venue) => (venue.buildingId === building.id ? { ...venue, buildingName: building.name } : venue)),
        }))}
      />
      {sheet.kind === 'details' && editing ? (
        <EditVenueDialog
          venue={editing}
          buildings={data.buildings.filter((building) => building.campusId === editing.campusId)}
          onClose={() => setSheet({ kind: 'none' })}
          onSaved={(venue) => {
            setSheet({ kind: 'none' });
            replaceVenue(venue);
            // A new code changes the address.
            if (venue.code !== editing.code) {
              router.replace(viewHref(pathname, { ...view, venue: venueSlug(venue, data.venues.map((item) => (item.id === venue.id ? venue : item)), data.campuses) }), { scroll: false });
            }
          }}
        />
      ) : null}
      <BoundarySheet
        venue={sheet.kind === 'boundary' ? editing : null}
        campusCenter={campusCenter(editing)}
        onClose={() => setSheet({ kind: 'none' })}
        onSaved={(venue) => {
          setSheet({ kind: 'none' });
          replaceVenue(venue);
        }}
      />
    </div>
  );
}

function OverviewMap({ sites, selectedId, center, frameKey, unlocated, onSelect }: Readonly<{
  sites: readonly VenueMapSite[];
  selectedId: string | null;
  center: { latitude: number; longitude: number } | null;
  frameKey: string;
  unlocated: number;
  onSelect: (id: string) => void;
}>) {
  return (
    <div className="vnu-overview">
      <VenueMap
        className="vnu-overview-map"
        label="Map of venues"
        center={center}
        marker={null}
        radiusMeters={null}
        mode="view"
        frameKey={`overview:${frameKey}`}
        sites={sites}
        selectedSiteId={selectedId}
        onSelectSite={onSelect}
      />
      <div className="vnu-legend" aria-label="Map key">
        <span><i className="is-active" aria-hidden="true" />Active</span>
        <span><i className="is-pending" aria-hidden="true" />Not active yet</span>
        <span><i className="is-inactive" aria-hidden="true" />Inactive</span>
        {unlocated ? <span className="vnu-legend-note"><MapPin size={13} aria-hidden="true" />{unlocated} not on the map yet</span> : null}
      </div>
    </div>
  );
}

function VenueRow({ venue, concerns, line, selected, showCampus, onOpen }: Readonly<{
  venue: AdminVenue;
  concerns: readonly Concern[];
  line: string;
  selected: boolean;
  showCampus: boolean;
  onOpen: () => void;
}>) {
  const first = concerns[0];
  const warning = first ? concernText(first) : null;
  const place = [venue.buildingName, showCampus || !venue.buildingName ? venue.campusName : null].filter(Boolean).join(' · ');
  return (
    <li>
      <button className={`ds-row vnu-row${selected ? ' is-selected' : ''}`} type="button" onClick={onOpen} aria-current={selected ? 'true' : undefined}>
        <span className={`vnu-glyph is-${venue.status}${isLocated(venue) ? '' : ' is-unlocated'}`} aria-hidden="true">
          <MapPin size={18} strokeWidth={2.2} />
        </span>
        <span className="ds-row-body">
          <span className="ds-row-title vnu-row-title">
            <span className="vnu-code">{venue.code}</span>
            <span className="vnu-ellipsis">{venue.name}</span>
          </span>
          {place ? <span className="ds-row-subtitle vnu-ellipsis">{place}</span> : null}
          {warning || venue.status !== 'active' ? (
            <span className={`ds-row-subtitle vnu-row-note${warning ? ` is-${warning.tone}` : ''}`}>
              {venue.status !== 'active' ? <Badge tone={STATUS_TONE[venue.status]}>{STATUS_LABEL[venue.status]}</Badge> : null}
              {warning?.tone === 'warning' ? <TriangleAlert size={13} strokeWidth={2.4} aria-hidden="true" /> : null}
              {warning ? <span className="vnu-ellipsis">{warning.title}</span> : null}
            </span>
          ) : <span className="ds-row-subtitle vnu-row-note">{line}</span>}
        </span>
        <ChevronRight className="ds-row-chevron" size={18} strokeWidth={2.2} aria-hidden="true" />
      </button>
    </li>
  );
}

function PhoneVenueSheet({ venue, onClose, render }: Readonly<{ venue: AdminVenue | null; onClose: () => void; render: (venue: AdminVenue) => ReactNode }>) {
  // Keep the last venue while the sheet animates closed.
  const [last, setLast] = useState(venue);
  if (venue && venue !== last) setLast(venue);
  const shown = venue ?? last;
  return (
    <Sheet open={venue !== null} onClose={onClose} title={shown ? shown.code : ''} size="wide">
      {shown ? render(shown) : null}
    </Sheet>
  );
}

function PageSkeleton() {
  return (
    <div role="status" aria-label="Loading venues">
      <div className="ds-stats" aria-hidden="true">
        {[1, 2, 3, 4].map((key) => <div className="ds-stat" key={key}><span className="ds-skeleton" style={{ width: '60%', height: 14 }} /><span className="ds-skeleton" style={{ width: '40%', height: 28, marginTop: 8 }} /></div>)}
      </div>
      <ul className="ds-list vnu-list" aria-hidden="true" style={{ marginTop: 20 }}>
        {[58, 44, 66, 50, 40].map((width) => (
          <li key={width}>
            <div className="ds-row vnu-row">
              <span className="vnu-glyph ds-skeleton" />
              <span className="ds-row-body">
                <span className="ds-skeleton" style={{ width: `${width}%`, height: 16 }} />
                <span className="ds-skeleton" style={{ width: `${width - 16}%`, height: 13, marginTop: 6 }} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
