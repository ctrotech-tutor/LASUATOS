CREATE TABLE "structure_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"action" varchar(48) NOT NULL,
	"target_type" varchar(24) NOT NULL,
	"target_id" uuid NOT NULL,
	"details" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "structure_audit_events_target_type_ck" CHECK ("structure_audit_events"."target_type" IN ('faculty', 'department', 'academic_session'))
);
--> statement-breakpoint
ALTER TABLE "structure_audit_events" ADD CONSTRAINT "structure_audit_events_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "structure_audit_events" ADD CONSTRAINT "structure_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "structure_audit_events_institution_idx" ON "structure_audit_events" USING btree ("institution_id","created_at");--> statement-breakpoint
CREATE INDEX "structure_audit_events_target_idx" ON "structure_audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_institution_code_ci_uq" ON "departments" USING btree ("institution_id",upper("code"));--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."structure_audit_events_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'structure_audit_events rows are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "structure_audit_events_no_update_delete"
BEFORE UPDATE OR DELETE ON "structure_audit_events"
FOR EACH ROW EXECUTE FUNCTION "public"."structure_audit_events_append_only"();
