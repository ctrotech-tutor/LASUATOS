import type { AdminCampus, AdminVenue, VenueUsage } from '@lasuatos/contracts';
import { describe, expect, it } from 'vitest';
import {
  boundaryLine,
  changeDetail,
  changeTitle,
  concernsOf,
  concernText,
  countVenues,
  findBySlug,
  matchesQuery,
  matchesShow,
  percent,
  readView,
  sortVenues,
  spotVerdict,
  totalUsage,
  usageFacts,
  usageLine,
  venueArea,
  venueSlug,
  viewHref,
} from './format';

const OJO = '11111111-1111-4111-8111-111111111111';
const EPE = '22222222-2222-4222-8222-222222222222';
const campuses: AdminCampus[] = [
  { id: OJO, code: 'OJO', name: 'Ojo Campus', address: null, latitude: 6.4672, longitude: 3.2004, isActive: true },
  { id: EPE, code: 'EPE', name: 'Epe Campus', address: null, latitude: 6.5847, longitude: 3.9833, isActive: true },
];

let next = 0;
function venue(overrides: Partial<AdminVenue> = {}): AdminVenue {
  next += 1;
  return {
    id: `00000000-0000-4000-8000-${String(next).padStart(12, '0')}`,
    campusId: OJO,
    campusName: 'Ojo Campus',
    buildingId: null,
    buildingName: 'Engineering Complex',
    code: `LT-${next}`,
    name: `Lecture Theatre ${next}`,
    venueType: 'lecture_theatre',
    floorLabel: null,
    sectionLabel: null,
    capacity: 400,
    status: 'active',
    latitude: 6.4672,
    longitude: 3.2004,
    geofenceKind: 'circle',
    geofenceRadiusMeters: 30,
    geofenceOutline: null,
    geofenceAllowanceMeters: 15,
    locationAccuracyMeters: 8,
    locationSampleCount: 12,
    locationRequired: true,
    locationRegisteredAt: '2026-10-01T09:00:00.000Z',
    locationRegisteredByName: 'Folake Adewale',
    notes: null,
    createdAt: '2026-09-01T09:00:00.000Z',
    ...overrides,
  };
}

function usage(overrides: Partial<VenueUsage> = {}): VenueUsage {
  return { venueId: 'x', sessions: 5, openSessions: 0, lastSessionAt: '2026-11-09T09:00:00.000Z', checkIns: 100, inside: 90, outside: 4, unclear: 2, noReading: 4, handAdded: 3, ...overrides };
}

const square = [
  { latitude: 6.4670, longitude: 3.2002 },
  { latitude: 6.4670, longitude: 3.2006 },
  { latitude: 6.4674, longitude: 3.2006 },
  { latitude: 6.4674, longitude: 3.2002 },
];

describe('concernsOf', () => {
  it('asks for a location first, and nothing else, for a venue without one', () => {
    expect(concernsOf(venue({ status: 'pending_review', latitude: null, longitude: null, geofenceRadiusMeters: null }), usageFacts(undefined))).toEqual([{ kind: 'no_location' }]);
  });

  it('raises nothing for an inactive venue, which is switched off on purpose', () => {
    expect(concernsOf(venue({ status: 'inactive', latitude: null, longitude: null }), usageFacts(undefined))).toEqual([]);
    expect(concernsOf(venue({ status: 'inactive', geofenceAllowanceMeters: 0 }), usageFacts(undefined))).toEqual([]);
  });

  it('offers activation once a pending venue has a boundary', () => {
    expect(concernsOf(venue({ status: 'pending_review' }), usageFacts(undefined))).toEqual([{ kind: 'ready_to_activate' }]);
  });

  it('flags boundaries that turn away students sitting inside', () => {
    expect(concernsOf(venue({ geofenceAllowanceMeters: 0 }), usageFacts(undefined))).toEqual([{ kind: 'no_allowance' }]);
    expect(concernsOf(venue({ geofenceRadiusMeters: 8, geofenceAllowanceMeters: 10 }), usageFacts(undefined))).toEqual([{ kind: 'small_area' }]);
    // An outline is the hall's own shape: a small one is fine with an allowance.
    expect(concernsOf(venue({ geofenceOutline: square, geofenceRadiusMeters: 8, geofenceAllowanceMeters: 10 }), usageFacts(undefined))).toEqual([]);
    expect(concernsOf(venue({ geofenceRadiusMeters: 30, geofenceAllowanceMeters: 15 }), usageFacts(undefined))).toEqual([]);
  });

  it('warns when check-ins often land outside, or are often added by hand, with enough of them to tell', () => {
    const missed = concernsOf(venue(), usageFacts(usage({ inside: 30, outside: 6, unclear: 4 })));
    expect(missed).toEqual([{ kind: 'often_missed', share: 0.25 }]);
    expect(concernText(missed[0]!).title).toBe('25% landed outside or unclear');
    // Too few readings to say.
    expect(concernsOf(venue(), usageFacts(usage({ inside: 10, outside: 3, unclear: 3 })))).toEqual([]);

    const byHand = concernsOf(venue(), usageFacts(usage({ checkIns: 30, inside: 28, outside: 1, unclear: 0, noReading: 1, handAdded: 12 })));
    expect(byHand).toEqual([{ kind: 'often_by_hand', share: 12 / 42 }]);
  });
});

describe('usage', () => {
  it('counts everyone present and shares of the readings', () => {
    const facts = usageFacts(usage());
    expect(facts.present).toBe(103);
    expect(facts.readings).toBe(96);
    expect(facts.insideShare).toBeCloseTo(0.9375);
    expect(usageLine(facts)).toBe('5 classes · 94% inside');
  });

  it('describes quiet, open and reading-less venues', () => {
    expect(usageLine(usageFacts(undefined))).toBe('No classes in 30 days');
    expect(usageLine(usageFacts(usage({ openSessions: 1 })))).toBe('1 class open now');
    expect(usageLine(usageFacts(usage({ sessions: 1, inside: 0, outside: 0, unclear: 0 })))).toBe('1 class');
  });

  it('never rounds a little to nothing or nearly all to everything', () => {
    expect(percent(0.004)).toBe('<1%');
    expect(percent(0.996)).toBe('99%');
    expect(percent(1)).toBe('100%');
  });

  it('adds up the venues in view', () => {
    const a = venue();
    const b = venue();
    const total = totalUsage(
      [usage({ venueId: a.id, sessions: 2, lastSessionAt: '2026-11-01T09:00:00.000Z' }), usage({ venueId: b.id, sessions: 3, lastSessionAt: '2026-11-08T09:00:00.000Z' }), usage({ venueId: 'elsewhere', sessions: 50 })],
      new Set([a.id, b.id]),
    );
    expect(total.sessions).toBe(5);
    expect(total.lastSessionAt).toBe('2026-11-08T09:00:00.000Z');
  });

  it('counts statuses and venues needing attention', () => {
    const list = [venue(), venue({ status: 'pending_review', latitude: null, longitude: null }), venue({ status: 'inactive' })];
    const concerns = new Map(list.map((item) => [item.id, concernsOf(item, usageFacts(undefined))]));
    expect(countVenues(list, concerns)).toEqual({ total: 3, active: 1, pending: 1, inactive: 1, attention: 1, unlocated: 1 });
  });
});

describe('the address bar', () => {
  it('reads and writes filters, ignoring nonsense', () => {
    const params = new URLSearchParams('show=attention&campus=OJO&venue=ENG-LT1');
    expect(readView(params)).toEqual({ show: 'attention', campus: 'ojo', venue: 'eng-lt1' });
    expect(readView(new URLSearchParams('show=everything'))).toEqual({ show: 'all', campus: null, venue: null });
    expect(viewHref('/admin/venues', { show: 'all', campus: null, venue: null })).toBe('/admin/venues');
    expect(viewHref('/admin/venues', { show: 'pending', campus: 'epe', venue: 'lt-1' })).toBe('/admin/venues?show=pending&campus=epe&venue=lt-1');
  });

  it('names a venue by its code, adding the campus only when two campuses share the code', () => {
    const ojo = venue({ code: 'MPH' });
    const epe = venue({ code: 'MPH', campusId: EPE, campusName: 'Epe Campus' });
    const solo = venue({ code: 'ENG-LT1' });
    const all = [ojo, epe, solo];
    expect(venueSlug(solo, all, campuses)).toBe('eng-lt1');
    expect(venueSlug(ojo, all, campuses)).toBe('mph-ojo');
    expect(venueSlug(epe, all, campuses)).toBe('mph-epe');
    expect(findBySlug('mph-epe', all, campuses)).toBe(epe);
    expect(findBySlug('nope', all, campuses)).toBeNull();
  });
});

describe('finding and sorting', () => {
  it('matches every word against code, name, building, campus and type', () => {
    const lab = venue({ code: 'ECE-LAB1', name: 'Electronics Lab', venueType: 'laboratory' });
    expect(matchesQuery(lab, 'ece lab')).toBe(true);
    expect(matchesQuery(lab, 'engineering laboratory')).toBe(true);
    expect(matchesQuery(lab, 'senate')).toBe(false);
    expect(matchesQuery(lab, '  ')).toBe(true);
  });

  it('filters by status or attention', () => {
    const pending = venue({ status: 'pending_review' });
    expect(matchesShow('pending', pending, [])).toBe(true);
    expect(matchesShow('active', pending, [])).toBe(false);
    expect(matchesShow('attention', pending, [{ kind: 'ready_to_activate' }])).toBe(true);
  });

  it('sorts codes the way people read them', () => {
    const sorted = sortVenues([venue({ code: 'LT10' }), venue({ code: 'LT2' }), venue({ code: 'lab' })]);
    expect(sorted.map((item) => item.code)).toEqual(['lab', 'LT2', 'LT10']);
  });
});

describe('boundaries', () => {
  it('describes the shape and allowance', () => {
    expect(boundaryLine(venue())).toBe('30 m circle + 15 m');
    expect(boundaryLine(venue({ geofenceOutline: square, geofenceAllowanceMeters: 0 }))).toBe('Outline, 4 corners');
    expect(boundaryLine(venue({ latitude: null, longitude: null }))).toBe('No location');
    expect(venueArea(venue({ latitude: null, longitude: null }))).toBeNull();
  });

  it('describes location changes', () => {
    const at = '2026-11-01T09:00:00.000Z';
    expect(changeTitle({ kind: 'registered', at, actorName: null, shape: 'circle', radiusMeters: 25, corners: null, allowanceMeters: 15, accuracyMeters: 9 })).toBe('Location set');
    expect(changeDetail({ kind: 'updated', at, actorName: null, shape: 'outline', radiusMeters: 30, corners: 6, allowanceMeters: 20, accuracyMeters: null })).toBe('Outline, 6 corners + 20 m');
    expect(changeDetail({ kind: 'registered', at, actorName: null, shape: 'circle', radiusMeters: 25, corners: null, allowanceMeters: 0, accuracyMeters: 9.4 })).toBe('25 m circle · measured ±9 m');
  });
});

describe('spotVerdict', () => {
  const area = venueArea(venue({ geofenceOutline: square, geofenceAllowanceMeters: 15 }))!;
  const reading = (latitude: number, longitude: number, accuracyMeters: number | null = 8, ageMilliseconds = 1_000) => ({ latitude, longitude, accuracyMeters, ageMilliseconds });

  it('says a check-in would count inside, or within the allowance', () => {
    expect(spotVerdict(area, reading(6.4672, 3.2004))).toMatchObject({ tone: 'success', title: 'A check-in here would count' });
    // About 10 m north of the north wall.
    const near = spotVerdict(area, reading(6.46749, 3.2004));
    expect(near.tone).toBe('success');
    expect(near.detail).toContain('within the 15 m allowance');
  });

  it('says it would be turned away well outside', () => {
    expect(spotVerdict(area, reading(6.4685, 3.2004))).toMatchObject({ tone: 'danger', title: 'A check-in here would be turned away' });
  });

  it('can’t tell from a rough, approximate or old reading', () => {
    expect(spotVerdict(area, reading(6.4672, 3.2004, 150)).title).toBe('Can’t tell: the reading is too rough');
    expect(spotVerdict(area, reading(6.4672, 3.2004, 3000)).title).toBe('Can’t tell: Precise Location is off');
    expect(spotVerdict(area, reading(6.4672, 3.2004, 8, 600_000)).title).toBe('Can’t tell: the reading is out of date');
  });
});
