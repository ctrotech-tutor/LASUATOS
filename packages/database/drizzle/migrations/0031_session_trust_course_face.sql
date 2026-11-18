ALTER TABLE "user_sessions" ADD COLUMN "starting_password" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "face_score" numeric(5, 4);