CREATE TABLE "email_verification_tokens" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "email_verification_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
DROP INDEX "student_profiles_institution_number_uq";--> statement-breakpoint
ALTER TABLE "student_profiles" ALTER COLUMN "department_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD COLUMN "student_number_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "email_verification_tokens" ADD CONSTRAINT "email_verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_verification_tokens_expiry_idx" ON "email_verification_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "student_profiles_institution_number_idx" ON "student_profiles" USING btree ("institution_id","student_number");