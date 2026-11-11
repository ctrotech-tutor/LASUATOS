import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { courseOfferings } from './academic.js';
import { lecturerProfiles, studentProfiles } from './identity.js';

export const attendanceSessionStatus = pgEnum('attendance_session_status', ['open', 'closed']);

export const attendanceSessions = pgTable(
  'attendance_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    courseOfferingId: uuid('course_offering_id').notNull(),
    lecturerUserId: uuid('lecturer_user_id').notNull(),
    title: varchar('title', { length: 160 }).notNull(),
    status: attendanceSessionStatus('status').notNull().default('open'),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
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
