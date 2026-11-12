CREATE TYPE "public"."staff_audit_action" AS ENUM('invitation_created', 'invitation_resent', 'invitation_revoked', 'invitation_accepted', 'staff_suspended', 'staff_reactivated');--> statement-breakpoint
CREATE TYPE "public"."staff_invitation_role" AS ENUM('lecturer', 'department_administrator', 'faculty_administrator', 'institution_administrator');--> statement-breakpoint
CREATE TABLE "staff_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"action" "staff_audit_action" NOT NULL,
	"target_user_id" uuid,
	"invitation_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"role" "staff_invitation_role" NOT NULL,
	"faculty_id" uuid,
	"department_id" uuid,
	"staff_number" varchar(64),
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"sent_at" timestamp with time zone NOT NULL,
	"invited_by_user_id" uuid,
	"accepted_at" timestamp with time zone,
	"accepted_user_id" uuid,
	"revoked_at" timestamp with time zone,
	"revoked_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_invitations_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "staff_invitations_scope_shape_ck" CHECK ((
        ("staff_invitations"."role" = 'institution_administrator' AND "staff_invitations"."faculty_id" IS NULL AND "staff_invitations"."department_id" IS NULL)
        OR ("staff_invitations"."role" = 'faculty_administrator' AND "staff_invitations"."faculty_id" IS NOT NULL AND "staff_invitations"."department_id" IS NULL)
        OR ("staff_invitations"."role" IN ('department_administrator', 'lecturer') AND "staff_invitations"."faculty_id" IS NULL AND "staff_invitations"."department_id" IS NOT NULL)
      )),
	CONSTRAINT "staff_invitations_staff_number_ck" CHECK (("staff_invitations"."role" = 'lecturer') = ("staff_invitations"."staff_number" IS NOT NULL)),
	CONSTRAINT "staff_invitations_outcome_ck" CHECK (NOT ("staff_invitations"."accepted_at" IS NOT NULL AND "staff_invitations"."revoked_at" IS NOT NULL)
        AND (("staff_invitations"."accepted_at" IS NULL) = ("staff_invitations"."accepted_user_id" IS NULL))),
	CONSTRAINT "staff_invitations_expiry_ck" CHECK ("staff_invitations"."expires_at" > "staff_invitations"."sent_at")
);
--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_target_user_id_users_id_fk" FOREIGN KEY ("target_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_audit_events" ADD CONSTRAINT "staff_audit_events_invitation_id_staff_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."staff_invitations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_accepted_user_id_users_id_fk" FOREIGN KEY ("accepted_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_revoked_by_user_id_users_id_fk" FOREIGN KEY ("revoked_by_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_faculty_institution_fk" FOREIGN KEY ("faculty_id","institution_id") REFERENCES "public"."faculties"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_department_institution_fk" FOREIGN KEY ("department_id","institution_id") REFERENCES "public"."departments"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "staff_audit_events_institution_idx" ON "staff_audit_events" USING btree ("institution_id","created_at");--> statement-breakpoint
CREATE INDEX "staff_audit_events_target_idx" ON "staff_audit_events" USING btree ("target_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_invitations_pending_email_uq" ON "staff_invitations" USING btree ("institution_id",lower("email")) WHERE "staff_invitations"."accepted_at" IS NULL AND "staff_invitations"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "staff_invitations_institution_idx" ON "staff_invitations" USING btree ("institution_id","created_at");--> statement-breakpoint
CREATE OR REPLACE FUNCTION "public"."staff_audit_events_append_only"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'staff_audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "staff_audit_events_no_update_delete"
BEFORE UPDATE OR DELETE ON "staff_audit_events"
FOR EACH ROW EXECUTE FUNCTION "public"."staff_audit_events_append_only"();
