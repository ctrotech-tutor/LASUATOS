CREATE TABLE "lecture_help_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"lecture_session_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"full_name" varchar(160) NOT NULL,
	"matric_number" varchar(32) NOT NULL,
	"reason" varchar(48) NOT NULL,
	"failures" smallint DEFAULT 0 NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"venue_outcome" varchar(16),
	"accuracy_meters" numeric(8, 2),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	CONSTRAINT "lecture_help_requests_status_ck" CHECK ("lecture_help_requests"."status" IN ('pending', 'added', 'declined')),
	CONSTRAINT "lecture_help_requests_decided_ck" CHECK (("lecture_help_requests"."status" = 'pending') = ("lecture_help_requests"."decided_at" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "lecture_face_checks" ADD COLUMN "review_status" varchar(12);--> statement-breakpoint
ALTER TABLE "lecture_face_checks" ADD COLUMN "reviewed_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "lecture_face_checks" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lecture_face_checks" ADD COLUMN "review_note" varchar(300);--> statement-breakpoint
ALTER TABLE "student_face_profiles" ADD COLUMN "replace_allowed_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "lecture_help_requests" ADD CONSTRAINT "lecture_help_requests_session_fk" FOREIGN KEY ("lecture_session_id","institution_id") REFERENCES "public"."lecture_sessions"("id","institution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_help_requests" ADD CONSTRAINT "lecture_help_requests_student_fk" FOREIGN KEY ("student_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecture_help_requests" ADD CONSTRAINT "lecture_help_requests_decided_by_fk" FOREIGN KEY ("decided_by_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lecture_help_requests_session_student_uq" ON "lecture_help_requests" USING btree ("lecture_session_id","student_user_id");--> statement-breakpoint
CREATE INDEX "lecture_help_requests_session_idx" ON "lecture_help_requests" USING btree ("lecture_session_id","created_at");--> statement-breakpoint
ALTER TABLE "lecture_face_checks" ADD CONSTRAINT "lecture_face_checks_reviewed_by_fk" FOREIGN KEY ("reviewed_by_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lecture_face_checks_review_idx" ON "lecture_face_checks" USING btree ("institution_id","created_at") WHERE "lecture_face_checks"."needs_review";--> statement-breakpoint
ALTER TABLE "lecture_face_checks" ADD CONSTRAINT "lecture_face_checks_review_status_ck" CHECK ("lecture_face_checks"."review_status" IS NULL OR "lecture_face_checks"."review_status" IN ('approved', 'rejected'));--> statement-breakpoint
ALTER TABLE "lecture_face_checks" ADD CONSTRAINT "lecture_face_checks_review_shape_ck" CHECK (("lecture_face_checks"."review_status" IS NULL) = ("lecture_face_checks"."reviewed_at" IS NULL));