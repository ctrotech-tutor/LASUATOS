CREATE TYPE "public"."attendance_session_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"attendance_session_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"lecturer_user_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"status" "attendance_session_status" DEFAULT 'open' NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_sessions_time_order_ck" CHECK ("attendance_sessions"."ends_at" > "attendance_sessions"."starts_at"),
	CONSTRAINT "attendance_sessions_closed_at_ck" CHECK (("attendance_sessions"."status" = 'open' AND "attendance_sessions"."closed_at" IS NULL) OR ("attendance_sessions"."status" = 'closed' AND "attendance_sessions"."closed_at" IS NOT NULL))
);--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_session_student_uq" ON "attendance_records" USING btree ("attendance_session_id","student_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_sessions_id_institution_uq" ON "attendance_sessions" USING btree ("id","institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_sessions_id_tenant_offering_uq" ON "attendance_sessions" USING btree ("id","institution_id","course_offering_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_sessions_code_hash_uq" ON "attendance_sessions" USING btree ("code_hash");--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_tenant_fk" FOREIGN KEY ("attendance_session_id","institution_id") REFERENCES "public"."attendance_sessions"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_student_tenant_fk" FOREIGN KEY ("student_user_id","institution_id") REFERENCES "public"."student_profiles"("user_id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_offering_institution_fk" FOREIGN KEY ("course_offering_id","institution_id") REFERENCES "public"."course_offerings"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_lecturer_institution_fk" FOREIGN KEY ("lecturer_user_id","institution_id") REFERENCES "public"."lecturer_profiles"("user_id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_records_student_checked_in_idx" ON "attendance_records" USING btree ("institution_id","student_user_id","checked_in_at");--> statement-breakpoint
CREATE INDEX "attendance_records_session_checked_in_idx" ON "attendance_records" USING btree ("institution_id","attendance_session_id","checked_in_at");--> statement-breakpoint
CREATE INDEX "attendance_sessions_offering_started_idx" ON "attendance_sessions" USING btree ("institution_id","course_offering_id","starts_at");--> statement-breakpoint
CREATE INDEX "attendance_sessions_lecturer_status_idx" ON "attendance_sessions" USING btree ("institution_id","lecturer_user_id","status");
