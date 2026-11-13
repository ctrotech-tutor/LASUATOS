ALTER TABLE "staff_invitations" DROP CONSTRAINT "staff_invitations_staff_number_ck";--> statement-breakpoint
ALTER TABLE "lecturer_profiles" ALTER COLUMN "staff_number" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "standard_code" varchar(32);--> statement-breakpoint
ALTER TABLE "courses" ADD COLUMN "hidden_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "courses_institution_standard_code_uq" ON "courses" USING btree ("institution_id","standard_code") WHERE "courses"."standard_code" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_staff_number_ck" CHECK ("staff_invitations"."role" = 'lecturer' OR "staff_invitations"."staff_number" IS NULL);