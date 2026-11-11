CREATE TYPE "public"."attendance_correction_action" AS ENUM('mark_present', 'revoke');--> statement-breakpoint
CREATE TYPE "public"."attendance_record_status" AS ENUM('present', 'revoked');--> statement-breakpoint
ALTER TYPE "public"."attendance_record_method" ADD VALUE 'manual';--> statement-breakpoint
CREATE TABLE "attendance_corrections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"attendance_session_id" uuid NOT NULL,
	"attendance_record_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" "attendance_correction_action" NOT NULL,
	"previous_status" "attendance_record_status",
	"resulting_status" "attendance_record_status" NOT NULL,
	"reason" varchar(500) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_corrections_reason_length_ck" CHECK (char_length(btrim("attendance_corrections"."reason")) >= 10),
	CONSTRAINT "attendance_corrections_status_change_ck" CHECK ("attendance_corrections"."previous_status" IS DISTINCT FROM "attendance_corrections"."resulting_status")
);
--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "status" "attendance_record_status" DEFAULT 'present' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "revoked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_session_tenant_fk" FOREIGN KEY ("attendance_session_id","institution_id") REFERENCES "public"."attendance_sessions"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_record_tenant_fk" FOREIGN KEY ("attendance_record_id","institution_id") REFERENCES "public"."attendance_records"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_student_tenant_fk" FOREIGN KEY ("student_user_id","institution_id") REFERENCES "public"."student_profiles"("user_id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_actor_tenant_fk" FOREIGN KEY ("actor_user_id","institution_id") REFERENCES "public"."lecturer_profiles"("user_id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_corrections_session_created_idx" ON "attendance_corrections" USING btree ("institution_id","attendance_session_id","created_at");--> statement-breakpoint
CREATE INDEX "attendance_corrections_record_idx" ON "attendance_corrections" USING btree ("institution_id","attendance_record_id");--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_revoked_at_ck" CHECK (("attendance_records"."status" = 'present' AND "attendance_records"."revoked_at" IS NULL) OR ("attendance_records"."status" = 'revoked' AND "attendance_records"."revoked_at" IS NOT NULL));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."attendance_corrections_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'attendance_corrections is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "attendance_corrections_no_update_delete"
BEFORE UPDATE OR DELETE ON "attendance_corrections"
FOR EACH ROW EXECUTE FUNCTION "public"."attendance_corrections_append_only"();
