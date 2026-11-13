import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { departments, faculties, institutions } from './institution.js';
import { users } from './identity.js';

/** Roles that can be granted through a staff invitation. Students self-register; system roles are never invitable. */
export const staffInvitationRole = pgEnum('staff_invitation_role', [
  'lecturer',
  'department_administrator',
  'faculty_administrator',
  'institution_administrator',
]);

export const staffAuditAction = pgEnum('staff_audit_action', [
  'invitation_created',
  'invitation_resent',
  'invitation_revoked',
  'invitation_accepted',
  'staff_suspended',
  'staff_reactivated',
  'staff_updated',
]);

/**
 * An emailed, single-use invitation to create a lecturer or administrator
 * account. Only the SHA-256 digest of the token is stored. Accepting creates
 * the user, profile and role assignment in one transaction.
 */
export const staffInvitations = pgTable(
  'staff_invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull().references(() => institutions.id, { onDelete: 'restrict' }),
    email: varchar('email', { length: 320 }).notNull(),
    displayName: varchar('display_name', { length: 160 }).notNull(),
    role: staffInvitationRole('role').notNull(),
    facultyId: uuid('faculty_id'),
    departmentId: uuid('department_id'),
    staffNumber: varchar('staff_number', { length: 64 }),
    tokenHash: varchar('token_hash', { length: 64 }).notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true, mode: 'date' }).notNull(),
    /** Null only for invitations created by the server-side bootstrap command. */
    invitedByUserId: uuid('invited_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    acceptedAt: timestamp('accepted_at', { withTimezone: true, mode: 'date' }),
    acceptedUserId: uuid('accepted_user_id').references(() => users.id, { onDelete: 'restrict' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'date' }),
    revokedByUserId: uuid('revoked_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'staff_invitations_faculty_institution_fk',
      columns: [table.facultyId, table.institutionId],
      foreignColumns: [faculties.id, faculties.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'staff_invitations_department_institution_fk',
      columns: [table.departmentId, table.institutionId],
      foreignColumns: [departments.id, departments.institutionId],
    }).onDelete('restrict'),
    check(
      'staff_invitations_scope_shape_ck',
      sql`(
        (${table.role} = 'institution_administrator' AND ${table.facultyId} IS NULL AND ${table.departmentId} IS NULL)
        OR (${table.role} = 'faculty_administrator' AND ${table.facultyId} IS NOT NULL AND ${table.departmentId} IS NULL)
        OR (${table.role} IN ('department_administrator', 'lecturer') AND ${table.facultyId} IS NULL AND ${table.departmentId} IS NOT NULL)
      )`,
    ),
    check(
      'staff_invitations_staff_number_ck',
      sql`${table.role} = 'lecturer' OR ${table.staffNumber} IS NULL`,
    ),
    check(
      'staff_invitations_outcome_ck',
      sql`NOT (${table.acceptedAt} IS NOT NULL AND ${table.revokedAt} IS NOT NULL)
        AND ((${table.acceptedAt} IS NULL) = (${table.acceptedUserId} IS NULL))`,
    ),
    check('staff_invitations_expiry_ck', sql`${table.expiresAt} > ${table.sentAt}`),
    uniqueIndex('staff_invitations_pending_email_uq')
      .on(table.institutionId, sql`lower(${table.email})`)
      .where(sql`${table.acceptedAt} IS NULL AND ${table.revokedAt} IS NULL`),
    index('staff_invitations_institution_idx').on(table.institutionId, table.createdAt),
  ],
);

/** Append-only record of staff provisioning changes (a trigger rejects UPDATE and DELETE). */
export const staffAuditEvents = pgTable(
  'staff_audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull().references(() => institutions.id, { onDelete: 'restrict' }),
    /** Null when the server-side bootstrap command acted. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    action: staffAuditAction('action').notNull(),
    targetUserId: uuid('target_user_id').references(() => users.id, { onDelete: 'restrict' }),
    invitationId: uuid('invitation_id').references(() => staffInvitations.id, { onDelete: 'restrict' }),
    reason: text('reason'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('staff_audit_events_institution_idx').on(table.institutionId, table.createdAt),
    index('staff_audit_events_target_idx').on(table.targetUserId),
  ],
);

/**
 * Append-only record of changes administrators make to the academic
 * structure (faculties, departments, sessions) and to venues and buildings
 * from the web workspace.
 * `details` holds the before/after values that changed; it never contains
 * personal data.
 */
export const structureAuditEvents = pgTable(
  'structure_audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull().references(() => institutions.id, { onDelete: 'restrict' }),
    actorUserId: uuid('actor_user_id').notNull().references(() => users.id, { onDelete: 'restrict' }),
    action: varchar('action', { length: 48 }).notNull(),
    targetType: varchar('target_type', { length: 24 }).notNull(),
    targetId: uuid('target_id').notNull(),
    details: text('details').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('structure_audit_events_institution_idx').on(table.institutionId, table.createdAt),
    index('structure_audit_events_target_idx').on(table.targetType, table.targetId),
    check('structure_audit_events_target_type_ck', sql`${table.targetType} IN ('faculty', 'department', 'academic_session', 'venue', 'building')`),
  ],
);
