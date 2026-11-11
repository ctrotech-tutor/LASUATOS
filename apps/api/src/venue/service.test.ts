import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import type { AdminVenueRecord, VenueRepository } from './repository.js';
import {
  CampusUnavailableError,
  VenueConflictError,
  VenueLocationRequiredError,
  VenueNotFoundError,
  VenuePermissionError,
  VenueService,
} from './service.js';

const now = new Date('2026-11-10T12:00:00.000Z');

const institutionAdmin: AdministratorSessionAccount = {
  accountType: 'administrator',
  id: '33c7c76b-59a6-453d-b5a8-45ba1c985999',
  email: 'admin@example.net',
  displayName: 'Institution Administrator',
  emailVerified: true,
  institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
  institutionName: 'Example Institution',
  role: 'institution_administrator',
  scope: {
    type: 'institution',
    id: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
    label: 'Example Institution',
    institutionId: 'e4d4d862-1a7d-4a3d-807d-f893ac7a7db8',
  },
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
};

const departmentAdmin: AdministratorSessionAccount = {
  ...institutionAdmin,
  role: 'department_administrator',
  scope: {
    type: 'department',
    id: '45080b73-21f3-4d38-85df-b9b2a45d0134',
    label: 'Example Department',
    facultyName: 'Example Faculty',
    institutionId: institutionAdmin.institutionId,
  },
};

const venue: AdminVenueRecord = {
  id: 'd7b6b0a2-7f4f-4f3a-9db3-9f3b12f1c001',
  campusId: 'f4a2c1c9-2fae-42a6-9d1b-9f7a7a1f1002',
  campusName: 'Demo Campus',
  buildingId: null,
  buildingName: null,
  code: 'LT-01',
  name: 'Lecture Theatre 1',
  venueType: 'lecture_theatre',
  floorLabel: null,
  sectionLabel: null,
  capacity: 400,
  status: 'pending_review',
  latitude: null,
  longitude: null,
  geofenceKind: 'circle',
  geofenceRadiusMeters: null,
  locationRequired: true,
  locationRegisteredAt: null,
  createdAt: now,
};

const repositoryMock = vi.hoisted(() => ({
  listCampuses: vi.fn(),
  listBuildings: vi.fn(),
  createBuilding: vi.fn(),
  listVenues: vi.fn(),
  getVenue: vi.fn(),
  createVenue: vi.fn(),
  registerVenueLocation: vi.fn(),
  setVenueStatus: vi.fn(),
}));

function makeRepository(): VenueRepository {
  return { ...repositoryMock } as unknown as VenueRepository;
}

function service(repository = makeRepository()) {
  return new VenueService({ repository, now: () => now });
}

afterEach(() => vi.clearAllMocks());

describe('VenueService', () => {
  it('lets any scoped administrator read the directory but reserves writes for institution administrators', async () => {
    repositoryMock.listVenues.mockResolvedValue([venue]);
    await expect(service().listVenues(departmentAdmin)).resolves.toEqual([venue]);

    await expect(service().createVenue(departmentAdmin, {
      campusId: venue.campusId,
      code: 'lt-01',
      name: 'Lecture Theatre 1',
      venueType: 'lecture_theatre',
      locationRequired: true,
    })).rejects.toBeInstanceOf(VenuePermissionError);
    expect(repositoryMock.createVenue).not.toHaveBeenCalled();

    await expect(service().setVenueStatus(departmentAdmin, venue.id, 'active'))
      .rejects.toBeInstanceOf(VenuePermissionError);
    repositoryMock.registerVenueLocation.mockResolvedValue({ kind: 'missing' });
    await expect(service().registerVenueLocation(departmentAdmin, venue.id, {
      latitude: 6.594255,
      longitude: 3.995948,
      geofenceRadiusMeters: 80,
    })).rejects.toBeInstanceOf(VenuePermissionError);
    expect(repositoryMock.registerVenueLocation).not.toHaveBeenCalled();
  });

  it('normalizes codes/labels and maps repository outcomes to clear errors', async () => {
    repositoryMock.createVenue.mockResolvedValueOnce({ kind: 'created', venue });
    const created = await service().createVenue(institutionAdmin, {
      campusId: venue.campusId,
      code: ' lt-01 ',
      name: '  Lecture Theatre 1  ',
      venueType: 'lecture_theatre',
      floorLabel: '   ',
      locationRequired: true,
    });
    expect(created).toEqual(venue);
    expect(repositoryMock.createVenue).toHaveBeenCalledWith(expect.objectContaining({
      code: 'LT-01',
      name: 'Lecture Theatre 1',
      floorLabel: null,
      sectionLabel: null,
    }));

    repositoryMock.createVenue.mockResolvedValueOnce({ kind: 'duplicate' });
    await expect(service().createVenue(institutionAdmin, {
      campusId: venue.campusId,
      code: 'LT-01',
      name: 'Lecture Theatre 1',
      venueType: 'lecture_theatre',
      locationRequired: true,
    })).rejects.toBeInstanceOf(VenueConflictError);

    repositoryMock.createVenue.mockResolvedValueOnce({ kind: 'campus_missing' });
    await expect(service().createVenue(institutionAdmin, {
      campusId: venue.campusId,
      code: 'LT-02',
      name: 'Lecture Theatre 2',
      venueType: 'lecture_theatre',
      locationRequired: true,
    })).rejects.toBeInstanceOf(CampusUnavailableError);
  });

  it('rejects out-of-range coordinates before touching the database', async () => {
    await expect(service().registerVenueLocation(institutionAdmin, venue.id, {
      latitude: 91,
      longitude: 0,
      geofenceRadiusMeters: 80,
    })).rejects.toMatchObject({ statusCode: 400 });
    await expect(service().registerVenueLocation(institutionAdmin, venue.id, {
      latitude: 6.5,
      longitude: Number.NaN,
      geofenceRadiusMeters: 80,
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(repositoryMock.registerVenueLocation).not.toHaveBeenCalled();
  });

  it('blocks activation without a registered location and records the actor on registration', async () => {
    repositoryMock.setVenueStatus.mockResolvedValueOnce({ kind: 'location_required' });
    await expect(service().setVenueStatus(institutionAdmin, venue.id, 'active'))
      .rejects.toBeInstanceOf(VenueLocationRequiredError);

    repositoryMock.registerVenueLocation.mockResolvedValueOnce({
      kind: 'registered',
      venue: { ...venue, latitude: 6.594255, longitude: 3.995948, geofenceRadiusMeters: 80, locationRegisteredAt: now },
    });
    const registered = await service().registerVenueLocation(institutionAdmin, venue.id, {
      latitude: 6.594255,
      longitude: 3.995948,
      geofenceRadiusMeters: 80,
      reportedAccuracyMeters: 12,
    });
    expect(registered.latitude).toBeCloseTo(6.594255);
    expect(repositoryMock.registerVenueLocation).toHaveBeenCalledWith(expect.objectContaining({
      actorUserId: institutionAdmin.id,
      institutionId: institutionAdmin.institutionId,
      reportedAccuracyMeters: 12,
    }));

    repositoryMock.setVenueStatus.mockResolvedValueOnce({ kind: 'missing' });
    await expect(service().setVenueStatus(institutionAdmin, venue.id, 'inactive'))
      .rejects.toBeInstanceOf(VenueNotFoundError);
  });
});
