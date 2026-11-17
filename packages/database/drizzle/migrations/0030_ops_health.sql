CREATE TABLE "email_provider_days" (
	"provider" varchar(16) NOT NULL,
	"day" date NOT NULL,
	"sent" integer DEFAULT 0 NOT NULL,
	"failed" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_failure_kind" varchar(16),
	"last_failure_reason" varchar(400),
	"paused_until" timestamp with time zone,
	CONSTRAINT "email_provider_days_pk" PRIMARY KEY("provider","day"),
	CONSTRAINT "email_provider_days_provider_ck" CHECK ("email_provider_days"."provider" IN ('brevo', 'gmail', 'resend', 'mailpit')),
	CONSTRAINT "email_provider_days_counts_ck" CHECK ("email_provider_days"."sent" >= 0 AND "email_provider_days"."failed" >= 0)
);
--> statement-breakpoint
CREATE TABLE "operator_alert_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(32) NOT NULL,
	"summary" varchar(300) NOT NULL,
	"fingerprint" varchar(24) NOT NULL,
	"outcome" varchar(12) NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operator_alert_events_outcome_ck" CHECK ("operator_alert_events"."outcome" IN ('emailed', 'throttled', 'logged'))
);
--> statement-breakpoint
CREATE INDEX "operator_alert_events_occurred_idx" ON "operator_alert_events" USING btree ("occurred_at");