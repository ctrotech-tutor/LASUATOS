CREATE TABLE "student_setup_codes" (
	"class_list_entry_id" uuid PRIMARY KEY NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"issued_by_user_id" uuid NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"issued_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "student_setup_codes_expiry_ck" CHECK ("student_setup_codes"."expires_at" > "student_setup_codes"."issued_at")
);
--> statement-breakpoint
ALTER TABLE "class_list_entries" ADD COLUMN "vouched_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "class_list_entries" ADD COLUMN "vouched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "student_setup_codes" ADD CONSTRAINT "student_setup_codes_class_list_entry_id_class_list_entries_id_fk" FOREIGN KEY ("class_list_entry_id") REFERENCES "public"."class_list_entries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_setup_codes" ADD CONSTRAINT "student_setup_codes_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_setup_codes_expiry_idx" ON "student_setup_codes" USING btree ("expires_at");--> statement-breakpoint
ALTER TABLE "class_list_entries" ADD CONSTRAINT "class_list_entries_vouched_by_user_id_users_id_fk" FOREIGN KEY ("vouched_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;