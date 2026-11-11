import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { courseOfferings } from './academic.js';
import { lecturerProfiles, studentProfiles } from './identity.js';
import { venues } from './venue.js';

export const attendanceSessionStatus = pgEnum('attendance_session_status', ['open', 'closed']);

/** How the student presented the session credential. */
export const attendanceRecordMethod = pgEnum('attendance_record_method', ['code', 'qr_code']);

/**
 * The evaluated outcome of venue evidence for a recorded check-in. Readings
 * that land `outside` are rejected and never recorded; null means the session
 * had no active venue boundary to evaluate (code-credential behavior).
 */
export const attendanceVenueOutcome = pgEnum('attendance_venue_outcome', [
  'within_boundary',
  'inconclusive',
]);

export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    courseOfferingId: uuid('course_offering_id').notNull(),
    lecturerUserId: uuid('lecturer_user_id').notNull(),
    venueId: uuid('venue_id'),
    title: varchar('title', { length: 160 }).notNull(),
    status: attendanceSessionStatus('status').notNull().default('open'),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    /**
     * Server-held secret for rotating QR challenges. Nullable only because
     * rows pre-dating QR support have none; the API backfills it before first
     * QR use. Never exposed by any read endpoint.
     */
    qrSecret: varchar('qr_secret', { length: 64 }),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'attendance_sessions_offering_institution_fk',
      columns: [table.courseOfferingId, table.institutionId],
      foreignColumns: [courseOfferings.id, courseOfferings.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'attendance_sessions_lecturer_institution_fk',
      columns: [table.lecturerUserId, table.institutionId],
      foreignColumns: [lecturerProfiles.userId, lecturerProfiles.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'attendance_sessions_venue_institution_fk',
      columns: [table.venueId, table.institutionId],
      foreignColumns: [venues.id, venues.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('attendance_sessions_id_institution_uq').on(table.id, table.institutionId),
    uniqueIndex('attendance_sessions_id_tenant_offering_uq').on(
      table.id,
      table.institutionId,
      table.courseOfferingId,
    ),
    uniqueIndex('attendance_sessions_code_hash_uq').on(table.codeHash),
    index('attendance_sessions_offering_started_idx').on(
      table.institutionId,
      table.courseOfferingId,
      table.startsAt,
    ),
    index('attendance_sessions_lecturer_status_idx').on(
      table.institutionId,
      table.lecturerUserId,
      table.status,
    ),
    check('attendance_sessions_time_order_ck', sql`${table.endsAt} > ${table.startsAt}`),
    check(
      'attendance_sessions_closed_at_ck',
      sql`(${table.status} = 'open' AND ${table.closedAt} IS NULL) OR (${table.status} = 'closed' AND ${table.closedAt} IS NOT NULL)`,
    ),
  ],
);

export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    attendanceSessionId: uuid('attendance_session_id').notNull(),
    studentUserId: uuid('student_user_id').notNull(),
    method: attendanceRecordMethod('method').notNull().default('code'),
    venueOutcome: attendanceVenueOutcome('venue_outcome'),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'attendance_records_session_tenant_fk',
      columns: [table.attendanceSessionId, table.institutionId],
      foreignColumns: [attendanceSessions.id, attendanceSessions.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'attendance_records_student_tenant_fk',
      columns: [table.studentUserId, table.institutionId],
      foreignColumns: [studentProfiles.userId, studentProfiles.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('attendance_records_id_institution_uq').on(table.id, table.institutionId),
    uniqueIndex('attendance_records_session_student_uq').on(
      table.attendanceSessionId,
      table.studentUserId,
    ),
    index('attendance_records_student_checked_in_idx').on(
      table.institutionId,
      table.studentUserId,
      table.checkedInAt,
    ),
    index('attendance_records_session_checked_in_idx').on(
      table.institutionId,
      table.attendanceSessionId,
      table.checkedInAt,
    ),
  ],
);

/**
 * Location evidence submitted for a recorded check-in, stored separately from
 * the attendance decision per the verification model: the raw reading, its
 * measured uncertainty and capture time, and the evaluated outcome are
 * evidence with scoped access — the record's venue_outcome is the decision
 * summary. At most one evidence row exists per attendance record, and only
 * for records with a non-null venue_outcome (enforced by the service layer).
 */
export const attendanceCheckInEvidence = pgTable(
  'attendance_check_in_evidence',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    attendanceRecordId: uuid('attendance_record_id').notNull(),
    studentUserId: uuid('student_user_id').notNull(),
    latitude: numeric('latitude', { precision: 10, scale: 7 }).notNull(),
    longitude: numeric('longitude', { precision: 11, scale: 7 }).notNull(),
    /** Device-reported horizontal accuracy (68% confidence radius). */
    accuracyMeters: numeric('accuracy_meters', { precision: 8, scale: 2 }),
    /** When the device produced the reading (client-reported). */
    capturedAt: timestamp('captured_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Evaluated distance between the reading and the venue center. */
    distanceMeters: numeric('distance_meters', { precision: 10, scale: 2 }).notNull(),
    /** The venue boundary radius in force at evaluation time. */
    radiusMeters: integer('radius_meters').notNull(),
    outcome: attendanceVenueOutcome('outcome').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'attendance_evidence_record_tenant_fk',
      columns: [table.attendanceRecordId, table.institutionId],
      foreignColumns: [attendanceRecords.id, attendanceRecords.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'attendance_evidence_student_tenant_fk',
      columns: [table.studentUserId, table.institutionId],
      foreignColumns: [studentProfiles.userId, studentProfiles.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('attendance_evidence_record_uq').on(table.attendanceRecordId),
    index('attendance_evidence_record_idx').on(table.institutionId, table.attendanceRecordId),
    check(
      'attendance_evidence_coordinate_range_ck',
      sql`${table.latitude} BETWEEN -90 AND 90 AND ${table.longitude} BETWEEN -180 AND 180`,
    ),
    check(
      'attendance_evidence_accuracy_ck',
      sql`${table.accuracyMeters} IS NULL OR ${table.accuracyMeters} BETWEEN 0 AND 2000`,
    ),
  ],
);
