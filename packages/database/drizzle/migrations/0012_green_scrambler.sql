ALTER TABLE "departments" ADD COLUMN "programme_years" smallint DEFAULT 4 NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "entry_level" smallint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "device_hash" varchar(64);--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD COLUMN "qr_only" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "attendance_records_session_device_idx" ON "attendance_records" USING btree ("attendance_session_id","device_hash");--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_programme_years_ck" CHECK ("departments"."programme_years" BETWEEN 1 AND 8);--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_entry_level_ck" CHECK ("student_profiles"."entry_level" IN (100, 200, 300));--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_entry_year_ck" CHECK ("student_profiles"."entry_year" IS NULL OR "student_profiles"."entry_year" BETWEEN 1950 AND 2200);