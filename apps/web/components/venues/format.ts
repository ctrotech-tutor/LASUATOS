import {
  VENUE_USAGE_DAYS,
  type AdminCampus,
  type AdminVenue,
  type VenueLocationChange,
  type VenueUsage,
} from '@lasuatos/contracts';
import {
  evaluatePresence,
  formatAccuracy,
  formatMeters,
  outlineAreaSquareMeters,
  type PresenceReading,
  type VenueArea,
} from '@lasuatos/verification/venue-area';

export const PATH = '/admin/venues';
/** Cache key for the directory (venues, buildings, campuses, usage and the viewer). */
export const VENUES_KEY = 'venues:directory';
export const evidenceKey = (venueId: string) => `venues:evidence:${venueId}`;

/** Search appears once there are this many venues. */
export const SEARCH_FROM = 6;

export type VenueStatus = AdminVenue['status'];
export type VenueType = AdminVenue['venueType'];

export const STATUS_LABEL: Record<VenueStatus, string> = {
  active: 'Active',
  pending_review: 'Not active yet',
  inactive: 'Inactive',
};

export const STATUS_TONE: Record<VenueStatus, 'success' | 'warning' | 'neutral'> = {
  active: 'success',
  pending_review: 'warning',
  inactive: 'neutral',
};

export const TYPE_LABEL: Record<VenueType, string> = {
  lecture_theatre: 'Lecture theatre',
  classroom: 'Classroom',
  laboratory: 'Laboratory',
  hall: 'Hall',
  seminar_room: 'Seminar room',
  workshop: 'Workshop',
  outdoor: 'Outdoor space',
  other: 'Other',
};

export const TYPE_OPTIONS = (Object.entries(TYPE_LABEL) as [VenueType, string][]).map(([value, label]) => ({ value, label }));

export function isLocated(venue: AdminVenue): venue is AdminVenue & { latitude: number; longitude: number } {
  return venue.latitude != null && venue.longitude != null;
}

/** The boundary check-ins are measured against, or null before a location is set. */
export function venueArea(venue: AdminVenue): VenueArea | null {
  if (!isLocated(venue)) return null;
  if (venue.geofenceOutline && venue.geofenceOutline.length >= 3) {
    return { shape: { kind: 'outline', points: venue.geofenceOutline }, allowanceMeters: venue.geofenceAllowanceMeters };
  }
  if (!venue.geofenceRadiusMeters) return null;
  return {
    shape: { kind: 'circle', center: { latitude: venue.latitude, longitude: venue.longitude }, radiusMeters: venue.geofenceRadiusMeters },
    allowanceMeters: venue.geofenceAllowanceMeters,
  };
}

/** "Outline, 6 corners" or "25 m circle"; "No location" before one is set. */
export function shapeLabel(venue: AdminVenue): string {
  if (!isLocated(venue)) return 'No location';
  if (venue.geofenceOutline) return `Outline, ${venue.geofenceOutline.length} corners`;
  return `${venue.geofenceRadiusMeters ?? '?'} m circle`;
}

/** "Outline, 6 corners + 15 m" for a row; just the shape when there is no allowance. */
export function boundaryLine(venue: AdminVenue): string {
  const shape = shapeLabel(venue);
  if (!isLocated(venue) || venue.geofenceAllowanceMeters === 0) return shape;
  return `${shape} + ${venue.geofenceAllowanceMeters} m`;
}

/** Roughly how much ground the boundary covers, in m², without its allowance. */
export function areaSquareMeters(venue: AdminVenue): number | null {
  if (!isLocated(venue)) return null;
  if (venue.geofenceOutline && venue.geofenceOutline.length >= 3) return Math.round(outlineAreaSquareMeters(venue.geofenceOutline));
  if (venue.geofenceRadiusMeters) return Math.round(Math.PI * venue.geofenceRadiusMeters ** 2);
  return null;
}

/** "Engineering Complex · Ojo", plus floor and section when known. */
export function placeLine(venue: AdminVenue): string {
  return [venue.buildingName, venue.floorLabel, venue.sectionLabel, venue.campusName].filter(Boolean).join(' · ');
}

/** "Lecture theatre · 450 seats". */
export function kindLine(venue: AdminVenue): string {
  return [TYPE_LABEL[venue.venueType], venue.capacity ? `${venue.capacity.toLocaleString('en-NG')} seats` : null].filter(Boolean).join(' · ');
}

/* ---------- usage ---------- */

export const NO_USAGE: Omit<VenueUsage, 'venueId'> = {
  sessions: 0, openSessions: 0, lastSessionAt: null, checkIns: 0, inside: 0, outside: 0, unclear: 0, noReading: 0, handAdded: 0,
};

export type UsageFacts = {
  readonly sessions: number;
  readonly openSessions: number;
  readonly lastSessionAt: string | null;
  /** Everyone marked present: self check-ins plus those added by hand. */
  readonly present: number;
  /** Self check-ins that came with a location reading. */
  readonly readings: number;
  readonly inside: number;
  readonly outside: number;
  readonly unclear: number;
  readonly noReading: number;
  readonly handAdded: number;
  /** inside ÷ readings, or null with no readings. */
  readonly insideShare: number | null;
  /** (outside + unclear) ÷ readings. */
  readonly missShare: number | null;
  /** handAdded ÷ present. */
  readonly handShare: number | null;
};

export function usageFacts(usage: Omit<VenueUsage, 'venueId'> | undefined): UsageFacts {
  const value = usage ?? NO_USAGE;
  const readings = value.inside + value.outside + value.unclear;
  const present = value.checkIns + value.handAdded;
  return {
    sessions: value.sessions,
    openSessions: value.openSessions,
    lastSessionAt: value.lastSessionAt,
    present,
    readings,
    inside: value.inside,
    outside: value.outside,
    unclear: value.unclear,
    noReading: value.noReading,
    handAdded: value.handAdded,
    insideShare: readings ? value.inside / readings : null,
    missShare: readings ? (value.outside + value.unclear) / readings : null,
    handShare: present ? value.handAdded / present : null,
  };
}

export function percent(share: number): string {
  if (share > 0 && share < 0.01) return '<1%';
  if (share < 1 && share > 0.99) return '99%';
  return `${Math.round(share * 100)}%`;
}

/** "9 classes · 94% inside", "1 class open now", or "No classes in 30 days". */
export function classes(count: number): string {
  return count === 1 ? '1 class' : `${count.toLocaleString('en-NG')} classes`;
}

export function usageLine(facts: UsageFacts): string {
  if (facts.openSessions > 0) return `${classes(facts.openSessions)} open now`;
  if (!facts.sessions) return `No classes in ${VENUE_USAGE_DAYS} days`;
  return facts.insideShare == null ? classes(facts.sessions) : `${classes(facts.sessions)} · ${percent(facts.insideShare)} inside`;
}

/* ---------- what needs attention ---------- */

/** Below this many readings or people, shares say too little to warn about. */
export const EVIDENCE_FLOOR = 20;
/** Warn when this share of readings landed outside or unclear. */
export const MISS_WARNING = 0.2;
/** Warn when this share of the people present were added by hand. */
export const HAND_WARNING = 0.25;
/** A circle (with its allowance) smaller than indoor GPS error. */
export const SMALL_AREA_METERS = 20;

export type Concern =
  | { readonly kind: 'no_location' }
  | { readonly kind: 'ready_to_activate' }
  | { readonly kind: 'no_allowance' }
  | { readonly kind: 'small_area' }
  | { readonly kind: 'often_missed'; readonly share: number }
  | { readonly kind: 'often_by_hand'; readonly share: number };

/**
 * What an institution administrator should look at, most pressing first. Inactive venues are
 * switched off on purpose, so they raise nothing.
 */
export function concernsOf(venue: AdminVenue, facts: UsageFacts): Concern[] {
  if (venue.status === 'inactive') return [];
  if (!isLocated(venue)) return [{ kind: 'no_location' }];
  const concerns: Concern[] = [];
  if (venue.status === 'pending_review') concerns.push({ kind: 'ready_to_activate' });
  if (venue.geofenceAllowanceMeters === 0) concerns.push({ kind: 'no_allowance' });
  else if (!venue.geofenceOutline && (venue.geofenceRadiusMeters ?? 0) + venue.geofenceAllowanceMeters < SMALL_AREA_METERS) concerns.push({ kind: 'small_area' });
  if (facts.missShare != null && facts.readings >= EVIDENCE_FLOOR && facts.missShare >= MISS_WARNING) concerns.push({ kind: 'often_missed', share: facts.missShare });
  if (facts.handShare != null && facts.present >= EVIDENCE_FLOOR && facts.handShare >= HAND_WARNING) concerns.push({ kind: 'often_by_hand', share: facts.handShare });
  return concerns;
}

export function concernText(concern: Concern): { readonly title: string; readonly detail: string; readonly tone: 'warning' | 'info' } {
  switch (concern.kind) {
    case 'no_location':
      return { title: 'No location yet', detail: 'Check-ins here can’t be verified until the venue has a boundary.', tone: 'warning' };
    case 'ready_to_activate':
      return { title: 'Ready to activate', detail: 'The boundary is set. Activate the venue so lecturers can pick it.', tone: 'info' };
    case 'no_allowance':
      return { title: 'No allowance for GPS error', detail: 'Phones indoors are often 10–30 m off, so students inside can be turned away. Add 15–25 m.', tone: 'warning' };
    case 'small_area':
      return { title: 'Smaller than GPS error', detail: 'This circle and its allowance are under 20 m. Phones indoors are often further off than that.', tone: 'warning' };
    case 'often_missed':
      return { title: `${percent(concern.share)} landed outside or unclear`, detail: 'If students were really in the room, widen the allowance or redraw the outline.', tone: 'warning' };
    case 'often_by_hand':
      return { title: `${percent(concern.share)} added by hand`, detail: 'Checking in may be failing here. Test the spot from inside the room.', tone: 'warning' };
  }
}

/* ---------- filters and the address bar ---------- */

export type Show = 'all' | 'attention' | 'active' | 'pending' | 'inactive';
export type View = { readonly show: Show; readonly campus: string | null; readonly venue: string | null };

const SHOWS: readonly Show[] = ['all', 'attention', 'active', 'pending', 'inactive'];

/** /admin/venues?show=attention&campus=ojo&venue=eng-lt1 */
export function readView(params: { get(name: string): string | null } | null): View {
  const show = params?.get('show') ?? 'all';
  return {
    show: (SHOWS as readonly string[]).includes(show) ? show as Show : 'all',
    campus: params?.get('campus')?.toLowerCase() || null,
    venue: params?.get('venue')?.toLowerCase() || null,
  };
}

export function viewHref(path: string, view: View): string {
  const query = new URLSearchParams();
  if (view.show !== 'all') query.set('show', view.show);
  if (view.campus) query.set('campus', view.campus);
  if (view.venue) query.set('venue', view.venue);
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** Codes are unique per campus: a code used on two campuses gets the campus code added. */
export function venueSlug(venue: AdminVenue, venues: readonly AdminVenue[], campuses: readonly AdminCampus[]): string {
  const base = venue.code.toLowerCase();
  if (!venues.some((other) => other.id !== venue.id && other.code === venue.code)) return base;
  const campus = campuses.find((item) => item.id === venue.campusId);
  return `${base}-${(campus?.code ?? venue.campusId.slice(0, 4)).toLowerCase()}`;
}

export function findBySlug(slug: string | null, venues: readonly AdminVenue[], campuses: readonly AdminCampus[]): AdminVenue | null {
  if (!slug) return null;
  return venues.find((venue) => venueSlug(venue, venues, campuses) === slug) ?? null;
}

export function matchesShow(show: Show, venue: AdminVenue, concerns: readonly Concern[]): boolean {
  switch (show) {
    case 'all': return true;
    case 'attention': return concerns.length > 0;
    case 'active': return venue.status === 'active';
    case 'pending': return venue.status === 'pending_review';
    case 'inactive': return venue.status === 'inactive';
  }
}

export function matchesQuery(venue: AdminVenue, query: string): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const text = [venue.code, venue.name, venue.buildingName, venue.campusName, TYPE_LABEL[venue.venueType], venue.floorLabel, venue.sectionLabel]
    .filter(Boolean).join(' ').toLowerCase();
  return words.every((word) => text.includes(word));
}

const byCode = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
export function sortVenues(venues: readonly AdminVenue[]): AdminVenue[] {
  return [...venues].sort((a, b) => byCode.compare(a.code, b.code) || byCode.compare(a.campusName, b.campusName));
}

export type VenueCounts = { readonly total: number; readonly active: number; readonly pending: number; readonly inactive: number; readonly attention: number; readonly unlocated: number };

export function countVenues(venues: readonly AdminVenue[], concerns: ReadonlyMap<string, readonly Concern[]>): VenueCounts {
  let active = 0;
  let pending = 0;
  let inactive = 0;
  let attention = 0;
  let unlocated = 0;
  for (const venue of venues) {
    if (venue.status === 'active') active += 1;
    else if (venue.status === 'pending_review') pending += 1;
    else inactive += 1;
    if (venue.status !== 'inactive' && !isLocated(venue)) unlocated += 1;
    if ((concerns.get(venue.id) ?? []).length) attention += 1;
  }
  return { total: venues.length, active, pending, inactive, attention, unlocated };
}

/** Totals across venues, for the figures at the top. */
export function totalUsage(usage: readonly VenueUsage[], venueIds: ReadonlySet<string>): UsageFacts {
  const sum = { ...NO_USAGE };
  let last: string | null = null;
  for (const item of usage) {
    if (!venueIds.has(item.venueId)) continue;
    sum.sessions += item.sessions;
    sum.openSessions += item.openSessions;
    sum.checkIns += item.checkIns;
    sum.inside += item.inside;
    sum.outside += item.outside;
    sum.unclear += item.unclear;
    sum.noReading += item.noReading;
    sum.handAdded += item.handAdded;
    if (item.lastSessionAt && (!last || item.lastSessionAt > last)) last = item.lastSessionAt;
  }
  return usageFacts({ ...sum, lastSessionAt: last });
}

/* ---------- testing a spot ---------- */

export type SpotVerdict = { readonly tone: 'success' | 'warning' | 'danger'; readonly title: string; readonly detail: string };

/**
 * Would a check-in from this reading count? Uses the same rules as a real check-in
 * (evaluatePresence), so an administrator standing in a seat sees what a student would.
 */
export function spotVerdict(area: VenueArea, reading: PresenceReading): SpotVerdict {
  const result = evaluatePresence(area, reading);
  const accuracy = result.accuracyMeters == null ? 'no accuracy' : formatAccuracy(result.accuracyMeters);
  const walls = area.shape.kind === 'outline' ? 'the walls' : 'the circle';
  switch (result.reason) {
    case 'inside':
      return { tone: 'success', title: 'A check-in here would count', detail: `You are inside ${area.shape.kind === 'outline' ? 'the outline' : 'the circle'}. This reading is ${accuracy}.` };
    case 'within_allowance':
      return { tone: 'success', title: 'A check-in here would count', detail: `You are ${formatMeters(result.outsideMeters)} outside ${walls}, within the ${area.allowanceMeters} m allowance. This reading is ${accuracy}.` };
    case 'outside':
      return { tone: 'danger', title: 'A check-in here would be turned away', detail: `You are ${formatMeters(result.beyondAllowanceMeters)} beyond the allowance, more than this reading’s ${accuracy}. If this spot is inside the room, redraw the boundary.` };
    case 'outside_uncertain':
      return { tone: 'warning', title: 'A check-in here would be turned away', detail: `You are ${formatMeters(result.beyondAllowanceMeters)} beyond the allowance, but the reading is ${accuracy}. Try again by a window, or widen the allowance if this spot is inside.` };
    case 'approximate':
      return { tone: 'warning', title: 'Can’t tell: Precise Location is off', detail: 'This phone is sharing an approximate location. Turn on Precise Location for this site and try again.' };
    case 'coarse':
      return { tone: 'warning', title: 'Can’t tell: the reading is too rough', detail: `The phone’s reading is ${accuracy}. Wait a few seconds with the screen on, move nearer a window, and try again.` };
    case 'stale':
      return { tone: 'warning', title: 'Can’t tell: the reading is out of date', detail: 'Try again; keep this page open while the phone finds you.' };
  }
}

/* ---------- history ---------- */

export function changeTitle(change: VenueLocationChange): string {
  if (change.kind === 'cleared') return 'Location cleared';
  return change.kind === 'registered' ? 'Location set' : 'Boundary changed';
}

/** "Outline, 6 corners + 20 m · measured ±9 m". */
export function changeDetail(change: VenueLocationChange): string {
  if (change.kind === 'cleared' || !change.shape) return '';
  const shape = change.shape === 'outline' ? `Outline, ${change.corners ?? '?'} corners` : `${change.radiusMeters ?? '?'} m circle`;
  const allowance = change.allowanceMeters ? ` + ${change.allowanceMeters} m` : '';
  const measured = change.accuracyMeters != null ? ` · measured ${formatAccuracy(change.accuracyMeters)}` : '';
  return `${shape}${allowance}${measured}`;
}
