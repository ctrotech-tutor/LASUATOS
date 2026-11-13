import { and, asc, eq, ne } from 'drizzle-orm';
import {
  buildings,
  campuses,
  lecturerProfiles,
  structureAuditEvents,
  userRoleAssignments,
  users,
  venues,
  venueLocationEvents,
  type DatabaseClient,
} from '@lasuatos/database';
import type {
  AdminBuildingRecord,
  AdminCampusRecord,
  AdminVenueRecord,
  CreateBuildingInput,
  CreateBuildingResult,
  CreateVenueInput,
  CreateVenueResult,
  LecturerActiveVenueRecord,
  RegisterVenueLocationInput,
  RegisterVenueLocationResult,
  SetVenueStatusResult,
  UpdateBuildingResult,
  UpdateVenueResult,
  VenueDetailChanges,
  VenueRepository,
} from './repository.js';

type VenueReadExecutor = Pick<DatabaseClient, 'select'>;

type VenueTransaction = Parameters<Parameters<DatabaseClient['transaction']>[0]>[0];

/** Only the fields that actually changed, as {field: [before, after]}. */
function changedFields(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, [unknown, unknown]> {
  const result: Record<string, [unknown, unknown]> = {};
  for (const [key, value] of Object.entries(after)) {
    if (value !== undefined && before[key] !== value) result[key] = [before[key] ?? null, value];
  }
  return result;
}

function venueFields() {
  return {
    id: venues.id,
    campusId: venues.campusId,
    campusName: campuses.name,
    buildingId: venues.buildingId,
    buildingName: buildings.name,
    code: venues.code,
    name: venues.name,
    venueType: venues.venueType,
    floorLabel: venues.floorLabel,
    sectionLabel: venues.sectionLabel,
    capacity: venues.capacity,
    status: venues.status,
    latitude: venues.latitude,
    longitude: venues.longitude,
    geofenceKind: venues.geofenceKind,
    geofenceRadiusMeters: venues.geofenceRadiusMeters,
    locationRequired: venues.locationRequired,
    locationRegisteredAt: venues.locationRegisteredAt,
    createdAt: venues.createdAt,
  };
}

/**
 * Builds the venues-with-campus/building-names read. Never adds `WHERE` here:
 * in Drizzle dynamic mode a second `.where()` **replaces** the first, so the
 * tenant filter must live in the same call as any id filter.
 */
function buildVenueQuery(executor: VenueReadExecutor | VenueTransaction) {
  return executor
    .select(venueFields())
    .from(venues)
    .innerJoin(campuses, and(
      eq(venues.campusId, campuses.id),
      eq(venues.institutionId, campuses.institutionId),
    ))
    .leftJoin(buildings, and(
      eq(venues.buildingId, buildings.id),
      eq(venues.institutionId, buildings.institutionId),
    ))
    .$dynamic();
}

async function readVenue(
  executor: VenueReadExecutor | VenueTransaction,
  institutionId: string,
  venueId: string,
): Promise<AdminVenueRecord | null> {
  const [row] = await buildVenueQuery(executor)
    .where(and(eq(venues.institutionId, institutionId), eq(venues.id, venueId)))
    .limit(1);
  return row ?? null;
}

export class PostgresVenueRepository implements VenueRepository {
  constructor(private readonly database: DatabaseClient) {}

  async listActiveVenuesForLecturer(lecturerUserId: string): Promise<LecturerActiveVenueRecord[]> {
    return this.database
      .select({
        id: venues.id,
        code: venues.code,
        name: venues.name,
        campusName: campuses.name,
        buildingName: buildings.name,
        venueType: venues.venueType,
        geofenceRadiusMeters: venues.geofenceRadiusMeters,
      })
      .from(lecturerProfiles)
      .innerJoin(users, and(
        eq(lecturerProfiles.userId, users.id),
        eq(lecturerProfiles.institutionId, users.institutionId),
      ))
      .innerJoin(userRoleAssignments, and(
        eq(userRoleAssignments.userId, users.id),
        eq(userRoleAssignments.institutionId, users.institutionId),
        eq(userRoleAssignments.role, 'lecturer'),
      ))
      .innerJoin(venues, eq(venues.institutionId, lecturerProfiles.institutionId))
      .innerJoin(campuses, and(
        eq(venues.campusId, campuses.id),
        eq(venues.institutionId, campuses.institutionId),
      ))
      .leftJoin(buildings, and(
        eq(venues.buildingId, buildings.id),
        eq(venues.institutionId, buildings.institutionId),
      ))
      .where(and(
        eq(lecturerProfiles.userId, lecturerUserId),
        eq(users.status, 'active'),
        eq(venues.status, 'active'),
      ))
      .orderBy(asc(venues.name))
      .limit(500);
  }

  async listCampuses(institutionId: string): Promise<AdminCampusRecord[]> {
    return this.database
      .select({
        id: campuses.id,
        code: campuses.code,
        name: campuses.name,
        address: campuses.address,
        latitude: campuses.latitude,
        longitude: campuses.longitude,
        isActive: campuses.isActive,
      })
      .from(campuses)
      .where(eq(campuses.institutionId, institutionId))
      .orderBy(asc(campuses.name))
      .limit(100);
  }

  async listBuildings(institutionId: string): Promise<AdminBuildingRecord[]> {
    return this.database
      .select({
        id: buildings.id,
        campusId: buildings.campusId,
        code: buildings.code,
        name: buildings.name,
        isActive: buildings.isActive,
      })
      .from(buildings)
      .where(eq(buildings.institutionId, institutionId))
      .orderBy(asc(buildings.name))
      .limit(500);
  }

  async createBuilding(input: CreateBuildingInput): Promise<CreateBuildingResult> {
    return this.database.transaction(async (transaction) => {
      const [campus] = await transaction
        .select({ id: campuses.id })
        .from(campuses)
        .where(and(eq(campuses.id, input.campusId), eq(campuses.institutionId, input.institutionId), eq(campuses.isActive, true)))
        .limit(1);
      if (!campus) return { kind: 'campus_missing' };

      const [existing] = await transaction
        .select({ id: buildings.id })
        .from(buildings)
        .where(and(
          eq(buildings.campusId, input.campusId),
          eq(buildings.institutionId, input.institutionId),
          eq(buildings.code, input.code),
        ))
        .limit(1);
      if (existing) return { kind: 'duplicate' };

      const [created] = await transaction
        .insert(buildings)
        .values({
          institutionId: input.institutionId,
          campusId: input.campusId,
          code: input.code,
          name: input.name,
        })
        .returning({
          id: buildings.id,
          campusId: buildings.campusId,
          code: buildings.code,
          name: buildings.name,
          isActive: buildings.isActive,
        });
      if (!created) return { kind: 'campus_missing' };
      return { kind: 'created', building: created };
    });
  }

  async updateBuilding(input: {
    readonly institutionId: string;
    readonly buildingId: string;
    readonly actorUserId: string;
    readonly code?: string | undefined;
    readonly name?: string | undefined;
    readonly now: Date;
  }): Promise<UpdateBuildingResult> {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({ id: buildings.id, campusId: buildings.campusId, code: buildings.code, name: buildings.name, isActive: buildings.isActive })
        .from(buildings)
        .where(and(eq(buildings.id, input.buildingId), eq(buildings.institutionId, input.institutionId)))
        .for('update', { of: buildings })
        .limit(1);
      if (!current) return { kind: 'missing' };
      if (input.code !== undefined && input.code !== current.code) {
        const [clash] = await transaction
          .select({ id: buildings.id })
          .from(buildings)
          .where(and(eq(buildings.campusId, current.campusId), eq(buildings.code, input.code), ne(buildings.id, current.id)))
          .limit(1);
        if (clash) return { kind: 'duplicate' };
      }
      const changes = changedFields(current, { code: input.code, name: input.name });
      if (!Object.keys(changes).length) return { kind: 'updated', building: current };
      const [updated] = await transaction
        .update(buildings)
        .set({
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          updatedAt: input.now,
        })
        .where(eq(buildings.id, current.id))
        .returning({ id: buildings.id, campusId: buildings.campusId, code: buildings.code, name: buildings.name, isActive: buildings.isActive });
      if (!updated) return { kind: 'missing' };
      await transaction.insert(structureAuditEvents).values({
        institutionId: input.institutionId,
        actorUserId: input.actorUserId,
        action: 'building_updated',
        targetType: 'building',
        targetId: current.id,
        details: JSON.stringify(changes),
        createdAt: input.now,
      });
      return { kind: 'updated', building: updated };
    });
  }

  async updateVenue(input: {
    readonly institutionId: string;
    readonly venueId: string;
    readonly actorUserId: string;
    readonly changes: VenueDetailChanges;
    readonly now: Date;
  }): Promise<UpdateVenueResult> {
    return this.database.transaction(async (transaction) => {
      const [current] = await transaction
        .select({
          id: venues.id,
          campusId: venues.campusId,
          buildingId: venues.buildingId,
          code: venues.code,
          name: venues.name,
          venueType: venues.venueType,
          floorLabel: venues.floorLabel,
          sectionLabel: venues.sectionLabel,
          capacity: venues.capacity,
        })
        .from(venues)
        .where(and(eq(venues.id, input.venueId), eq(venues.institutionId, input.institutionId)))
        .for('update', { of: venues })
        .limit(1);
      if (!current) return { kind: 'missing' };
      const { changes } = input;
      if (changes.buildingId && changes.buildingId !== current.buildingId) {
        const [building] = await transaction
          .select({ id: buildings.id })
          .from(buildings)
          .where(and(
            eq(buildings.id, changes.buildingId),
            eq(buildings.institutionId, input.institutionId),
            eq(buildings.campusId, current.campusId),
            eq(buildings.isActive, true),
          ))
          .limit(1);
        if (!building) return { kind: 'building_missing' };
      }
      if (changes.code !== undefined && changes.code !== current.code) {
        const [clash] = await transaction
          .select({ id: venues.id })
          .from(venues)
          .where(and(eq(venues.campusId, current.campusId), eq(venues.code, changes.code), ne(venues.id, current.id)))
          .limit(1);
        if (clash) return { kind: 'duplicate' };
      }
      const diff = changedFields(current, { ...changes });
      if (Object.keys(diff).length) {
        await transaction
          .update(venues)
          .set({
            ...(changes.code !== undefined ? { code: changes.code } : {}),
            ...(changes.name !== undefined ? { name: changes.name } : {}),
            ...(changes.venueType !== undefined ? { venueType: changes.venueType } : {}),
            ...(changes.buildingId !== undefined ? { buildingId: changes.buildingId } : {}),
            ...(changes.floorLabel !== undefined ? { floorLabel: changes.floorLabel } : {}),
            ...(changes.sectionLabel !== undefined ? { sectionLabel: changes.sectionLabel } : {}),
            ...(changes.capacity !== undefined ? { capacity: changes.capacity } : {}),
            updatedAt: input.now,
          })
          .where(eq(venues.id, current.id));
        await transaction.insert(structureAuditEvents).values({
          institutionId: input.institutionId,
          actorUserId: input.actorUserId,
          action: 'venue_updated',
          targetType: 'venue',
          targetId: current.id,
          details: JSON.stringify(diff),
          createdAt: input.now,
        });
      }
      const venue = await readVenue(transaction, input.institutionId, current.id);
      return venue ? { kind: 'updated', venue } : { kind: 'missing' };
    });
  }

  async listVenues(institutionId: string): Promise<AdminVenueRecord[]> {
    return buildVenueQuery(this.database)
      .where(eq(venues.institutionId, institutionId))
      .orderBy(asc(venues.name))
      .limit(500);
  }

  async getVenue(institutionId: string, venueId: string): Promise<AdminVenueRecord | null> {
    return readVenue(this.database, institutionId, venueId);
  }

  async createVenue(input: CreateVenueInput): Promise<CreateVenueResult> {
    return this.database.transaction(async (transaction) => {
      const [campus] = await transaction
        .select({ id: campuses.id })
        .from(campuses)
        .where(and(eq(campuses.id, input.campusId), eq(campuses.institutionId, input.institutionId), eq(campuses.isActive, true)))
        .limit(1);
      if (!campus) return { kind: 'campus_missing' };

      if (input.buildingId) {
        const [building] = await transaction
          .select({ id: buildings.id })
          .from(buildings)
          .where(and(
            eq(buildings.id, input.buildingId),
            eq(buildings.institutionId, input.institutionId),
            eq(buildings.campusId, input.campusId),
            eq(buildings.isActive, true),
          ))
          .limit(1);
        if (!building) return { kind: 'building_missing' };
      }

      const [existing] = await transaction
        .select({ id: venues.id })
        .from(venues)
        .where(and(
          eq(venues.campusId, input.campusId),
          eq(venues.institutionId, input.institutionId),
          eq(venues.code, input.code),
        ))
        .limit(1);
      if (existing) return { kind: 'duplicate' };

      const [created] = await transaction
        .insert(venues)
        .values({
          institutionId: input.institutionId,
          campusId: input.campusId,
          buildingId: input.buildingId,
          code: input.code,
          name: input.name,
          venueType: input.venueType,
          floorLabel: input.floorLabel,
          sectionLabel: input.sectionLabel,
          capacity: input.capacity,
          locationRequired: input.locationRequired,
          notes: input.notes,
        })
        .returning({ id: venues.id });
      if (!created) return { kind: 'campus_missing' };

      const venue = await readVenue(transaction, input.institutionId, created.id);
      if (!venue) return { kind: 'campus_missing' };
      return { kind: 'created', venue };
    });
  }

  async registerVenueLocation(input: RegisterVenueLocationInput): Promise<RegisterVenueLocationResult> {
    return this.database.transaction(async (transaction) => {
      const [venue] = await transaction
        .select({ id: venues.id, latitude: venues.latitude })
        .from(venues)
        .where(and(eq(venues.id, input.venueId), eq(venues.institutionId, input.institutionId)))
        .for('update', { of: venues })
        .limit(1);
      if (!venue) return { kind: 'missing' };

      const [updated] = await transaction
        .update(venues)
        .set({
          latitude: input.latitude,
          longitude: input.longitude,
          geofenceRadiusMeters: input.geofenceRadiusMeters,
          locationRegisteredByUserId: input.actorUserId,
          locationRegisteredAt: input.now,
          updatedAt: input.now,
        })
        .where(and(eq(venues.id, venue.id), eq(venues.institutionId, input.institutionId)))
        .returning({ id: venues.id });
      if (!updated) return { kind: 'missing' };

      await transaction.insert(venueLocationEvents).values({
        institutionId: input.institutionId,
        venueId: venue.id,
        kind: venue.latitude === null ? 'registered' : 'updated',
        latitude: input.latitude,
        longitude: input.longitude,
        reportedAccuracyMeters: input.reportedAccuracyMeters,
        geofenceRadiusMeters: input.geofenceRadiusMeters,
        actorUserId: input.actorUserId,
        createdAt: input.now,
      });

      const record = await readVenue(transaction, input.institutionId, venue.id);
      return record ? { kind: 'registered', venue: record } : { kind: 'missing' };
    });
  }

  async setVenueStatus(input: {
    readonly institutionId: string;
    readonly venueId: string;
    readonly status: 'active' | 'inactive';
    readonly now: Date;
  }): Promise<SetVenueStatusResult> {
    return this.database.transaction(async (transaction) => {
      const [venue] = await transaction
        .select({
          id: venues.id,
          latitude: venues.latitude,
          longitude: venues.longitude,
          geofenceRadiusMeters: venues.geofenceRadiusMeters,
          locationRegisteredByUserId: venues.locationRegisteredByUserId,
        })
        .from(venues)
        .where(and(eq(venues.id, input.venueId), eq(venues.institutionId, input.institutionId)))
        .for('update', { of: venues })
        .limit(1);
      if (!venue) return { kind: 'missing' };

      if (
        input.status === 'active' &&
        (venue.latitude === null || venue.longitude === null ||
          venue.geofenceRadiusMeters === null || venue.locationRegisteredByUserId === null)
      ) {
        return { kind: 'location_required' };
      }

      const [updated] = await transaction
        .update(venues)
        .set({ status: input.status, updatedAt: input.now })
        .where(and(eq(venues.id, venue.id), eq(venues.institutionId, input.institutionId)))
        .returning({ id: venues.id });
      if (!updated) return { kind: 'missing' };
      const record = await readVenue(transaction, input.institutionId, venue.id);
      return record ? { kind: 'updated', venue: record } : { kind: 'missing' };
    });
  }
}
