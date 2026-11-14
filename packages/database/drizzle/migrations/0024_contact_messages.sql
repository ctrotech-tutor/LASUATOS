CREATE TABLE "contact_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" varchar(12) NOT NULL,
	"topic" varchar(16) NOT NULL,
	"status" varchar(12) DEFAULT 'new' NOT NULL,
	"name" varchar(120) NOT NULL,
	"email" varchar(254) NOT NULL,
	"role" varchar(24),
	"department" varchar(160),
	"matric_number" varchar(20),
	"privacy_request" varchar(16),
	"page" varchar(200),
	"device" varchar(300),
	"students" integer,
	"message" text NOT NULL,
	"sender_user_id" uuid,
	"handled_at" timestamp with time zone,
	"handled_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contact_messages_topic_ck" CHECK ("contact_messages"."topic" IN ('adoption', 'problem', 'account', 'privacy', 'other')),
	CONSTRAINT "contact_messages_status_ck" CHECK ("contact_messages"."status" IN ('new', 'handled')),
	CONSTRAINT "contact_messages_message_length_ck" CHECK (char_length("contact_messages"."message") BETWEEN 1 AND 3000),
	CONSTRAINT "contact_messages_handled_ck" CHECK (("contact_messages"."status" = 'handled') = ("contact_messages"."handled_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_messages" ADD CONSTRAINT "contact_messages_handled_by_user_id_users_id_fk" FOREIGN KEY ("handled_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "contact_messages_reference_uq" ON "contact_messages" USING btree ("reference");--> statement-breakpoint
CREATE INDEX "contact_messages_status_created_idx" ON "contact_messages" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "contact_messages_created_idx" ON "contact_messages" USING btree ("created_at");