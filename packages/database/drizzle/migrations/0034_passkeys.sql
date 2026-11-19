CREATE TABLE "passkey_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"challenge" varchar(128) NOT NULL,
	"purpose" varchar(16) NOT NULL,
	"user_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "passkey_challenges_purpose_ck" CHECK ("passkey_challenges"."purpose" IN ('register', 'sign_in')),
	CONSTRAINT "passkey_challenges_owner_ck" CHECK (("passkey_challenges"."purpose" = 'register') = ("passkey_challenges"."user_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "passkeys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" varchar(1400) NOT NULL,
	"public_key" "bytea" NOT NULL,
	"sign_count" bigint DEFAULT 0 NOT NULL,
	"transports" text[] DEFAULT '{}'::text[] NOT NULL,
	"backed_up" boolean DEFAULT false NOT NULL,
	"aaguid" varchar(36),
	"name" varchar(60) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	CONSTRAINT "passkeys_sign_count_ck" CHECK ("passkeys"."sign_count" >= 0),
	CONSTRAINT "passkeys_name_ck" CHECK (length(btrim("passkeys"."name")) > 0)
);
--> statement-breakpoint
ALTER TABLE "passkey_challenges" ADD CONSTRAINT "passkey_challenges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkeys" ADD CONSTRAINT "passkeys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "passkey_challenges_expiry_idx" ON "passkey_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "passkeys_credential_id_uq" ON "passkeys" USING btree ("credential_id");--> statement-breakpoint
CREATE INDEX "passkeys_user_idx" ON "passkeys" USING btree ("user_id");