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

    // Redrawn as the building's outline with an allowance: stored, read back, audited.
    const outline = [
      { latitude: 6.5941, longitude: 3.9958 },
      { latitude: 6.5941, longitude: 3.99615 },
      { latitude: 6.59432, longitude: 3.99615 },
      { latitude: 6.59432, longitude: 3.9958 },
    ];
    const outlined = await service.registerVenueLocation(account, venue.id, { outline, allowanceMeters: 15, reportedAccuracyMeters: 7, sampleCount: 30 });
    expect(outlined.geofenceOutline).toEqual(outline);
    expect(outlined.geofenceAllowanceMeters).toBe(15);
    expect(outlined.locationAccuracyMeters).toBe(7);
    expect(outlined.locationSampleCount).toBe(30);
    expect(outlined.latitude).toBeCloseTo(6.59421, 5);
    expect(outlined.geofenceRadiusMeters).toBeGreaterThanOrEqual(22);
    const outlineEvent = await client.query<{ geofence_outline: unknown; geofence_allowance_meters: number; sample_count: number }>(
      'SELECT geofence_outline, geofence_allowance_meters, sample_count FROM venue_location_events WHERE venue_id = $1 ORDER BY created_at DESC LIMIT 1',
      [venue.id],
    );
    expect(outlineEvent.rows[0]).toEqual({ geofence_outline: outline, geofence_allowance_meters: 15, sample_count: 30 });
    // Back to a circle: the outline is cleared.
    const circled = await service.registerVenueLocation(account, venue.id, { latitude: 6.5943, longitude: 3.99595, geofenceRadiusMeters: 30, allowanceMeters: 10 });
    expect(circled.geofenceOutline).toBeNull();
    expect(circled.geofenceAllowanceMeters).toBe(10);

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
    expect(venues[0]?.locationRegisteredByName).toBe('Venue Admin');

    // Notes are corrected like any other detail.
    const noted = await service.updateVenue(account, venue.id, { notes: '  Enter by the east door.  ' });
    expect(noted.notes).toBe('Enter by the east door.');

    // Creating, activating and deactivating are in the audit trail.
    await service.setVenueStatus(account, venue.id, 'inactive');
    await service.setVenueStatus(account, venue.id, 'active');
    await service.setVenueStatus(account, venue.id, 'active');
    const audit = await client.query<{ action: string; target_type: string }>(
      'SELECT action, target_type FROM structure_audit_events WHERE institution_id = $1 ORDER BY created_at, action',
      [ids.institution],
    );
    expect(audit.rows.map((row) => row.action).filter((action) => action !== 'venue_updated')).toEqual([
      'building_created', 'venue_created', 'venue_activated', 'venue_deactivated', 'venue_activated',
    ]);

    // Usage and evidence: two sessions in the last 30 days, one older; a removed check-in is ignored.
    const now = Date.now();
    const hour = 3_600_000;
    const session = async (code: string, course: string, startsAgo: number, open = false) => {
      const startsAt = new Date(now - startsAgo);
      const result = await client.query<{ id: string }>(
        `INSERT INTO lecture_sessions (institution_id, created_by_user_id, creator_role, course_code, course_title, venue_id, require_venue, qr_mode, secret, public_code, starts_at, ends_at, closed_at)
         VALUES ($1, $2, 'administrator', $3, 'Test course', $4, true, 'dynamic', 'secret', $5, $6, $7, $8) RETURNING id`,
        [ids.institution, ids.adminUser, course, venue.id, code, startsAt,
          open ? new Date(now + hour) : new Date(startsAt.getTime() + 2 * hour), open ? null : new Date(startsAt.getTime() + 2 * hour)],
      );
      return result.rows[0]!.id;
    };
    const recent = await session('P1', 'ECE 301', 2 * 24 * hour);
    const openNow = await session('P2', 'ECE 305', hour / 4, true);
    const old = await session('P3', 'ECE 301', 45 * 24 * hour);
    const attend = (sessionId: string, matric: string, outcome: string | null, extra: { manual?: boolean; removed?: boolean } = {}) => client.query(
      `INSERT INTO lecture_attendance (institution_id, lecture_session_id, full_name, matric_number, method, latitude, longitude, accuracy_meters, venue_outcome, added_by_user_id, removed_at)
       VALUES ($1, $2, 'Student', $3, $4, $5, $6, $7, $8, $9, $10)`,
      [ids.institution, sessionId, matric, extra.manual ? 'manual' : 'qr', outcome && outcome !== 'unavailable' ? 6.5943 : null, outcome && outcome !== 'unavailable' ? 3.99595 : null,
        outcome && outcome !== 'unavailable' ? 11.4 : null, outcome, extra.manual ? ids.adminUser : null, extra.removed ? new Date() : null],
    );
    await attend(recent, 'A1', 'within');
    await attend(recent, 'A2', 'within');
    await attend(recent, 'A3', 'inconclusive');
    await attend(recent, 'A4', 'unavailable');
    await attend(recent, 'A5', null, { manual: true });
    await attend(recent, 'A6', 'outside', { removed: true });
    await attend(openNow, 'A1', 'outside');
    await attend(old, 'A1', 'within');

    const usage = await service.listVenueUsage(account);
    expect(usage).toEqual([expect.objectContaining({
      venueId: venue.id, sessions: 2, openSessions: 1, checkIns: 5, inside: 2, outside: 1, unclear: 1, noReading: 1, handAdded: 1,
    })]);
    expect(usage[0]!.lastSessionAt!.getTime()).toBeGreaterThan(now - 86_400_000);
    expect(await service.listVenueUsage(otherAdmin)).toEqual([]);

    const evidence = await service.venueEvidence(account, venue.id);
    expect(evidence.points).toHaveLength(4);
    expect(evidence.points[0]).toMatchObject({ latitude: 6.5943, accuracyMeters: 11.4 });
    // The 45-day-old session is outside the period, so each course has one.
    expect(evidence.courses.map((course) => [course.courseCode, course.sessions]).sort()).toEqual([['ECE 301', 1], ['ECE 305', 1]]);
    expect(evidence.history.map((change) => [change.kind, change.corners])).toEqual([['updated', null], ['updated', 4], ['updated', null], ['registered', null]]);
    expect(evidence.history[0]!.actorName).toBe('Venue Admin');
    await expect(service.venueEvidence(otherAdmin, venue.id)).rejects.toMatchObject({ statusCode: 404 });
  } finally {
    await client.close();
  }
}, 60_000);
