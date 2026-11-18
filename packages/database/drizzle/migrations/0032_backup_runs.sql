CREATE TABLE "backup_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" bigint NOT NULL,
	"run_attempt" integer NOT NULL,
	"status" varchar(8) NOT NULL,
	"stage" varchar(16) NOT NULL,
	"message" varchar(300),
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"tag" varchar(32),
	"location" varchar(300),
	"size_bytes" bigint,
	"sha256" varchar(64),
	"tables" integer,
	"rows" bigint,
	"kept" integer,
	"oldest_kept_at" timestamp with time zone,
	"read_only_login" boolean,
	"schema_current" boolean,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "backup_runs_status_ck" CHECK ("backup_runs"."status" IN ('ok', 'failed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "backup_runs_run_uq" ON "backup_runs" USING btree ("run_id","run_attempt");--> statement-breakpoint
CREATE INDEX "backup_runs_finished_idx" ON "backup_runs" USING btree ("finished_at");