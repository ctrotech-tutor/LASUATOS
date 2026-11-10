ALTER TABLE "semesters" ALTER COLUMN "name" SET DATA TYPE varchar(80) USING "name"::text;--> statement-breakpoint
DROP TYPE "public"."semester_name";