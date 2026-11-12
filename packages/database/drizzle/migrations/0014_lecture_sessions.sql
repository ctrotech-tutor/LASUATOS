CREATE TYPE "public"."class_rep_role" AS ENUM('ghoc', 'hoc');--> statement-breakpoint
CREATE TYPE "public"."lecture_qr_mode" AS ENUM('dynamic', 'static');--> statement-breakpoint
CREATE TABLE "class_representatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"role" "class_rep_role" NOT NULL,
	"faculty_id" uuid NOT NULL,
	"department_id" uuid,
	"entry_year" smallint NOT NULL,
	"appointed_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	CONSTRAINT "class_representatives_scope_ck" CHECK (("class_representatives"."role" = 'hoc' AND "class_representatives"."department_id" IS NOT NULL) OR ("class_representatives"."role" = 'ghoc' AND "class_representatives"."department_id" IS NULL)),
	CONSTRAINT "class_representatives_entry_year_ck" CHECK ("class_representatives"."entry_year" BETWEEN 1950 AND 2200)
);
--> statement-breakpoint
CREATE TABLE "lecture_attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"lecture_session_id" uuid NOT NULL,
	"student_user_id" uuid,
	"full_name" varchar(160) NOT NULL,
	"matric_number" varchar(32) NOT NULL,
	"method" varchar(8) NOT NULL,
	"device_hash" varchar(64),
	"latitude" numeric(10, 7),
	"longitude" numeric(11, 7),
	"accuracy_meters" numeric(8, 2),
	"distance_meters" numeric(10, 2),
	"venue_outcome" varchar(16),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone,
	"removed_by_user_id" uuid,
	"removed_reason" varchar(300),
	CONSTRAINT "lecture_attendance_method_ck" CHECK ("lecture_attendance"."method" IN ('qr', 'code')),
	CONSTRAINT "lecture_attendance_venue_outcome_ck" CHECK ("lecture_attendance"."venue_outcome" IS NULL OR "lecture_attendance"."venue_outcome" IN ('within', 'inconclusive', 'unavailable'))
);
--> statement-breakpoint
CREATE TABLE "lecture_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"created_by_user_id" uuid NOT NULL,
	"creator_role" varchar(24) NOT NULL,
	"course_code" varchar(32) NOT NULL,
	"course_title" varchar(200) NOT NULL,
	"lecturer_name" varchar(160),
	"faculty_id" uuid,
	"department_id" uuid,
	"entry_year" smallint,
	"venue_id" uuid,
	"require_venue" boolean DEFAULT false NOT NULL,
	"qr_mode" "lecture_qr_mode" NOT NULL,
	"secret" varchar(64) NOT NULL,
	"public_code" varchar(16) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lecture_sessions_window_ck" CHECK ("lecture_sessions"."ends_at" > "lecture_sessions"."starts_at"),
	CONSTRAINT "lecture_sessions_creator_role_ck" CHECK ("lecture_sessions"."creator_role" IN ('lecturer', 'administrator', 'ghoc', 'hoc')),
	CONSTRAINT "lecture_sessions_require_venue_ck" CHECK (NOT "lecture_sessions"."require_venue" OR "lecture_sessions"."venue_id" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "class_representatives" ADD CONSTRAINT "class_representatives_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_representatives" ADD CONSTRAINT "class_representatives_student_fk" FOREIGN KEY ("student_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_representatives" ADD CONSTRAINT "class_representatives_faculty_fk" FOREIGN KEY ("faculty_id","institution_id") REFERENCES "public"."faculties"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_representatives" ADD CONSTRAINT "class_representatives_department_fk" FOREIGN KEY ("department_id","institution_id") REFERENCES "public"."departments"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_representatives" ADD CONSTRAINT "class_representatives_appointed_by_fk" FOREIGN KEY ("appointed_by_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_representatives" ADD CONSTRAINT "class_representatives_revoked_by_fk" FOREIGN KEY ("revoked_by_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_attendance" ADD CONSTRAINT "lecture_attendance_session_fk" FOREIGN KEY ("lecture_session_id","institution_id") REFERENCES "public"."lecture_sessions"("id","institution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_attendance" ADD CONSTRAINT "lecture_attendance_student_fk" FOREIGN KEY ("student_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_attendance" ADD CONSTRAINT "lecture_attendance_removed_by_fk" FOREIGN KEY ("removed_by_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_sessions" ADD CONSTRAINT "lecture_sessions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_sessions" ADD CONSTRAINT "lecture_sessions_creator_fk" FOREIGN KEY ("created_by_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_sessions" ADD CONSTRAINT "lecture_sessions_faculty_fk" FOREIGN KEY ("faculty_id","institution_id") REFERENCES "public"."faculties"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_sessions" ADD CONSTRAINT "lecture_sessions_department_fk" FOREIGN KEY ("department_id","institution_id") REFERENCES "public"."departments"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_sessions" ADD CONSTRAINT "lecture_sessions_venue_fk" FOREIGN KEY ("venue_id","institution_id") REFERENCES "public"."venues"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_representatives_student_active_uq" ON "class_representatives" USING btree ("student_user_id") WHERE "class_representatives"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "class_representatives_scope_idx" ON "class_representatives" USING btree ("institution_id","faculty_id","entry_year");--> statement-breakpoint
CREATE UNIQUE INDEX "lecture_attendance_session_matric_uq" ON "lecture_attendance" USING btree ("lecture_session_id","matric_number");--> statement-breakpoint
CREATE INDEX "lecture_attendance_session_idx" ON "lecture_attendance" USING btree ("lecture_session_id","created_at");--> statement-breakpoint
CREATE INDEX "lecture_attendance_student_idx" ON "lecture_attendance" USING btree ("student_user_id");--> statement-breakpoint
CREATE INDEX "lecture_attendance_matric_idx" ON "lecture_attendance" USING btree ("institution_id","matric_number");--> statement-breakpoint
CREATE UNIQUE INDEX "lecture_sessions_public_code_uq" ON "lecture_sessions" USING btree ("public_code");--> statement-breakpoint
CREATE UNIQUE INDEX "lecture_sessions_id_institution_uq" ON "lecture_sessions" USING btree ("id","institution_id");--> statement-breakpoint
CREATE INDEX "lecture_sessions_creator_idx" ON "lecture_sessions" USING btree ("created_by_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "lecture_sessions_institution_idx" ON "lecture_sessions" USING btree ("institution_id","starts_at");--> statement-breakpoint
CREATE INDEX "lecture_sessions_open_idx" ON "lecture_sessions" USING btree ("ends_at") WHERE "lecture_sessions"."closed_at" IS NULL;--> statement-breakpoint
-- Students no longer wait for an emailed link before they can sign in. Accounts
-- created earlier that never confirmed are activated and given the student role
-- that confirmation used to grant, so their owners can sign in now.
INSERT INTO "user_role_assignments" ("user_id", "role", "scope_type", "institution_id")
SELECT "users"."id", 'student', 'institution', "users"."institution_id"
FROM "users"
INNER JOIN "student_profiles" ON "student_profiles"."user_id" = "users"."id"
WHERE "users"."status" = 'invited'
  AND "users"."password_hash" IS NOT NULL
  AND "users"."institution_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "status" = 'active', "updated_at" = now()
WHERE "status" = 'invited'
  AND "password_hash" IS NOT NULL
  AND "id" IN (SELECT "user_id" FROM "student_profiles");
