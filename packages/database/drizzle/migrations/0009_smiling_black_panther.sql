CREATE TYPE "public"."attendance_dispute_kind" AS ENUM('missing_check_in', 'revoked_check_in');--> statement-breakpoint
CREATE TYPE "public"."attendance_dispute_status" AS ENUM('open', 'upheld', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TABLE "attendance_disputes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"attendance_session_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"kind" "attendance_dispute_kind" NOT NULL,
	"status" "attendance_dispute_status" DEFAULT 'open' NOT NULL,
	"statement" varchar(1000) NOT NULL,
	"resolution_note" varchar(500),
	"resolved_by_user_id" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_disputes_statement_length_ck" CHECK (char_length(btrim("attendance_disputes"."statement")) >= 20),
	CONSTRAINT "attendance_disputes_resolution_ck" CHECK (("attendance_disputes"."status" = 'open' AND "attendance_disputes"."resolved_at" IS NULL AND "attendance_disputes"."resolved_by_user_id" IS NULL AND "attendance_disputes"."resolution_note" IS NULL)
        OR ("attendance_disputes"."status" = 'withdrawn' AND "attendance_disputes"."resolved_at" IS NOT NULL AND "attendance_disputes"."resolved_by_user_id" IS NULL)
        OR ("attendance_disputes"."status" IN ('upheld', 'rejected') AND "attendance_disputes"."resolved_at" IS NOT NULL AND "attendance_disputes"."resolved_by_user_id" IS NOT NULL
            AND "attendance_disputes"."resolution_note" IS NOT NULL AND char_length(btrim("attendance_disputes"."resolution_note")) >= 10))
);
--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD COLUMN "dispute_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_disputes" ADD CONSTRAINT "attendance_disputes_session_tenant_offering_fk" FOREIGN KEY ("attendance_session_id","institution_id","course_offering_id") REFERENCES "public"."attendance_sessions"("id","institution_id","course_offering_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_disputes" ADD CONSTRAINT "attendance_disputes_student_tenant_fk" FOREIGN KEY ("student_user_id","institution_id") REFERENCES "public"."student_profiles"("user_id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_disputes" ADD CONSTRAINT "attendance_disputes_resolver_tenant_fk" FOREIGN KEY ("resolved_by_user_id","institution_id") REFERENCES "public"."lecturer_profiles"("user_id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_disputes_id_institution_uq" ON "attendance_disputes" USING btree ("id","institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_disputes_one_open_uq" ON "attendance_disputes" USING btree ("attendance_session_id","student_user_id") WHERE "attendance_disputes"."status" = 'open';--> statement-breakpoint
CREATE INDEX "attendance_disputes_offering_status_idx" ON "attendance_disputes" USING btree ("institution_id","course_offering_id","status","created_at");--> statement-breakpoint
CREATE INDEX "attendance_disputes_student_created_idx" ON "attendance_disputes" USING btree ("institution_id","student_user_id","created_at");--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_dispute_tenant_fk" FOREIGN KEY ("dispute_id","institution_id") REFERENCES "public"."attendance_disputes"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."attendance_disputes_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attendance_disputes rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'attendance dispute is final and cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.institution_id IS DISTINCT FROM OLD.institution_id
    OR NEW.course_offering_id IS DISTINCT FROM OLD.course_offering_id
    OR NEW.attendance_session_id IS DISTINCT FROM OLD.attendance_session_id
    OR NEW.student_user_id IS DISTINCT FROM OLD.student_user_id
    OR NEW.kind IS DISTINCT FROM OLD.kind
    OR NEW.statement IS DISTINCT FROM OLD.statement
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'attendance dispute submission fields are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "attendance_disputes_guard"
BEFORE UPDATE OR DELETE ON "attendance_disputes"
FOR EACH ROW EXECUTE FUNCTION "public"."attendance_disputes_guard"();
