import { afterEach, describe, expect, it, vi } from 'vitest';
import { LecturerActiveVenueSchema } from '@lasuatos/contracts';
import { buildServer } from '../server.js';
import type { AuthRouteService } from '../auth/routes.js';
import type { AdministratorSessionAccount, LecturerSessionAccount } from '../auth/repository.js';
import type { AdminVenueRecord } from './repository.js';
import type { VenueRouteOptions } from './routes.js';

const sessionToken = 'a'.repeat(43);
const now = new Date('2026-11-10T12:00:00.000Z');

const administrator: AdministratorSessionAccount = {
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

const lecturer: LecturerSessionAccount = {
  accountType: 'lecturer',
  id: '60f1d0f2-3b7c-4a27-8d44-92b06a79d111',
  email: 'lecturer@example.net',
  displayName: 'Example Lecturer',
  sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
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
  latitude: 6.594255,
  longitude: 3.995948,
  geofenceKind: 'circle',
  geofenceRadiusMeters: 80,
  locationRequired: true,
  locationRegisteredAt: now,
  createdAt: now,
};

function createAuth(account: AdministratorSessionAccount | LecturerSessionAccount): AuthRouteService {
  const studentAccount = {
    accountType: 'student' as const,
    id: '3c4ad7b8-377d-4ea9-a7bf-f7db874f388c',
    email: 'student@example.net',
    displayName: 'Example Student',
    matricNumber: '12345',
    matricNumberVerified: false,
    sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
  };
  return {
    registerStudent: vi.fn(async () => undefined),
    resendVerification: vi.fn(async () => undefined),
    verifyEmail: vi.fn(async () => ({ token: sessionToken, student: studentAccount })),
    login: vi.fn(async () => ({ token: sessionToken, account: studentAccount })),
    getSession: vi.fn(async () => account),
    logout: vi.fn(async () => undefined),
    requestPasswordReset: vi.fn(async () => undefined),
    completePasswordReset: vi.fn(async () => undefined),
    changePassword: vi.fn(async () => 0),
    listSessions: vi.fn(async () => []),
    revokeOtherSessions: vi.fn(async () => 0),
  };
}

function createVenueMock(): NonNullable<VenueRouteOptions['venue']> {
  return {
    listCampuses: vi.fn(async () => [{
      id: venue.campusId,
      code: 'EPE',
      name: 'Demo Campus',
      address: null,
      latitude: 6.594255,
      longitude: 3.995948,
      isActive: true,
    }]),
    listBuildings: vi.fn(async () => []),
    createBuilding: vi.fn(async () => ({
      id: '7e2ad9d3-f1a5-4a94-a5dc-f3d18ec26001',
      campusId: venue.campusId,
      code: 'ENG-CMPX',
      name: 'Engineering Complex',
      isActive: true,
    })),
    listVenues: vi.fn(async () => [venue]),
    getVenue: vi.fn(async () => venue),
    createVenue: vi.fn(async () => venue),
    registerVenueLocation: vi.fn(async () => venue),
    setVenueStatus: vi.fn(async () => ({ ...venue, status: 'active' as const })),
    listActiveVenuesForLecturer: vi.fn(async () => [{
      id: '05e45470-a8e6-4375-936c-4a84cebe06e8',
      code: 'MLT-A',
      name: 'Main Lecture Theatre A',
      campusName: 'Demo Campus',
      buildingName: null,
      venueType: 'lecture_theatre' as const,
      geofenceRadiusMeters: 75,
    }]),
  };
}

const servers: ReturnType<typeof buildServer>[] = [];

function createServer(
  account: AdministratorSessionAccount | LecturerSessionAccount,
  venue = createVenueMock(),
) {
  const server = buildServer({ logger: false, auth: createAuth(account), venue });
  servers.push(server);
  return { server, venue };
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe('venue routes', () => {
  it('lists active venues for a session-setting lecturer', async () => {
    const { server } = createServer(lecturer);
    const response = await server.inject({
      method: 'GET',
      url: '/api/v1/lecturer/venues',
      headers: { cookie: `lasuatos_session=${sessionToken}` },
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { venues: Array<Record<string, unknown>> };
    expect(body.venues).toHaveLength(1);
    expect(body.venues[0]).toEqual(
      LecturerActiveVenueSchema.parse({
        id: '05e45470-a8e6-4375-936c-4a84cebe06e8',
        code: 'MLT-A',
        name: 'Main Lecture Theatre A',
        campusName: 'Demo Campus',
        buildingName: null,
        venueType: 'lecture_theatre',
        geofenceRadiusMeters: 75,
      }),
    );
  });


  it('limits venue management to administrators', async () => {
    const headers = { cookie: `lasuatos_session=${sessionToken}` };
    const lecturerServer = createServer(lecturer);
    const listDenied = await lecturerServer.server.inject({ method: 'GET', url: '/api/v1/admin/venues', headers });
    expect(listDenied.statusCode).toBe(403);
    expect(lecturerServer.venue.listVenues).not.toHaveBeenCalled();

    const adminServer = createServer(administrator);
    const venues = await adminServer.server.inject({ method: 'GET', url: '/api/v1/admin/venues', headers });
    expect(venues.statusCode).toBe(200);
    expect(venues.json().venues).toHaveLength(1);
    expect(venues.json().venues[0]).toMatchObject({
      code: 'LT-01',
      geofenceRadiusMeters: 80,
      locationRegisteredAt: now.toISOString(),
    });
    const detail = await adminServer.server.inject({ method: 'GET', url: `/api/v1/admin/venues/${venue.id}`, headers });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().venue.campusName).toBe('Demo Campus');
  });

  it('validates venue creation and location registration requests', async () => {
    const headers = { cookie: `lasuatos_session=${sessionToken}` };
    const adminServer = createServer(administrator);

    const invalidCreate = await adminServer.server.inject({
      method: 'POST', url: '/api/v1/admin/venues', headers,
      payload: { campusId: venue.campusId, code: 'bad code', name: 'X', venueType: 'classroom' },
    });
    expect(invalidCreate.statusCode).toBe(400);

    const created = await adminServer.server.inject({
      method: 'POST', url: '/api/v1/admin/venues', headers,
      payload: {
        campusId: venue.campusId,
        code: 'lt-01',
        name: 'Lecture Theatre 1',
        venueType: 'lecture_theatre',
        capacity: 400,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().venue.code).toBe('LT-01');

    const invalidLocation = await adminServer.server.inject({
      method: 'POST', url: `/api/v1/admin/venues/${venue.id}/location`, headers,
      payload: { latitude: 'not-a-number', longitude: 3.99, geofenceRadiusMeters: 80 },
    });
    expect(invalidLocation.statusCode).toBe(400);
    expect(adminServer.venue.registerVenueLocation).not.toHaveBeenCalled();

    const located = await adminServer.server.inject({
      method: 'POST', url: `/api/v1/admin/venues/${venue.id}/location`, headers,
      payload: { latitude: 6.594255, longitude: 3.995948, geofenceRadiusMeters: 80, reportedAccuracyMeters: 12 },
    });
    expect(located.statusCode).toBe(200);
    expect(located.json().status).toBe('registered');
    expect(adminServer.venue.registerVenueLocation).toHaveBeenCalledWith(administrator, venue.id, {
      latitude: 6.594255,
      longitude: 3.995948,
      geofenceRadiusMeters: 80,
      reportedAccuracyMeters: 12,
    });

    const activated = await adminServer.server.inject({
      method: 'POST', url: `/api/v1/admin/venues/${venue.id}/status`, headers,
      payload: { status: 'active' },
    });
    expect(activated.statusCode).toBe(200);
    expect(activated.json().venue.status).toBe('active');
  });

  it('requires authentication', async () => {
    const adminServer = createServer(administrator);
    const response = await adminServer.server.inject({ method: 'GET', url: '/api/v1/admin/venues' });
    expect(response.statusCode).toBe(401);
  });
});
