CREATE TYPE "public"."geofence_kind" AS ENUM('circle');--> statement-breakpoint
CREATE TYPE "public"."venue_location_event_kind" AS ENUM('registered', 'updated', 'cleared');--> statement-breakpoint
CREATE TYPE "public"."venue_status" AS ENUM('pending_review', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."venue_type" AS ENUM('lecture_theatre', 'classroom', 'laboratory', 'hall', 'seminar_room', 'workshop', 'outdoor', 'other');--> statement-breakpoint
CREATE TABLE "buildings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(160) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_location_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"venue_id" uuid NOT NULL,
	"kind" "venue_location_event_kind" NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(11, 7),
	"reported_accuracy_meters" numeric(8, 2),
	"geofence_radius_meters" integer,
	"actor_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_location_events_latitude_range_ck" CHECK ("venue_location_events"."latitude" IS NULL OR "venue_location_events"."latitude" BETWEEN -90 AND 90),
	CONSTRAINT "venue_location_events_longitude_range_ck" CHECK ("venue_location_events"."longitude" IS NULL OR "venue_location_events"."longitude" BETWEEN -180 AND 180)
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"campus_id" uuid NOT NULL,
	"building_id" uuid,
	"code" varchar(40) NOT NULL,
	"name" varchar(160) NOT NULL,
	"venue_type" "venue_type" NOT NULL,
	"floor_label" varchar(40),
	"section_label" varchar(80),
	"capacity" integer,
	"status" "venue_status" DEFAULT 'pending_review' NOT NULL,
	"latitude" numeric(10, 7),
	"longitude" numeric(11, 7),
	"geofence_kind" "geofence_kind" DEFAULT 'circle' NOT NULL,
	"geofence_radius_meters" integer,
	"location_required" boolean DEFAULT true NOT NULL,
	"location_registered_by_user_id" uuid,
	"location_registered_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venues_latitude_range_ck" CHECK ("venues"."latitude" IS NULL OR "venues"."latitude" BETWEEN -90 AND 90),
	CONSTRAINT "venues_longitude_range_ck" CHECK ("venues"."longitude" IS NULL OR "venues"."longitude" BETWEEN -180 AND 180),
	CONSTRAINT "venues_geofence_radius_range_ck" CHECK ("venues"."geofence_radius_meters" IS NULL OR "venues"."geofence_radius_meters" BETWEEN 5 AND 2000),
	CONSTRAINT "venues_active_location_ck" CHECK ("venues"."status" <> 'active' OR ("venues"."latitude" IS NOT NULL AND "venues"."longitude" IS NOT NULL AND "venues"."geofence_radius_meters" IS NOT NULL AND "venues"."location_registered_by_user_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "campuses" ADD COLUMN "latitude" numeric(10, 7);--> statement-breakpoint
ALTER TABLE "campuses" ADD COLUMN "longitude" numeric(11, 7);--> statement-breakpoint
CREATE UNIQUE INDEX "buildings_id_institution_uq" ON "buildings" USING btree ("id","institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_id_institution_uq" ON "venues" USING btree ("id","institution_id");--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_campus_institution_fk" FOREIGN KEY ("campus_id","institution_id") REFERENCES "public"."campuses"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_location_events" ADD CONSTRAINT "venue_location_events_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_location_events" ADD CONSTRAINT "venue_location_events_venue_institution_fk" FOREIGN KEY ("venue_id","institution_id") REFERENCES "public"."venues"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_location_events" ADD CONSTRAINT "venue_location_events_actor_institution_fk" FOREIGN KEY ("actor_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_campus_institution_fk" FOREIGN KEY ("campus_id","institution_id") REFERENCES "public"."campuses"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_building_institution_fk" FOREIGN KEY ("building_id","institution_id") REFERENCES "public"."buildings"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_location_registrar_fk" FOREIGN KEY ("location_registered_by_user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "buildings_campus_code_uq" ON "buildings" USING btree ("campus_id","code");--> statement-breakpoint
CREATE INDEX "buildings_institution_idx" ON "buildings" USING btree ("institution_id","is_active");--> statement-breakpoint
CREATE INDEX "venue_location_events_venue_idx" ON "venue_location_events" USING btree ("venue_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_campus_code_uq" ON "venues" USING btree ("campus_id","code");--> statement-breakpoint
CREATE INDEX "venues_institution_status_idx" ON "venues" USING btree ("institution_id","status");--> statement-breakpoint
CREATE INDEX "venues_campus_idx" ON "venues" USING btree ("campus_id");--> statement-breakpoint
ALTER TABLE "campuses" ADD CONSTRAINT "campuses_latitude_range_ck" CHECK ("campuses"."latitude" IS NULL OR "campuses"."latitude" BETWEEN -90 AND 90);--> statement-breakpoint
ALTER TABLE "campuses" ADD CONSTRAINT "campuses_longitude_range_ck" CHECK ("campuses"."longitude" IS NULL OR "campuses"."longitude" BETWEEN -180 AND 180);