import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  smallint,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { departments, institutions } from './institution.js';
import { lecturerProfiles, studentProfiles, users } from './identity.js';

export const enrollmentStatus = pgEnum('enrollment_status', ['active', 'withdrawn', 'completed']);
export const courseAssignmentType = pgEnum('course_assignment_type', ['lecturer', 'coordinator']);

export const academicSessions = pgTable(
  'academic_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    code: varchar('code', { length: 32 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),
    isCurrent: boolean('is_current').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('academic_sessions_institution_code_uq').on(table.institutionId, table.code),
    uniqueIndex('academic_sessions_id_institution_uq').on(table.id, table.institutionId),
    index('academic_sessions_institution_idx').on(table.institutionId, table.startsAt),
    uniqueIndex('academic_sessions_one_current_per_institution_uq')
      .on(table.institutionId)
      .where(sql`${table.isCurrent} = true`),
    check('academic_sessions_date_order_ck', sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const semesters = pgTable(
  'semesters',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    academicSessionId: uuid('academic_session_id').notNull(),
    name: varchar('name', { length: 80 }).notNull(),
    startsAt: timestamp('starts_at', { withTimezone: true, mode: 'date' }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true, mode: 'date' }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'semesters_session_institution_fk',
      columns: [table.academicSessionId, table.institutionId],
      foreignColumns: [academicSessions.id, academicSessions.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('semesters_session_name_uq').on(table.academicSessionId, table.name),
    uniqueIndex('semesters_id_institution_uq').on(table.id, table.institutionId),
    index('semesters_session_dates_idx').on(table.institutionId, table.academicSessionId, table.startsAt),
    check('semesters_date_order_ck', sql`${table.endsAt} > ${table.startsAt}`),
  ],
);

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    code: varchar('code', { length: 32 }).notNull(),
    title: varchar('title', { length: 200 }).notNull(),
    creditUnits: smallint('credit_units').notNull(),
    /**
     * Who added the course from the lecture course picker (null for courses an
     * administrator set up with the course tools, or whose adder was removed).
     */
    addedByUserId: uuid('added_by_user_id').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('courses_institution_code_lower_uq')
      .on(table.institutionId, sql`lower(${table.code})`),
    uniqueIndex('courses_id_institution_uq').on(table.id, table.institutionId),
    index('courses_institution_title_idx').on(table.institutionId, table.title),
    check('courses_credit_units_ck', sql`${table.creditUnits} BETWEEN 0 AND 30`),
  ],
);

export const courseOfferings = pgTable(
  'course_offerings',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    courseId: uuid('course_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    semesterId: uuid('semester_id').notNull(),
    level: varchar('level', { length: 32 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'course_offerings_course_institution_fk',
      columns: [table.courseId, table.institutionId],
      foreignColumns: [courses.id, courses.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'course_offerings_department_institution_fk',
      columns: [table.departmentId, table.institutionId],
      foreignColumns: [departments.id, departments.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'course_offerings_semester_institution_fk',
      columns: [table.semesterId, table.institutionId],
      foreignColumns: [semesters.id, semesters.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('course_offerings_course_department_semester_level_uq').on(
      table.courseId,
      table.departmentId,
      table.semesterId,
      table.level,
    ),
    uniqueIndex('course_offerings_id_institution_uq').on(table.id, table.institutionId),
    index('course_offerings_department_semester_idx').on(
      table.institutionId,
      table.departmentId,
      table.semesterId,
    ),
    index('course_offerings_course_semester_idx').on(
      table.institutionId,
      table.courseId,
      table.semesterId,
    ),
  ],
);

export const courseEnrollments = pgTable(
  'course_enrollments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    courseOfferingId: uuid('course_offering_id').notNull(),
    studentUserId: uuid('student_user_id').notNull(),
    status: enrollmentStatus('status').notNull().default('active'),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'course_enrollments_offering_institution_fk',
      columns: [table.courseOfferingId, table.institutionId],
      foreignColumns: [courseOfferings.id, courseOfferings.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'course_enrollments_student_institution_fk',
      columns: [table.studentUserId, table.institutionId],
      foreignColumns: [studentProfiles.userId, studentProfiles.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('course_enrollments_offering_student_uq').on(
      table.courseOfferingId,
      table.studentUserId,
    ),
    index('course_enrollments_student_status_idx').on(
      table.institutionId,
      table.studentUserId,
      table.status,
    ),
    index('course_enrollments_offering_status_idx').on(
      table.institutionId,
      table.courseOfferingId,
      table.status,
    ),
  ],
);

export const courseAssignments = pgTable(
  'course_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    courseOfferingId: uuid('course_offering_id').notNull(),
    lecturerUserId: uuid('lecturer_user_id').notNull(),
    assignmentType: courseAssignmentType('assignment_type').notNull().default('lecturer'),
    assignedAt: timestamp('assigned_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'course_assignments_offering_institution_fk',
      columns: [table.courseOfferingId, table.institutionId],
      foreignColumns: [courseOfferings.id, courseOfferings.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'course_assignments_lecturer_institution_fk',
      columns: [table.lecturerUserId, table.institutionId],
      foreignColumns: [lecturerProfiles.userId, lecturerProfiles.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('course_assignments_offering_lecturer_type_uq').on(
      table.courseOfferingId,
      table.lecturerUserId,
      table.assignmentType,
    ),
    index('course_assignments_lecturer_idx').on(
      table.institutionId,
      table.lecturerUserId,
      table.courseOfferingId,
    ),
  ],
);

export const courseEnrollmentCodes = pgTable(
  'course_enrollment_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    courseOfferingId: uuid('course_offering_id').notNull(),
    lecturerUserId: uuid('lecturer_user_id').notNull(),
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'course_enrollment_codes_offering_institution_fk',
      columns: [table.courseOfferingId, table.institutionId],
      foreignColumns: [courseOfferings.id, courseOfferings.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'course_enrollment_codes_lecturer_institution_fk',
      columns: [table.lecturerUserId, table.institutionId],
      foreignColumns: [lecturerProfiles.userId, lecturerProfiles.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('course_enrollment_codes_code_hash_uq').on(table.codeHash),
    uniqueIndex('course_enrollment_codes_one_unrevoked_per_offering_uq')
      .on(table.courseOfferingId)
      .where(sql`${table.revokedAt} IS NULL`),
    index('course_enrollment_codes_offering_created_idx').on(
      table.institutionId,
      table.courseOfferingId,
      table.createdAt,
    ),
    index('course_enrollment_codes_expiry_idx').on(table.expiresAt),
    check('course_enrollment_codes_expiry_ck', sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);
