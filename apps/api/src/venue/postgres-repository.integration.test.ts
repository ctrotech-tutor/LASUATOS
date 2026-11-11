import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import type { DatabaseClient } from '@lasuatos/database';
import { expect, it } from 'vitest';
import type { AdministratorSessionAccount } from '../auth/repository.js';
import { PostgresVenueRepository } from './postgres-repository.js';
import { VenueService } from './service.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const migrationDirectory = path.join(repositoryRoot, 'packages/database/drizzle/migrations');

const ids = {
  institution: 'a1111111-1111-4111-8111-111111111111',
  otherInstitution: 'a2222222-2222-4222-8222-222222222222',
  faculty: 'a3333333-3333-4333-8333-333333333333',
  department: 'a4444444-4444-4444-8444-444444444444',
  adminUser: 'a5555555-5555-4555-8555-555555555555',
  campus: 'a6666666-6666-4666-8666-666666666666',
  otherCampus: 'a7777777-7777-4777-8777-777777777777',
} as const;

function adminAccount(): AdministratorSessionAccount {
  return {
    accountType: 'administrator',
    id: ids.adminUser,
    email: 'venue-admin@test.invalid',
    displayName: 'Venue Admin',
    emailVerified: true,
    institutionId: ids.institution,
    institutionName: 'Venue Test Institution',
    role: 'institution_administrator',
    scope: { type: 'institution', id: ids.institution, label: 'Venue Test Institution', institutionId: ids.institution },
    sessionExpiresAt: new Date('2027-01-01T00:00:00.000Z'),
  };
}

async function applyMigrations(client: PGlite) {
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith('.sql'))
    .sort();
  for (const file of files) {
    const migration = await readFile(path.join(migrationDirectory, file), 'utf8');
    const statements = migration
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter(Boolean);
    for (const statement of statements) await client.exec(statement);
  }
}

it('runs the venue lifecycle against embedded PostgreSQL with tenant isolation', async () => {
  const client = new PGlite();
  try {
    await applyMigrations(client);

    await client.query('INSERT INTO institutions (id, slug, name) VALUES ($1, $2, $3), ($4, $5, $6)', [
      ids.institution, 'venue-test', 'Venue Test Institution',
      ids.otherInstitution, 'other-tenant', 'Other Tenant',
    ]);
    await client.query(
      'INSERT INTO faculties (id, institution_id, code, name) VALUES ($1, $2, $3, $4)',
      [ids.faculty, ids.institution, 'ENG', 'Engineering'],
    );
    await client.query(
      'INSERT INTO departments (id, institution_id, faculty_id, code, name) VALUES ($1, $2, $3, $4, $5)',
      [ids.department, ids.institution, ids.faculty, 'ECE', 'Electronic and Computer Engineering'],
    );
    await client.query(
      `INSERT INTO users (id, institution_id, email, display_name, status, email_verified_at)
       VALUES ($1, $2, $3, $4, 'active', CURRENT_TIMESTAMP)`,
      [ids.adminUser, ids.institution, 'venue-admin@test.invalid', 'Venue Admin'],
    );
    await client.query(
      `INSERT INTO user_role_assignments (user_id, role, scope_type, institution_id) VALUES ($1, 'institution_administrator', 'institution', $2)`,
      [ids.adminUser, ids.institution],
    );
    // Campus anchor taken from a public map reference for the demo area.
    await client.query(
      'INSERT INTO campuses (id, institution_id, code, name, latitude, longitude) VALUES ($1, $2, $3, $4, $5, $6)',
      [ids.campus, ids.institution, 'EPE', 'Demo Epe Campus', 6.594255, 3.995948],
    );
    await client.query(
      'INSERT INTO campuses (id, institution_id, code, name) VALUES ($1, $2, $3, $4)',
      [ids.otherCampus, ids.otherInstitution, 'XX', 'Foreign Campus'],
    );

    const database = drizzle(client) as unknown as DatabaseClient;
    const service = new VenueService({ repository: new PostgresVenueRepository(database) });
    const account = adminAccount();

    // Campuses are tenant-scoped listings.
    const campuses = await service.listCampuses(account);
    expect(campuses).toHaveLength(1);
    expect(campuses[0]?.code).toBe('EPE');
    expect(campuses[0]?.latitude).toBeCloseTo(6.594255);

    // Create a building and venue; duplicates and foreign campuses are rejected.
    const building = await service.createBuilding(account, {
      campusId: ids.campus,
      code: 'ENG-CMPX',
      name: 'Engineering Complex',
    });
    await expect(service.createBuilding(account, {
      campusId: ids.campus,
      code: 'ENG-CMPX',
      name: 'Engineering Complex Again',
    })).rejects.toMatchObject({ statusCode: 409 });
    await expect(service.createBuilding(account, {
      campusId: ids.otherCampus,
      code: 'HACK-1',
      name: 'Foreign Campus Building',
    })).rejects.toMatchObject({ statusCode: 404 });

    const venue = await service.createVenue(account, {
      campusId: ids.campus,
      buildingId: building.id,
      code: 'LT-01',
      name: 'Lecture Theatre 1',
      venueType: 'lecture_theatre',
      capacity: 400,
      locationRequired: true,
    });
    expect(venue.status).toBe('pending_review');
    expect(venue.buildingName).toBe('Engineering Complex');

    // Activation requires a registered boundary (service + DB check agree).
    await expect(service.setVenueStatus(account, venue.id, 'active'))
      .rejects.toMatchObject({ statusCode: 409 });

    await expect(service.registerVenueLocation(account, venue.id, {
      latitude: 6.5943,
      longitude: 3.99595,
      geofenceRadiusMeters: 2,
    })).rejects.toMatchObject({ statusCode: 400 });

    const located = await service.registerVenueLocation(account, venue.id, {
      latitude: 6.5943,
      longitude: 3.99595,
      geofenceRadiusMeters: 80,
      reportedAccuracyMeters: 9.5,
    });
    expect(located.latitude).toBeCloseTo(6.5943);
    expect(located.geofenceRadiusMeters).toBe(80);
    expect(located.locationRegisteredAt).not.toBeNull();

    const events = await client.query<{ kind: string; actor_user_id: string }>(
      'SELECT kind, actor_user_id FROM venue_location_events WHERE venue_id = $1',
      [venue.id],
    );
    expect(events.rows).toEqual([{ kind: 'registered', actor_user_id: ids.adminUser }]);

    const active = await service.setVenueStatus(account, venue.id, 'active');
    expect(active.status).toBe('active');

    // A second location change is audited as an update.
    await service.registerVenueLocation(account, venue.id, {
      latitude: 6.59431,
      longitude: 3.995952,
      geofenceRadiusMeters: 90,
    });
    const laterEvents = await client.query<{ kind: string }>(
      'SELECT kind FROM venue_location_events WHERE venue_id = $1 ORDER BY created_at',
      [venue.id],
    );
    expect(laterEvents.rows.map((row) => row.kind)).toEqual(['registered', 'updated']);

    // Cross-tenant reads and mutations are invisible.
    const otherAdmin: AdministratorSessionAccount = {
      ...account,
      institutionId: ids.otherInstitution,
      institutionName: 'Other Tenant',
      scope: { type: 'institution', id: ids.otherInstitution, label: 'Other Tenant', institutionId: ids.otherInstitution },
    };
    expect(await service.listVenues(otherAdmin)).toEqual([]);
    await expect(service.getVenue(otherAdmin, venue.id)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.setVenueStatus(otherAdmin, venue.id, 'inactive'))
      .rejects.toMatchObject({ statusCode: 404 });

    const venues = await service.listVenues(account);
    expect(venues).toHaveLength(1);
    expect(venues[0]?.status).toBe('active');
  } finally {
    await client.close();
  }
}, 60_000);
