import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

export const institutions = pgTable('institutions', {
  id: uuid('id').defaultRandom().primaryKey(),
  slug: varchar('slug', { length: 80 }).notNull().unique(),
  name: varchar('name', { length: 200 }).notNull(),
  timezone: varchar('timezone', { length: 64 }).notNull().default('Africa/Lagos'),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
});

export const campuses = pgTable(
  'campuses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    address: text('address'),
    latitude: numeric('latitude', { precision: 10, scale: 7, mode: 'number' }),
    longitude: numeric('longitude', { precision: 11, scale: 7, mode: 'number' }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('campuses_institution_code_uq').on(table.institutionId, table.code),
    uniqueIndex('campuses_id_institution_uq').on(table.id, table.institutionId),
    index('campuses_institution_active_idx').on(table.institutionId, table.isActive),
    check('campuses_latitude_range_ck', sql`${table.latitude} IS NULL OR ${table.latitude} BETWEEN -90 AND 90`),
    check('campuses_longitude_range_ck', sql`${table.longitude} IS NULL OR ${table.longitude} BETWEEN -180 AND 180`),
  ],
);

export const faculties = pgTable(
  'faculties',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('faculties_institution_code_uq').on(table.institutionId, table.code),
    uniqueIndex('faculties_id_institution_uq').on(table.id, table.institutionId),
    index('faculties_institution_active_idx').on(table.institutionId, table.isActive),
  ],
);

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    institutionId: uuid('institution_id')
      .notNull()
      .references(() => institutions.id, { onDelete: 'restrict' }),
    facultyId: uuid('faculty_id').notNull(),
    code: varchar('code', { length: 40 }).notNull(),
    name: varchar('name', { length: 160 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    /**
     * Normal programme length in years (4 for most degrees, 5 for engineering
     * and law, 6 for medicine). Caps the level derived from a matric number.
     */
    programmeYears: smallint('programme_years').notNull().default(4),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    check('departments_programme_years_ck', sql`${table.programmeYears} BETWEEN 1 AND 8`),
    foreignKey({
      name: 'departments_faculty_institution_fk',
      columns: [table.facultyId, table.institutionId],
      foreignColumns: [faculties.id, faculties.institutionId],
    }).onDelete('restrict'),
    uniqueIndex('departments_faculty_code_uq').on(table.facultyId, table.code),
    uniqueIndex('departments_id_institution_uq').on(table.id, table.institutionId),
    index('departments_faculty_active_idx').on(table.facultyId, table.isActive),
    index('departments_institution_idx').on(table.institutionId),
  ],
);
