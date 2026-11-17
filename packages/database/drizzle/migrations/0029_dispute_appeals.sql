CREATE TYPE "public"."attendance_appeal_status" AS ENUM('open', 'upheld', 'rejected', 'withdrawn');--> statement-breakpoint
CREATE TABLE "attendance_dispute_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"dispute_id" uuid NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"attendance_session_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"statement" varchar(1000) NOT NULL,
	"status" "attendance_appeal_status" DEFAULT 'open' NOT NULL,
	"decision_note" varchar(500),
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_dispute_appeals_statement_length_ck" CHECK (char_length(btrim("attendance_dispute_appeals"."statement")) >= 20),
	CONSTRAINT "attendance_dispute_appeals_decision_ck" CHECK (("attendance_dispute_appeals"."status" = 'open' AND "attendance_dispute_appeals"."decided_at" IS NULL AND "attendance_dispute_appeals"."decided_by_user_id" IS NULL AND "attendance_dispute_appeals"."decision_note" IS NULL)
        OR ("attendance_dispute_appeals"."status" = 'withdrawn' AND "attendance_dispute_appeals"."decided_at" IS NOT NULL AND "attendance_dispute_appeals"."decided_by_user_id" IS NULL)
        OR ("attendance_dispute_appeals"."status" IN ('upheld', 'rejected') AND "attendance_dispute_appeals"."decided_at" IS NOT NULL AND "attendance_dispute_appeals"."decided_by_user_id" IS NOT NULL
            AND "attendance_dispute_appeals"."decision_note" IS NOT NULL AND char_length(btrim("attendance_dispute_appeals"."decision_note")) >= 10))
);
--> statement-breakpoint
ALTER TABLE "attendance_corrections" DROP CONSTRAINT "attendance_corrections_actor_tenant_fk";
--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD COLUMN "appeal_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_dispute_appeals" ADD CONSTRAINT "attendance_dispute_appeals_dispute_tenant_fk" FOREIGN KEY ("dispute_id","institution_id") REFERENCES "public"."attendance_disputes"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_dispute_appeals" ADD CONSTRAINT "attendance_dispute_appeals_session_tenant_offering_fk" FOREIGN KEY ("attendance_session_id","institution_id","course_offering_id") REFERENCES "public"."attendance_sessions"("id","institution_id","course_offering_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_dispute_appeals" ADD CONSTRAINT "attendance_dispute_appeals_student_tenant_fk" FOREIGN KEY ("student_user_id","institution_id") REFERENCES "public"."student_profiles"("user_id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_dispute_appeals" ADD CONSTRAINT "attendance_dispute_appeals_department_tenant_fk" FOREIGN KEY ("department_id","institution_id") REFERENCES "public"."departments"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_dispute_appeals" ADD CONSTRAINT "attendance_dispute_appeals_decider_tenant_fk" FOREIGN KEY ("decided_by_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_dispute_appeals_id_institution_uq" ON "attendance_dispute_appeals" USING btree ("id","institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_dispute_appeals_dispute_uq" ON "attendance_dispute_appeals" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "attendance_dispute_appeals_department_status_idx" ON "attendance_dispute_appeals" USING btree ("institution_id","department_id","status","created_at");--> statement-breakpoint
CREATE INDEX "attendance_dispute_appeals_student_idx" ON "attendance_dispute_appeals" USING btree ("institution_id","student_user_id");--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_appeal_tenant_fk" FOREIGN KEY ("appeal_id","institution_id") REFERENCES "public"."attendance_dispute_appeals"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_corrections" ADD CONSTRAINT "attendance_corrections_actor_user_tenant_fk" FOREIGN KEY ("actor_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."attendance_dispute_appeals_guard"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'attendance_dispute_appeals rows cannot be deleted' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    -- Only a dispute the lecturer rejected can be appealed, by its own student, for its own class.
    IF NOT EXISTS (
      SELECT 1 FROM "attendance_disputes" d
      WHERE d.id = NEW.dispute_id
        AND d.institution_id = NEW.institution_id
        AND d.student_user_id = NEW.student_user_id
        AND d.attendance_session_id = NEW.attendance_session_id
        AND d.course_offering_id = NEW.course_offering_id
        AND d.status = 'rejected'
    ) THEN
      RAISE EXCEPTION 'only a rejected dispute can be appealed, by its student' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'open' THEN
    RAISE EXCEPTION 'attendance appeal is final and cannot be changed' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.institution_id IS DISTINCT FROM OLD.institution_id
    OR NEW.dispute_id IS DISTINCT FROM OLD.dispute_id
    OR NEW.course_offering_id IS DISTINCT FROM OLD.course_offering_id
    OR NEW.attendance_session_id IS DISTINCT FROM OLD.attendance_session_id
    OR NEW.student_user_id IS DISTINCT FROM OLD.student_user_id
    OR NEW.department_id IS DISTINCT FROM OLD.department_id
    OR NEW.statement IS DISTINCT FROM OLD.statement
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'attendance appeal submission fields are immutable' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "attendance_dispute_appeals_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "attendance_dispute_appeals"
FOR EACH ROW EXECUTE FUNCTION "public"."attendance_dispute_appeals_guard"();
