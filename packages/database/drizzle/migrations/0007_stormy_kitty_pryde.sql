CREATE TYPE "public"."attendance_record_method" AS ENUM('code', 'qr_code');--> statement-breakpoint
CREATE TYPE "public"."attendance_venue_outcome" AS ENUM('within_boundary', 'inconclusive');--> statement-breakpoint
CREATE TABLE "attendance_check_in_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"attendance_record_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"latitude" numeric(10, 7) NOT NULL,
	"longitude" numeric(11, 7) NOT NULL,
	"accuracy_meters" numeric(8, 2),
	"captured_at" timestamp with time zone NOT NULL,
	"distance_meters" numeric(10, 2) NOT NULL,
	"radius_meters" integer NOT NULL,
	"outcome" "attendance_venue_outcome" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_evidence_coordinate_range_ck" CHECK ("attendance_check_in_evidence"."latitude" BETWEEN -90 AND 90 AND "attendance_check_in_evidence"."longitude" BETWEEN -180 AND 180),
	CONSTRAINT "attendance_evidence_accuracy_ck" CHECK ("attendance_check_in_evidence"."accuracy_meters" IS NULL OR "attendance_check_in_evidence"."accuracy_meters" BETWEEN 0 AND 2000)
);
--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "method" "attendance_record_method" DEFAULT 'code' NOT NULL;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD COLUMN "venue_outcome" "attendance_venue_outcome";--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD COLUMN "venue_id" uuid;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD COLUMN "qr_secret" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_evidence_record_uq" ON "attendance_check_in_evidence" USING btree ("attendance_record_id");--> statement-breakpoint
CREATE INDEX "attendance_evidence_record_idx" ON "attendance_check_in_evidence" USING btree ("institution_id","attendance_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_records_id_institution_uq" ON "attendance_records" USING btree ("id","institution_id");--> statement-breakpoint
ALTER TABLE "attendance_check_in_evidence" ADD CONSTRAINT "attendance_evidence_record_tenant_fk" FOREIGN KEY ("attendance_record_id","institution_id") REFERENCES "public"."attendance_records"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_check_in_evidence" ADD CONSTRAINT "attendance_evidence_student_tenant_fk" FOREIGN KEY ("student_user_id","institution_id") REFERENCES "public"."student_profiles"("user_id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_venue_institution_fk" FOREIGN KEY ("venue_id","institution_id") REFERENCES "public"."venues"("id","institution_id") ON DELETE restrict ON UPDATE no action;