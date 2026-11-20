ALTER TABLE "users" ADD COLUMN "secondary_email" varchar(320);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "secondary_email_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "mail_delivery" varchar(10) DEFAULT 'primary' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_secondary_email_lower_uq" ON "users" USING btree (lower("secondary_email")) WHERE "users"."secondary_email" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_mail_delivery_ck" CHECK ("users"."mail_delivery" IN ('primary', 'secondary'));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_secondary_email_ck" CHECK (("users"."secondary_email" IS NULL) = ("users"."secondary_email_verified_at" IS NULL));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_mail_delivery_secondary_ck" CHECK ("users"."mail_delivery" = 'primary' OR "users"."secondary_email" IS NOT NULL);