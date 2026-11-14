import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';
import { departments, institutions } from './institution.js';
import { users } from './identity.js';
import { lectureSessions } from './lecture.js';

/** Raw bytes (JPEG photos). */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * The class list: every student of a department's set, as the HOC (or an
 * administrator) supplied it. It is the source of truth for who a student
 * is: an account can only be opened for a matric number on the list, and the
 * name on the list is the name on every register.
 */
export const classListEntries = pgTable(
  'class_list_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull().references(() => institutions.id, { onDelete: 'restrict' }),
    departmentId: uuid('department_id').notNull(),
    /** Normalised: digits and letters only, upper case. */
    matricNumber: varchar('matric_number', { length: 32 }).notNull(),
    surname: varchar('surname', { length: 80 }).notNull(),
    firstName: varchar('first_name', { length: 80 }).notNull(),
    /** Optional: many students have none, some have several. */
    middleName: varchar('middle_name', { length: 120 }),
    /** The student's LASU address (…@st.lasu.edu.ng), lower case, when the HOC had it. */
    lasuEmail: varchar('lasu_email', { length: 320 }),
    /** The academic set (2024 = the 2024/2025 set) the list was uploaded for. */
    entryYear: smallint('entry_year').notNull(),
    /** 100 for UTME, 200 or 300 for Direct Entry. */
    entryLevel: smallint('entry_level').notNull().default(100),
    /** The account opened from (or matched to) this entry. */
    studentUserId: uuid('student_user_id'),
    addedByUserId: uuid('added_by_user_id').notNull(),
    updatedByUserId: uuid('updated_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'class_list_entries_department_fk',
      columns: [table.departmentId, table.institutionId],
      foreignColumns: [departments.id, departments.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'class_list_entries_student_fk',
      columns: [table.studentUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'class_list_entries_added_by_fk',
      columns: [table.addedByUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'class_list_entries_updated_by_fk',
      columns: [table.updatedByUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('class_list_entries_matric_uq').on(table.institutionId, table.matricNumber),
    uniqueIndex('class_list_entries_email_uq')
      .on(table.institutionId, sql`lower(${table.lasuEmail})`)
      .where(sql`${table.lasuEmail} IS NOT NULL`),
    uniqueIndex('class_list_entries_student_uq')
      .on(table.studentUserId)
      .where(sql`${table.studentUserId} IS NOT NULL`),
    index('class_list_entries_scope_idx').on(table.institutionId, table.departmentId, table.entryYear),
    check('class_list_entries_entry_level_ck', sql`${table.entryLevel} IN (100, 200, 300)`),
    check('class_list_entries_entry_year_ck', sql`${table.entryYear} BETWEEN 1950 AND 2200`),
  ],
);

/**
 * A six-digit code sent to a student's LASU address to prove it is theirs,
 * one live code per class-list entry. It works before an account exists
 * (opening an account) and after (an older account moving to its LASU
 * address).
 */
export const studentEmailCodes = pgTable(
  'student_email_codes',
  {
    classListEntryId: uuid('class_list_entry_id')
      .primaryKey()
      .references(() => classListEntries.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 320 }).notNull(),
    /** sha256(entryId:email:code); the code itself is never stored. */
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    /** Wrong guesses at this code; it is spent after five. */
    attempts: smallint('attempts').notNull().default(0),
    /** Codes sent since `window_started_at` (a daily cap). */
    sendCount: smallint('send_count').notNull().default(1),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true, mode: 'date' }).notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true, mode: 'date' }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true, mode: 'date' }).notNull(),
  },
);

/**
 * A student's registered face: SFace signatures of the photos taken at
 * registration (front, left, right) and one small portrait the student's HOC
 * can recognise. Signatures cannot be turned back into a photo.
 */
export const studentFaceProfiles = pgTable(
  'student_face_profiles',
  {
    userId: uuid('user_id').primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    /** Signature model, e.g. "sface-2021dec". */
    model: varchar('model', { length: 40 }).notNull(),
    /** number[][]: one 128-number signature per registration photo. */
    templates: jsonb('templates').$type<number[][]>().notNull(),
    /** number[]: normalised mean of the front-facing signatures, for duplicate checks. */
    centroid: jsonb('centroid').$type<number[]>().notNull(),
    /** 200 x 250 JPEG. */
    photo: bytea('photo').notNull(),
    /** Measurements at registration (scores only, no images). */
    quality: jsonb('quality').$type<Record<string, number>>().notNull(),
    consentedAt: timestamp('consented_at', { withTimezone: true, mode: 'date' }).notNull(),
    enrolledAt: timestamp('enrolled_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /**
     * Set when the student confirmed (password + emailed code) that they want
     * to take new photos; until then their face cannot be replaced.
     */
    replaceAllowedUntil: timestamp('replace_allowed_until', { withTimezone: true, mode: 'date' }),
  },
  (table) => [
    foreignKey({
      name: 'student_face_profiles_user_fk',
      columns: [table.userId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('cascade'),
    index('student_face_profiles_institution_idx').on(table.institutionId),
  ],
);

/**
 * The face check that went with a student's check-in to a lecture. A photo
 * is kept only when the match was not clear-cut, for the lecturer or an
 * administrator to compare with the registered face.
 */
export const lectureFaceChecks = pgTable(
  'lecture_face_checks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    lectureSessionId: uuid('lecture_session_id').notNull(),
    studentUserId: uuid('student_user_id').notNull(),
    score: numeric('score', { precision: 5, scale: 4 }).notNull(),
    real: numeric('real', { precision: 5, scale: 4 }).notNull(),
    live: numeric('live', { precision: 5, scale: 4 }).notNull(),
    /** True when the match was close to the threshold; `photo` is then kept. */
    needsReview: boolean('needs_review').notNull().default(false),
    photo: bytea('photo'),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /** The reviewer's decision on a close match: 'approved' or 'rejected' (the check-in was then removed). */
    reviewStatus: varchar('review_status', { length: 12 }),
    reviewedByUserId: uuid('reviewed_by_user_id'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true, mode: 'date' }),
    reviewNote: varchar('review_note', { length: 300 }),
  },
  (table) => [
    foreignKey({
      name: 'lecture_face_checks_reviewed_by_fk',
      columns: [table.reviewedByUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    check('lecture_face_checks_review_status_ck', sql`${table.reviewStatus} IS NULL OR ${table.reviewStatus} IN ('approved', 'rejected')`),
    check('lecture_face_checks_review_shape_ck', sql`(${table.reviewStatus} IS NULL) = (${table.reviewedAt} IS NULL)`),
    index('lecture_face_checks_review_idx').on(table.institutionId, table.createdAt).where(sql`${table.needsReview}`),
    foreignKey({
      name: 'lecture_face_checks_session_fk',
      columns: [table.lectureSessionId, table.institutionId],
      foreignColumns: [lectureSessions.id, lectureSessions.institutionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'lecture_face_checks_student_fk',
      columns: [table.studentUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('cascade'),
    uniqueIndex('lecture_face_checks_session_student_uq').on(table.lectureSessionId, table.studentUserId),
  ],
);

/**
 * Append-only record of changes to class lists, student identity and
 * registered faces. `details` describes what changed (field names, counts),
 * never a photo or a face signature.
 */
export const studentAuditEvents = pgTable(
  'student_audit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull().references(() => institutions.id, { onDelete: 'restrict' }),
    /** Null when the student acted on their own account. */
    actorUserId: uuid('actor_user_id').references(() => users.id, { onDelete: 'restrict' }),
    action: varchar('action', { length: 48 }).notNull(),
    subjectUserId: uuid('subject_user_id').references(() => users.id, { onDelete: 'restrict' }),
    matricNumber: varchar('matric_number', { length: 32 }),
    details: text('details').notNull().default(''),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    index('student_audit_events_institution_idx').on(table.institutionId, table.createdAt),
    index('student_audit_events_subject_idx').on(table.subjectUserId),
    index('student_audit_events_matric_idx').on(table.institutionId, table.matricNumber),
  ],
);

/**
 * A student at a lecture whose face check would not pass asks the person
 * taking attendance to add them by hand. The taker sees the request (with
 * the student's registered portrait) on the live session and adds or
 * declines it; adding records an ordinary manual entry by the taker.
 */
export const lectureHelpRequests = pgTable(
  'lecture_help_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id').notNull(),
    lectureSessionId: uuid('lecture_session_id').notNull(),
    studentUserId: uuid('student_user_id').notNull(),
    fullName: varchar('full_name', { length: 160 }).notNull(),
    matricNumber: varchar('matric_number', { length: 32 }).notNull(),
    /** Why the face check failed last (e.g. mismatch, too_dark), from the audit trail. */
    reason: varchar('reason', { length: 48 }).notNull(),
    failures: smallint('failures').notNull().default(0),
    /** pending → added or declined. */
    status: varchar('status', { length: 12 }).notNull().default('pending'),
    venueOutcome: varchar('venue_outcome', { length: 16 }),
    accuracyMeters: numeric('accuracy_meters', { precision: 8, scale: 2 }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    decidedAt: timestamp('decided_at', { withTimezone: true, mode: 'date' }),
    decidedByUserId: uuid('decided_by_user_id'),
  },
  (table) => [
    foreignKey({
      name: 'lecture_help_requests_session_fk',
      columns: [table.lectureSessionId, table.institutionId],
      foreignColumns: [lectureSessions.id, lectureSessions.institutionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'lecture_help_requests_student_fk',
      columns: [table.studentUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('cascade'),
    foreignKey({
      name: 'lecture_help_requests_decided_by_fk',
      columns: [table.decidedByUserId, table.institutionId],
      foreignColumns: [users.id, users.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('lecture_help_requests_session_student_uq').on(table.lectureSessionId, table.studentUserId),
    index('lecture_help_requests_session_idx').on(table.lectureSessionId, table.createdAt),
    check('lecture_help_requests_status_ck', sql`${table.status} IN ('pending', 'added', 'declined')`),
    check('lecture_help_requests_decided_ck', sql`(${table.status} = 'pending') = (${table.decidedAt} IS NULL)`),
  ],
);
