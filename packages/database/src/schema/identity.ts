import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { departments, faculties, institutions } from './institution.js';

export const accountStatus = pgEnum('account_status', ['invited', 'active', 'suspended', 'closed']);
export const userRole = pgEnum('user_role', [
  'student',
  'lecturer',
  'course_coordinator',
  'department_administrator',
  'faculty_administrator',
  'institution_administrator',
  'system_administrator',
]);
export const roleScopeType = pgEnum('role_scope_type', [
  'system',
  'institution',
  'faculty',
  'department',
]);

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').references(() => institutions.id, { onDelete: 'restrict' }),
    email: varchar('email', { length: 320 }).notNull(),
    displayName: varchar('display_name', { length: 160 }).notNull(),
    passwordHash: text('password_hash'),
    status: accountStatus('status').notNull().default('invited'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_institution_email_lower_uq')
      .on(table.institutionId, sql`lower(${table.email})`)
      .where(sql`${table.institutionId} IS NOT NULL`),
    uniqueIndex('users_platform_email_lower_uq')
      .on(sql`lower(${table.email})`)
      .where(sql`${table.institutionId} IS NULL`),
    uniqueIndex('users_id_institution_uq').on(table.id, table.institutionId),
    index('users_institution_status_idx').on(table.institutionId, table.status),
  ],
);

export const studentProfiles = pgTable(
  'student_profiles',
  {
    userId: uuid('user_id').notNull().primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    studentNumber: varchar('student_number', { length: 64 }).notNull(),
    entryYear: smallint('entry_year'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'student_profiles_user_institution_fk',
      columns: [table.userId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'student_profiles_department_institution_fk',
      columns: [table.departmentId, table.institutionId],
      foreignColumns: [departments.id, departments.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('student_profiles_user_institution_uq').on(table.userId, table.institutionId),
    uniqueIndex('student_profiles_institution_number_uq').on(
      table.institutionId,
      table.studentNumber,
    ),
    index('student_profiles_department_idx').on(table.institutionId, table.departmentId),
  ],
);

export const lecturerProfiles = pgTable(
  'lecturer_profiles',
  {
    userId: uuid('user_id').notNull().primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    departmentId: uuid('department_id').notNull(),
    staffNumber: varchar('staff_number', { length: 64 }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'lecturer_profiles_user_institution_fk',
      columns: [table.userId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'lecturer_profiles_department_institution_fk',
      columns: [table.departmentId, table.institutionId],
      foreignColumns: [departments.id, departments.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('lecturer_profiles_user_institution_uq').on(table.userId, table.institutionId),
    uniqueIndex('lecturer_profiles_institution_number_uq').on(
      table.institutionId,
      table.staffNumber,
    ),
    index('lecturer_profiles_department_idx').on(table.institutionId, table.departmentId),
  ],
);

export const userRoleAssignments = pgTable(
  'user_role_assignments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    role: userRole('role').notNull(),
    scopeType: roleScopeType('scope_type').notNull(),
    institutionId: uuid('institution_id').references(() => institutions.id, { onDelete: 'restrict' }),
    facultyId: uuid('faculty_id'),
    departmentId: uuid('department_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'user_role_assignments_user_institution_fk',
      columns: [table.userId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'user_role_assignments_faculty_institution_fk',
      columns: [table.facultyId, table.institutionId],
      foreignColumns: [faculties.id, faculties.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'user_role_assignments_department_institution_fk',
      columns: [table.departmentId, table.institutionId],
      foreignColumns: [departments.id, departments.institutionId],
    }).onDelete('restrict'),
    check(
      'user_role_assignments_scope_shape_ck',
      sql`(
        (${table.scopeType} = 'system' AND ${table.institutionId} IS NULL AND ${table.facultyId} IS NULL AND ${table.departmentId} IS NULL)
        OR (${table.scopeType} = 'institution' AND ${table.institutionId} IS NOT NULL AND ${table.facultyId} IS NULL AND ${table.departmentId} IS NULL)
        OR (${table.scopeType} = 'faculty' AND ${table.institutionId} IS NOT NULL AND ${table.facultyId} IS NOT NULL AND ${table.departmentId} IS NULL)
        OR (${table.scopeType} = 'department' AND ${table.institutionId} IS NOT NULL AND ${table.facultyId} IS NULL AND ${table.departmentId} IS NOT NULL)
      )`,
    ),
    check(
      'user_role_assignments_role_scope_ck',
      sql`(
        (${table.role} = 'system_administrator' AND ${table.scopeType} = 'system')
        OR (${table.role} = 'institution_administrator' AND ${table.scopeType} = 'institution')
        OR (${table.role} = 'faculty_administrator' AND ${table.scopeType} = 'faculty')
        OR (${table.role} = 'department_administrator' AND ${table.scopeType} = 'department')
        OR (${table.role} IN ('student', 'lecturer', 'course_coordinator') AND ${table.scopeType} IN ('institution', 'faculty', 'department'))
      )`,
    ),
    uniqueIndex('user_role_assignments_system_uq')
      .on(table.userId, table.role)
      .where(sql`${table.scopeType} = 'system'`),
    uniqueIndex('user_role_assignments_institution_uq')
      .on(table.userId, table.role, table.institutionId)
      .where(sql`${table.scopeType} = 'institution'`),
    uniqueIndex('user_role_assignments_faculty_uq')
      .on(table.userId, table.role, table.facultyId)
      .where(sql`${table.scopeType} = 'faculty'`),
    uniqueIndex('user_role_assignments_department_uq')
      .on(table.userId, table.role, table.departmentId)
      .where(sql`${table.scopeType} = 'department'`),
    index('user_role_assignments_user_scope_idx').on(table.userId, table.scopeType),
    index('user_role_assignments_institution_idx').on(table.institutionId),
  ],
);

export const userSessions = pgTable(
  'user_sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('user_sessions_user_expiry_idx').on(table.userId, table.expiresAt),
    index('user_sessions_expiry_idx').on(table.expiresAt),
  ],
);
