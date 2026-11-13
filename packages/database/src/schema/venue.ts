import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { campuses, institutions } from './institution.js';
import { users } from './identity.js';

/**
 * Venue and geofence domain. Coordinates are registered on site by an
 * authorized administrator and only become an active attendance boundary
 * after explicit confirmation; every location change is audited in
 * venue_location_events. Circular geofences ship first; the `kind` column
 * leaves room for polygon boundaries without a redesign.
 */

export const venueTypeEnum = pgEnum('venue_type', [
  'lecture_theatre',
  'classroom',
  'laboratory',
  'hall',
  'seminar_room',
  'workshop',
  'outdoor',
  'other',
]);

export const venueStatusEnum = pgEnum('venue_status', [
  'pending_review',
  'active',
  'inactive',
]);

export const geofenceKindEnum = pgEnum('geofence_kind', ['circle']);

export const venueLocationEventKindEnum = pgEnum('venue_location_event_kind', [
  'registered',
  'updated',
  'cleared',
]);

export const buildings = pgTable(
  'buildings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    campusId: uuid('campus_id').notNull(),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'buildings_campus_institution_fk',
      columns: [table.campusId, table.institutionId],
      foreignColumns: [campuses.id, campuses.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('buildings_campus_code_uq').on(table.campusId, table.code),
    uniqueIndex('buildings_id_institution_uq').on(table.id, table.institutionId),
    index('buildings_institution_idx').on(table.institutionId, table.isActive),
  ],
);

export const venues = pgTable(
  'venues',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    campusId: uuid('campus_id').notNull(),
    buildingId: uuid('building_id'),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    venueType: venueTypeEnum('venue_type').notNull(),
    floorLabel: varchar('floor_label', { length: 40 }),
    sectionLabel: varchar('section_label', { length: 80 }),
    capacity: integer('capacity'),
    status: venueStatusEnum('status').notNull().default('pending_review'),
    latitude: numeric('latitude', { precision: 10, scale: 7, mode: 'number' }),
    longitude: numeric('longitude', { precision: 11, scale: 7, mode: 'number' }),
    geofenceKind: geofenceKindEnum('geofence_kind').notNull().default('circle'),
    /**
     * For a circle: the radius around latitude/longitude. For an outline: the
     * distance from its centre to the furthest corner (so older readers that
     * only know circles still cover the whole building).
     */
    geofenceRadiusMeters: integer('geofence_radius_meters'),
    /**
     * The building's footprint as [{ latitude, longitude }, …] in order around
     * it. When set, the venue is this outline (latitude/longitude hold its
     * centre); when null, the venue is the circle.
     */
    geofenceOutline: jsonb('geofence_outline').$type<{ latitude: number; longitude: number }[]>(),
    /** How far outside the shape a phone reading may land and still count, in metres. */
    geofenceAllowanceMeters: integer('geofence_allowance_meters').notNull().default(0),
    /** Accuracy of the GPS measurement taken at the venue when it was registered. */
    locationAccuracyMeters: numeric('location_accuracy_meters', { precision: 8, scale: 2, mode: 'number' }),
    /** Number of GPS readings averaged for that measurement. */
    locationSampleCount: integer('location_sample_count'),
    locationRequired: boolean('location_required').notNull().default(true),
    locationRegisteredByUserId: uuid('location_registered_by_user_id'),
    locationRegisteredAt: timestamp('location_registered_at', { withTimezone: true, mode: 'date' }),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'venues_campus_institution_fk',
      columns: [table.campusId, table.institutionId],
      foreignColumns: [campuses.id, campuses.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'venues_building_institution_fk',
      columns: [table.buildingId, table.institutionId],
      foreignColumns: [buildings.id, buildings.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'venues_location_registrar_fk',
      columns: [table.locationRegisteredByUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('venues_campus_code_uq').on(table.campusId, table.code),
    uniqueIndex('venues_id_institution_uq').on(table.id, table.institutionId),
    index('venues_institution_status_idx').on(table.institutionId, table.status),
    index('venues_campus_idx').on(table.campusId),
    check('venues_latitude_range_ck', sql`${table.latitude} IS NULL OR ${table.latitude} BETWEEN -90 AND 90`),
    check('venues_longitude_range_ck', sql`${table.longitude} IS NULL OR ${table.longitude} BETWEEN -180 AND 180`),
    check('venues_geofence_radius_range_ck', sql`${table.geofenceRadiusMeters} IS NULL OR ${table.geofenceRadiusMeters} BETWEEN 5 AND 2000`),
    check('venues_geofence_allowance_range_ck', sql`${table.geofenceAllowanceMeters} BETWEEN 0 AND 100`),
    check(
      'venues_geofence_outline_shape_ck',
      sql`${table.geofenceOutline} IS NULL OR CASE WHEN jsonb_typeof(${table.geofenceOutline}) = 'array' THEN jsonb_array_length(${table.geofenceOutline}) BETWEEN 3 AND 24 ELSE false END`,
    ),
    check('venues_location_sample_count_ck', sql`${table.locationSampleCount} IS NULL OR ${table.locationSampleCount} BETWEEN 1 AND 10000`),
    check(
      'venues_active_location_ck',
      sql`${table.status} <> 'active' OR (${table.latitude} IS NOT NULL AND ${table.longitude} IS NOT NULL AND ${table.geofenceRadiusMeters} IS NOT NULL AND ${table.locationRegisteredByUserId} IS NOT NULL)`,
    ),
  ],
);

export const venueLocationEvents = pgTable(
  'venue_location_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    venueId: uuid('venue_id').notNull(),
    kind: venueLocationEventKindEnum('kind').notNull(),
    latitude: numeric('latitude', { precision: 10, scale: 7, mode: 'number' }),
    longitude: numeric('longitude', { precision: 11, scale: 7, mode: 'number' }),
    reportedAccuracyMeters: numeric('reported_accuracy_meters', { precision: 8, scale: 2, mode: 'number' }),
    geofenceRadiusMeters: integer('geofence_radius_meters'),
    geofenceOutline: jsonb('geofence_outline').$type<{ latitude: number; longitude: number }[]>(),
    geofenceAllowanceMeters: integer('geofence_allowance_meters'),
    sampleCount: integer('sample_count'),
    actorUserId: uuid('actor_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'venue_location_events_venue_institution_fk',
      columns: [table.venueId, table.institutionId],
      foreignColumns: [venues.id, venues.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'venue_location_events_actor_institution_fk',
      columns: [table.actorUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    index('venue_location_events_venue_idx').on(table.venueId, table.createdAt),
    check('venue_location_events_latitude_range_ck', sql`${table.latitude} IS NULL OR ${table.latitude} BETWEEN -90 AND 90`),
    check('venue_location_events_longitude_range_ck', sql`${table.longitude} IS NULL OR ${table.longitude} BETWEEN -180 AND 180`),
  ],
);
