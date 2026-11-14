CREATE TABLE "class_list_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"matric_number" varchar(32) NOT NULL,
	"surname" varchar(80) NOT NULL,
	"first_name" varchar(80) NOT NULL,
	"middle_name" varchar(120),
	"lasu_email" varchar(320),
	"entry_year" smallint NOT NULL,
	"entry_level" smallint DEFAULT 100 NOT NULL,
	"student_user_id" uuid,
	"added_by_user_id" uuid NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "class_list_entries_entry_level_ck" CHECK ("class_list_entries"."entry_level" IN (100, 200, 300)),
	CONSTRAINT "class_list_entries_entry_year_ck" CHECK ("class_list_entries"."entry_year" BETWEEN 1950 AND 2200)
);
--> statement-breakpoint
CREATE TABLE "lecture_face_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"lecture_session_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"score" numeric(5, 4) NOT NULL,
	"real" numeric(5, 4) NOT NULL,
	"live" numeric(5, 4) NOT NULL,
	"needs_review" boolean DEFAULT false NOT NULL,
	"photo" "bytea",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" varchar(48) NOT NULL,
	"subject_user_id" uuid,
	"matric_number" varchar(32),
	"details" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_email_codes" (
	"class_list_entry_id" uuid PRIMARY KEY NOT NULL,
	"email" varchar(320) NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"send_count" smallint DEFAULT 1 NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL,
	"requested_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_face_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"institution_id" uuid NOT NULL,
	"model" varchar(40) NOT NULL,
	"templates" jsonb NOT NULL,
	"centroid" jsonb NOT NULL,
	"photo" "bytea" NOT NULL,
	"quality" jsonb NOT NULL,
	"consented_at" timestamp with time zone NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_is_default" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "lecture_attendance" ADD COLUMN "face_score" numeric(5, 4);--> statement-breakpoint
ALTER TABLE "class_list_entries" ADD CONSTRAINT "class_list_entries_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_list_entries" ADD CONSTRAINT "class_list_entries_department_fk" FOREIGN KEY ("department_id","institution_id") REFERENCES "public"."departments"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_list_entries" ADD CONSTRAINT "class_list_entries_student_fk" FOREIGN KEY ("student_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_list_entries" ADD CONSTRAINT "class_list_entries_added_by_fk" FOREIGN KEY ("added_by_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_list_entries" ADD CONSTRAINT "class_list_entries_updated_by_fk" FOREIGN KEY ("updated_by_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_face_checks" ADD CONSTRAINT "lecture_face_checks_session_fk" FOREIGN KEY ("lecture_session_id","institution_id") REFERENCES "public"."lecture_sessions"("id","institution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_face_checks" ADD CONSTRAINT "lecture_face_checks_student_fk" FOREIGN KEY ("student_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_audit_events" ADD CONSTRAINT "student_audit_events_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_audit_events" ADD CONSTRAINT "student_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_audit_events" ADD CONSTRAINT "student_audit_events_subject_user_id_users_id_fk" FOREIGN KEY ("subject_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_email_codes" ADD CONSTRAINT "student_email_codes_class_list_entry_id_class_list_entries_id_fk" FOREIGN KEY ("class_list_entry_id") REFERENCES "public"."class_list_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_face_profiles" ADD CONSTRAINT "student_face_profiles_user_fk" FOREIGN KEY ("user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "class_list_entries_matric_uq" ON "class_list_entries" USING btree ("institution_id","matric_number");--> statement-breakpoint
CREATE UNIQUE INDEX "class_list_entries_email_uq" ON "class_list_entries" USING btree ("institution_id",lower("lasu_email")) WHERE "class_list_entries"."lasu_email" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "class_list_entries_student_uq" ON "class_list_entries" USING btree ("student_user_id") WHERE "class_list_entries"."student_user_id" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "class_list_entries_scope_idx" ON "class_list_entries" USING btree ("institution_id","department_id","entry_year");--> statement-breakpoint
CREATE UNIQUE INDEX "lecture_face_checks_session_student_uq" ON "lecture_face_checks" USING btree ("lecture_session_id","student_user_id");--> statement-breakpoint
CREATE INDEX "student_audit_events_institution_idx" ON "student_audit_events" USING btree ("institution_id","created_at");--> statement-breakpoint
CREATE INDEX "student_audit_events_subject_idx" ON "student_audit_events" USING btree ("subject_user_id");--> statement-breakpoint
CREATE INDEX "student_audit_events_matric_idx" ON "student_audit_events" USING btree ("institution_id","matric_number");--> statement-breakpoint
CREATE INDEX "student_face_profiles_institution_idx" ON "student_face_profiles" USING btree ("institution_id");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."student_audit_events_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'student_audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "student_audit_events_no_update_delete"
BEFORE UPDATE OR DELETE ON "student_audit_events"
FOR EACH ROW EXECUTE FUNCTION "public"."student_audit_events_append_only"();
