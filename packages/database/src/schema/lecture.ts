import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { departments, faculties, institutions } from './institution.js';
import { users } from './identity.js';
import { venues } from './venue.js';

/**
 * Class representatives. A HOC (head of class) represents one department's
 * academic set; a GHOC (general head of class) represents a whole faculty's
 * set. Both are students who may take attendance; a GHOC may also appoint
 * the HOCs of their faculty and set.
 */
export const classRepRole = pgEnum('class_rep_role', ['ghoc', 'hoc']);

export const classRepresentatives = pgTable(
  'class_representatives',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    studentUserId: uuid('student_user_id').notNull(),
    role: classRepRole('role').notNull(),
    facultyId: uuid('faculty_id').notNull(),
    /** Set for a HOC; null for a GHOC, who covers the whole faculty. */
    departmentId: uuid('department_id'),
    /** The academic set, by the calendar year it entered (2022 = the 2022/2023 set). */
    entryYear: smallint('entry_year').notNull(),
    appointedByUserId: uuid('appointed_by_user_id').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedByUserId: uuid('revoked_by_user_id'),
  },
  (table) => [
    foreignKey({
      name: 'class_representatives_student_fk',
      columns: [table.studentUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'class_representatives_faculty_fk',
      columns: [table.facultyId, table.institutionId],
      foreignColumns: [faculties.id, faculties.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'class_representatives_department_fk',
      columns: [table.departmentId, table.institutionId],
      foreignColumns: [departments.id, departments.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'class_representatives_appointed_by_fk',
      columns: [table.appointedByUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'class_representatives_revoked_by_fk',
      columns: [table.revokedByUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    check(
      'class_representatives_scope_ck',
      sql`(${table.role} = 'hoc' AND ${table.departmentId} IS NOT NULL) OR (${table.role} = 'ghoc' AND ${table.departmentId} IS NULL)`,
    ),
    check('class_representatives_entry_year_ck', sql`${table.entryYear} BETWEEN 1950 AND 2200`),
    // A student holds at most one live appointment.
    uniqueIndex('class_representatives_student_active_uq')
      .on(table.studentUserId)
      .where(sql`${table.revokedAt} IS NULL`),
    index('class_representatives_scope_idx').on(table.institutionId, table.facultyId, table.entryYear),
  ],
);

export const lectureQrMode = pgEnum('lecture_qr_mode', ['dynamic', 'static']);

/**
 * A lecture attendance session opened by a lecturer, an administrator or a
 * class representative. It only needs a course code and title: no course
 * offering or enrollment list, so any student with the QR code or session
 * code can mark attendance during the time window, with or without an
 * account.
 */
export const lectureSessions = pgTable(
  'lecture_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    createdByUserId: uuid('created_by_user_id').notNull(),
    creatorRole: varchar('creator_role', { length: 24 }).notNull(),
    courseCode: varchar('course_code', { length: 32 }).notNull(),
    courseTitle: varchar('course_title', { length: 200 }).notNull(),
    lecturerName: varchar('lecturer_name', { length: 160 }),
    facultyId: uuid('faculty_id'),
    departmentId: uuid('department_id'),
    entryYear: smallint('entry_year'),
    venueId: uuid('venue_id'),
    /** When true, a check-in needs a location reading that is not clearly outside the venue. */
    requireVenue: boolean('require_venue').notNull().default(false),
    qrMode: lectureQrMode('qr_mode').notNull(),
    /** Server-only key for rotating QR challenges and check-in tickets. */
    secret: varchar('secret', { length: 64 }).notNull(),
    /** Fixed code printed on a static QR poster and typed by students. */
    publicCode: varchar('public_code', { length: 16 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),
    closedAt: timestamp('closed_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'lecture_sessions_creator_fk',
      columns: [table.createdByUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lecture_sessions_faculty_fk',
      columns: [table.facultyId, table.institutionId],
      foreignColumns: [faculties.id, faculties.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lecture_sessions_department_fk',
      columns: [table.departmentId, table.institutionId],
      foreignColumns: [departments.id, departments.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lecture_sessions_venue_fk',
      columns: [table.venueId, table.institutionId],
      foreignColumns: [venues.id, venues.institutionId],
    }).onDelete('restrict'),
    check('lecture_sessions_window_ck', sql`${table.endsAt} > ${table.startsAt}`),
    check('lecture_sessions_creator_role_ck', sql`${table.creatorRole} IN ('lecturer', 'administrator', 'ghoc', 'hoc')`),
    check('lecture_sessions_require_venue_ck', sql`NOT ${table.requireVenue} OR ${table.venueId} IS NOT NULL`),
    uniqueIndex('lecture_sessions_public_code_uq').on(table.publicCode),
    uniqueIndex('lecture_sessions_id_institution_uq').on(table.id, table.institutionId),
    index('lecture_sessions_creator_idx').on(table.createdByUserId, table.startsAt),
    index('lecture_sessions_institution_idx').on(table.institutionId, table.startsAt),
    index('lecture_sessions_open_idx').on(table.endsAt).where(sql`${table.closedAt} IS NULL`),
  ],
);

/**
 * One student marked present at a lecture session. A signed-in student is
 * linked by user id; a student without an account is identified by the name
 * and matric number they typed, which is a claim, not proof.
 */
export const lectureAttendance = pgTable(
  'lecture_attendance',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    lectureSessionId: uuid('lecture_session_id').notNull(),
    studentUserId: uuid('student_user_id'),
    fullName: varchar('full_name', { length: 160 }).notNull(),
    /** Normalised: upper case, no spaces. */
    matricNumber: varchar('matric_number', { length: 32 }).notNull(),
    method: varchar('method', { length: 8 }).notNull(),
    /** sha256(sessionId:deviceToken): spots one phone marking several students. */
    deviceHash: varchar('device_hash', { length: 64 }),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 11, scale: 7 }),
    accuracyMeters: numeric('accuracy_meters', { precision: 8, scale: 2 }),
    /** Distance from the venue's centre. */
    distanceMeters: numeric('distance_meters', { precision: 10, scale: 2 }),
    /** Distance outside the venue's shape (0 = inside the walls), before the allowance. */
    outsideMeters: numeric('outside_meters', { precision: 10, scale: 2 }),
    /** Phone readings combined into the submitted position. */
    locationSamples: integer('location_samples'),
    venueOutcome: varchar('venue_outcome', { length: 16 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    removedAt: timestamp('removed_at', { withTimezone: true, mode: 'date' }),
    removedByUserId: uuid('removed_by_user_id'),
    removedReason: varchar('removed_reason', { length: 300 }),
    /** Set when the session taker added the student by hand (method 'manual'). */
    addedByUserId: uuid('added_by_user_id'),
    /** Face match score (cosine, SFace) of the check-in; null when no face check applied. */
    faceScore: numeric('face_score', { precision: 5, scale: 4 }),
  },
  (table) => [
    foreignKey({
      name: 'lecture_attendance_session_fk',
      columns: [table.lectureSessionId, table.institutionId],
      foreignColumns: [lectureSessions.id, lectureSessions.institutionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'lecture_attendance_student_fk',
      columns: [table.studentUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lecture_attendance_removed_by_fk',
      columns: [table.removedByUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lecture_attendance_added_by_fk',
      columns: [table.addedByUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    check('lecture_attendance_method_ck', sql`${table.method} IN ('qr', 'code', 'manual')`),
    check('lecture_attendance_manual_by_ck', sql`(${table.method} = 'manual') = (${table.addedByUserId} IS NOT NULL)`),
    check(
      'lecture_attendance_venue_outcome_ck',
      sql`${table.venueOutcome} IS NULL OR ${table.venueOutcome} IN ('within', 'outside', 'inconclusive', 'unavailable')`,
    ),
    uniqueIndex('lecture_attendance_session_matric_uq').on(table.lectureSessionId, table.matricNumber),
    index('lecture_attendance_session_idx').on(table.lectureSessionId, table.createdAt),
    index('lecture_attendance_student_idx').on(table.studentUserId),
    index('lecture_attendance_matric_idx').on(table.institutionId, table.matricNumber),
  ],
);
