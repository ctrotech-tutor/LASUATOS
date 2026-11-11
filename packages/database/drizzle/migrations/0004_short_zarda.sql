CREATE TABLE "course_enrollment_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"lecturer_user_id" uuid NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "course_enrollment_codes_expiry_ck" CHECK ("course_enrollment_codes"."expires_at" > "course_enrollment_codes"."created_at")
);
--> statement-breakpoint
ALTER TABLE "course_enrollment_codes" ADD CONSTRAINT "course_enrollment_codes_offering_institution_fk" FOREIGN KEY ("course_offering_id","institution_id") REFERENCES "public"."course_offerings"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollment_codes" ADD CONSTRAINT "course_enrollment_codes_lecturer_institution_fk" FOREIGN KEY ("lecturer_user_id","institution_id") REFERENCES "public"."lecturer_profiles"("user_id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "course_enrollment_codes_code_hash_uq" ON "course_enrollment_codes" USING btree ("code_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "course_enrollment_codes_one_unrevoked_per_offering_uq" ON "course_enrollment_codes" USING btree ("course_offering_id") WHERE "course_enrollment_codes"."revoked_at" IS NULL;--> statement-breakpoint
CREATE INDEX "course_enrollment_codes_offering_created_idx" ON "course_enrollment_codes" USING btree ("institution_id","course_offering_id","created_at");--> statement-breakpoint
CREATE INDEX "course_enrollment_codes_expiry_idx" ON "course_enrollment_codes" USING btree ("expires_at");