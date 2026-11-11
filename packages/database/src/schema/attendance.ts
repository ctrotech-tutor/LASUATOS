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

/**
 * How the record was created: the student presented the session code or QR
 * challenge, or an assigned lecturer recorded attendance through an audited
 * correction (`manual`).
 */
export const attendanceRecordMethod = pgEnum('attendance_record_method', ['code', 'qr_code', 'manual']);

/**
 * Whether a record currently counts as attendance. Records are never deleted:
 * a lecturer correction marks one `revoked` and every change is written to
 * `attendance_corrections`.
 */
export const attendanceRecordStatus = pgEnum('attendance_record_status', ['present', 'revoked']);

export const attendanceCorrectionAction = pgEnum('attendance_correction_action', ['mark_present', 'revoke']);

/**
 * Student attendance dispute lifecycle. `open` is the only non-terminal state;
 * a database trigger makes resolved/withdrawn disputes immutable.
 */
export const attendanceDisputeStatus = pgEnum('attendance_dispute_status', [
  'open',
  'upheld',
  'rejected',
  'withdrawn',
]);

/**
 * What the student is disputing, derived by the server from the record state
 * at submission: no record at all, or a check-in a lecturer revoked.
 */
export const attendanceDisputeKind = pgEnum('attendance_dispute_kind', [
  'missing_check_in',
  'revoked_check_in',
]);

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
    status: attendanceRecordStatus('status').notNull().default('present'),
    checkedInAt: timestamp('checked_in_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
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
    check(
      'attendance_records_revoked_at_ck',
      sql`(${table.status} = 'present' AND ${table.revokedAt} IS NULL) OR (${table.status} = 'revoked' AND ${table.revokedAt} IS NOT NULL)`,
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

/**
 * A student's request that an assigned lecturer review a session they were
 * not credited for. The statement is the student's own account and is never
 * treated as evidence on its own. Upholding a dispute applies an audited
 * `mark_present` correction in the same transaction. Rows are never deleted,
 * and a trigger only allows the single transition out of `open`.
 */
export const attendanceDisputes = pgTable(
  'attendance_disputes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    courseOfferingId: uuid('course_offering_id').notNull(),
    attendanceSessionId: uuid('attendance_session_id').notNull(),
    studentUserId: uuid('student_user_id').notNull(),
    kind: attendanceDisputeKind('kind').notNull(),
    status: attendanceDisputeStatus('status').notNull().default('open'),
    statement: varchar('statement', { length: 1000 }).notNull(),
    resolutionNote: varchar('resolution_note', { length: 500 }),
    resolvedByUserId: uuid('resolved_by_user_id'),
    resolvedAt: timestamp('resolved_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'attendance_disputes_session_tenant_offering_fk',
      columns: [table.attendanceSessionId, table.institutionId, table.courseOfferingId],
      foreignColumns: [attendanceSessions.id, attendanceSessions.institutionId, attendanceSessions.courseOfferingId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'attendance_disputes_student_tenant_fk',
      columns: [table.studentUserId, table.institutionId],
      foreignColumns: [studentProfiles.userId, studentProfiles.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'attendance_disputes_resolver_tenant_fk',
      columns: [table.resolvedByUserId, table.institutionId],
      foreignColumns: [lecturerProfiles.userId, lecturerProfiles.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('attendance_disputes_id_institution_uq').on(table.id, table.institutionId),
    /** At most one open dispute per student and session. */
    uniqueIndex('attendance_disputes_one_open_uq')
      .on(table.attendanceSessionId, table.studentUserId)
      .where(sql`${table.status} = 'open'`),
    index('attendance_disputes_offering_status_idx').on(
      table.institutionId,
      table.courseOfferingId,
      table.status,
      table.createdAt,
    ),
    index('attendance_disputes_student_created_idx').on(
      table.institutionId,
      table.studentUserId,
      table.createdAt,
    ),
    check('attendance_disputes_statement_length_ck', sql`char_length(btrim(${table.statement})) >= 20`),
    check(
      'attendance_disputes_resolution_ck',
      sql`(${table.status} = 'open' AND ${table.resolvedAt} IS NULL AND ${table.resolvedByUserId} IS NULL AND ${table.resolutionNote} IS NULL)
        OR (${table.status} = 'withdrawn' AND ${table.resolvedAt} IS NOT NULL AND ${table.resolvedByUserId} IS NULL)
        OR (${table.status} IN ('upheld', 'rejected') AND ${table.resolvedAt} IS NOT NULL AND ${table.resolvedByUserId} IS NOT NULL
            AND ${table.resolutionNote} IS NOT NULL AND char_length(btrim(${table.resolutionNote})) >= 10)`,
    ),
  ],
);

/**
 * Append-only audit trail of lecturer attendance corrections. Each row records
 * who changed which record, the state before and after, and the mandatory
 * reason. A database trigger rejects UPDATE and DELETE on this table.
 */
export const attendanceCorrections = pgTable(
  'attendance_corrections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    attendanceSessionId: uuid('attendance_session_id').notNull(),
    attendanceRecordId: uuid('attendance_record_id').notNull(),
    studentUserId: uuid('student_user_id').notNull(),
    actorUserId: uuid('actor_user_id').notNull(),
    action: attendanceCorrectionAction('action').notNull(),
    /** Null when the correction created the record. */
    previousStatus: attendanceRecordStatus('previous_status'),
    resultingStatus: attendanceRecordStatus('resulting_status').notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    /** Set when the correction was applied by upholding a student dispute. */
    disputeId: uuid('dispute_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'attendance_corrections_dispute_tenant_fk',
      columns: [table.disputeId, table.institutionId],
      foreignColumns: [attendanceDisputes.id, attendanceDisputes.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'attendance_corrections_session_tenant_fk',
      columns: [table.attendanceSessionId, table.institutionId],
      foreignColumns: [attendanceSessions.id, attendanceSessions.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'attendance_corrections_record_tenant_fk',
      columns: [table.attendanceRecordId, table.institutionId],
      foreignColumns: [attendanceRecords.id, attendanceRecords.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'attendance_corrections_student_tenant_fk',
      columns: [table.studentUserId, table.institutionId],
      foreignColumns: [studentProfiles.userId, studentProfiles.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'attendance_corrections_actor_tenant_fk',
      columns: [table.actorUserId, table.institutionId],
      foreignColumns: [lecturerProfiles.userId, lecturerProfiles.institutionId],
    }).onDelete('restrict'),
    index('attendance_corrections_session_created_idx').on(
      table.institutionId,
      table.attendanceSessionId,
      table.createdAt,
    ),
    index('attendance_corrections_record_idx').on(table.institutionId, table.attendanceRecordId),
    check('attendance_corrections_reason_length_ck', sql`char_length(btrim(${table.reason})) >= 10`),
    check(
      'attendance_corrections_status_change_ck',
      sql`${table.previousStatus} IS DISTINCT FROM ${table.resultingStatus}`,
    ),
  ],
);
