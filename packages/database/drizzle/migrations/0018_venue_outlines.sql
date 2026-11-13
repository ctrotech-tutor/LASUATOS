ALTER TABLE "venue_location_events" ADD COLUMN "geofence_outline" jsonb;--> statement-breakpoint
ALTER TABLE "venue_location_events" ADD COLUMN "geofence_allowance_meters" integer;--> statement-breakpoint
ALTER TABLE "venue_location_events" ADD COLUMN "sample_count" integer;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "geofence_outline" jsonb;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "geofence_allowance_meters" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "location_accuracy_meters" numeric(8, 2);--> statement-breakpoint
ALTER TABLE "venues" ADD COLUMN "location_sample_count" integer;--> statement-breakpoint
ALTER TABLE "lecture_attendance" ADD COLUMN "outside_meters" numeric(10, 2);--> statement-breakpoint
ALTER TABLE "lecture_attendance" ADD COLUMN "location_samples" integer;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_geofence_allowance_range_ck" CHECK ("venues"."geofence_allowance_meters" BETWEEN 0 AND 100);--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_geofence_outline_shape_ck" CHECK ("venues"."geofence_outline" IS NULL OR CASE WHEN jsonb_typeof("venues"."geofence_outline") = 'array' THEN jsonb_array_length("venues"."geofence_outline") BETWEEN 3 AND 24 ELSE false END);--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_location_sample_count_ck" CHECK ("venues"."location_sample_count" IS NULL OR "venues"."location_sample_count" BETWEEN 1 AND 10000);