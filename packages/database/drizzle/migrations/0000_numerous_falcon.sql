CREATE TYPE "public"."account_status" AS ENUM('invited', 'active', 'suspended', 'closed');--> statement-breakpoint
CREATE TYPE "public"."role_scope_type" AS ENUM('system', 'institution', 'faculty', 'department');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'lecturer', 'course_coordinator', 'department_administrator', 'faculty_administrator', 'institution_administrator', 'system_administrator');--> statement-breakpoint
CREATE TYPE "public"."course_assignment_type" AS ENUM('lecturer', 'coordinator');--> statement-breakpoint
CREATE TYPE "public"."enrollment_status" AS ENUM('active', 'withdrawn', 'completed');--> statement-breakpoint
CREATE TYPE "public"."semester_name" AS ENUM('first', 'second', 'summer');--> statement-breakpoint
CREATE TABLE "campuses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(160) NOT NULL,
	"address" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "departments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"faculty_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(160) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "faculties" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"code" varchar(40) NOT NULL,
	"name" varchar(160) NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "institutions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" varchar(80) NOT NULL,
	"name" varchar(200) NOT NULL,
	"timezone" varchar(64) DEFAULT 'Africa/Lagos' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "institutions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "lecturer_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"institution_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"staff_number" varchar(64) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "student_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"institution_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"student_number" varchar(64) NOT NULL,
	"entry_year" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_role_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "user_role" NOT NULL,
	"scope_type" "role_scope_type" NOT NULL,
	"institution_id" uuid,
	"faculty_id" uuid,
	"department_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_assignments_scope_shape_ck" CHECK ((
        ("user_role_assignments"."scope_type" = 'system' AND "user_role_assignments"."institution_id" IS NULL AND "user_role_assignments"."faculty_id" IS NULL AND "user_role_assignments"."department_id" IS NULL)
        OR ("user_role_assignments"."scope_type" = 'institution' AND "user_role_assignments"."institution_id" IS NOT NULL AND "user_role_assignments"."faculty_id" IS NULL AND "user_role_assignments"."department_id" IS NULL)
        OR ("user_role_assignments"."scope_type" = 'faculty' AND "user_role_assignments"."institution_id" IS NOT NULL AND "user_role_assignments"."faculty_id" IS NOT NULL AND "user_role_assignments"."department_id" IS NULL)
        OR ("user_role_assignments"."scope_type" = 'department' AND "user_role_assignments"."institution_id" IS NOT NULL AND "user_role_assignments"."faculty_id" IS NULL AND "user_role_assignments"."department_id" IS NOT NULL)
      )),
	CONSTRAINT "user_role_assignments_system_role_ck" CHECK ((
        ("user_role_assignments"."role" = 'system_administrator' AND "user_role_assignments"."scope_type" = 'system')
        OR ("user_role_assignments"."role" <> 'system_administrator' AND "user_role_assignments"."scope_type" <> 'system')
      ))
);
--> statement-breakpoint
CREATE TABLE "user_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid,
	"email" varchar(320) NOT NULL,
	"display_name" varchar(160) NOT NULL,
	"password_hash" text,
	"status" "account_status" DEFAULT 'invited' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "academic_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_sessions_date_order_ck" CHECK ("academic_sessions"."ends_at" > "academic_sessions"."starts_at")
);
--> statement-breakpoint
CREATE TABLE "course_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"lecturer_user_id" uuid NOT NULL,
	"assignment_type" "course_assignment_type" DEFAULT 'lecturer' NOT NULL,
	"assigned_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_enrollments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_offering_id" uuid NOT NULL,
	"student_user_id" uuid NOT NULL,
	"status" "enrollment_status" DEFAULT 'active' NOT NULL,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "course_offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"course_id" uuid NOT NULL,
	"department_id" uuid NOT NULL,
	"semester_id" uuid NOT NULL,
	"level" varchar(32) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"code" varchar(32) NOT NULL,
	"title" varchar(200) NOT NULL,
	"credit_units" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "courses_credit_units_ck" CHECK ("courses"."credit_units" BETWEEN 0 AND 30)
);
--> statement-breakpoint
CREATE TABLE "semesters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"institution_id" uuid NOT NULL,
	"academic_session_id" uuid NOT NULL,
	"name" "semester_name" NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "semesters_date_order_ck" CHECK ("semesters"."ends_at" > "semesters"."starts_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX "departments_id_institution_uq" ON "departments" USING btree ("id","institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "faculties_id_institution_uq" ON "faculties" USING btree ("id","institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "lecturer_profiles_user_institution_uq" ON "lecturer_profiles" USING btree ("user_id","institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_profiles_user_institution_uq" ON "student_profiles" USING btree ("user_id","institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_id_institution_uq" ON "users" USING btree ("id","institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_sessions_id_institution_uq" ON "academic_sessions" USING btree ("id","institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_offerings_id_institution_uq" ON "course_offerings" USING btree ("id","institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_id_institution_uq" ON "courses" USING btree ("id","institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "semesters_id_institution_uq" ON "semesters" USING btree ("id","institution_id");--> statement-breakpoint
ALTER TABLE "campuses" ADD CONSTRAINT "campuses_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "departments" ADD CONSTRAINT "departments_faculty_institution_fk" FOREIGN KEY ("faculty_id","institution_id") REFERENCES "public"."faculties"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "faculties" ADD CONSTRAINT "faculties_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturer_profiles" ADD CONSTRAINT "lecturer_profiles_user_institution_fk" FOREIGN KEY ("user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturer_profiles" ADD CONSTRAINT "lecturer_profiles_department_institution_fk" FOREIGN KEY ("department_id","institution_id") REFERENCES "public"."departments"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_user_institution_fk" FOREIGN KEY ("user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_profiles" ADD CONSTRAINT "student_profiles_department_institution_fk" FOREIGN KEY ("department_id","institution_id") REFERENCES "public"."departments"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_user_institution_fk" FOREIGN KEY ("user_id","institution_id") REFERENCES "public"."users"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_faculty_institution_fk" FOREIGN KEY ("faculty_id","institution_id") REFERENCES "public"."faculties"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_department_institution_fk" FOREIGN KEY ("department_id","institution_id") REFERENCES "public"."departments"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_sessions" ADD CONSTRAINT "user_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "academic_sessions" ADD CONSTRAINT "academic_sessions_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_offering_institution_fk" FOREIGN KEY ("course_offering_id","institution_id") REFERENCES "public"."course_offerings"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_assignments" ADD CONSTRAINT "course_assignments_lecturer_institution_fk" FOREIGN KEY ("lecturer_user_id","institution_id") REFERENCES "public"."lecturer_profiles"("user_id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_offering_institution_fk" FOREIGN KEY ("course_offering_id","institution_id") REFERENCES "public"."course_offerings"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_student_institution_fk" FOREIGN KEY ("student_user_id","institution_id") REFERENCES "public"."student_profiles"("user_id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_course_institution_fk" FOREIGN KEY ("course_id","institution_id") REFERENCES "public"."courses"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_department_institution_fk" FOREIGN KEY ("department_id","institution_id") REFERENCES "public"."departments"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_offerings" ADD CONSTRAINT "course_offerings_semester_institution_fk" FOREIGN KEY ("semester_id","institution_id") REFERENCES "public"."semesters"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "courses" ADD CONSTRAINT "courses_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_institution_id_institutions_id_fk" FOREIGN KEY ("institution_id") REFERENCES "public"."institutions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "semesters" ADD CONSTRAINT "semesters_session_institution_fk" FOREIGN KEY ("academic_session_id","institution_id") REFERENCES "public"."academic_sessions"("id","institution_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "campuses_institution_code_uq" ON "campuses" USING btree ("institution_id","code");--> statement-breakpoint
CREATE UNIQUE INDEX "campuses_id_institution_uq" ON "campuses" USING btree ("id","institution_id");--> statement-breakpoint
CREATE INDEX "campuses_institution_active_idx" ON "campuses" USING btree ("institution_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "departments_faculty_code_uq" ON "departments" USING btree ("faculty_id","code");--> statement-breakpoint
CREATE INDEX "departments_faculty_active_idx" ON "departments" USING btree ("faculty_id","is_active");--> statement-breakpoint
CREATE INDEX "departments_institution_idx" ON "departments" USING btree ("institution_id");--> statement-breakpoint
CREATE UNIQUE INDEX "faculties_institution_code_uq" ON "faculties" USING btree ("institution_id","code");--> statement-breakpoint
CREATE INDEX "faculties_institution_active_idx" ON "faculties" USING btree ("institution_id","is_active");--> statement-breakpoint
CREATE UNIQUE INDEX "lecturer_profiles_institution_number_uq" ON "lecturer_profiles" USING btree ("institution_id","staff_number");--> statement-breakpoint
CREATE INDEX "lecturer_profiles_department_idx" ON "lecturer_profiles" USING btree ("institution_id","department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "student_profiles_institution_number_uq" ON "student_profiles" USING btree ("institution_id","student_number");--> statement-breakpoint
CREATE INDEX "student_profiles_department_idx" ON "student_profiles" USING btree ("institution_id","department_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_role_assignments_system_uq" ON "user_role_assignments" USING btree ("user_id","role") WHERE "user_role_assignments"."scope_type" = 'system';--> statement-breakpoint
CREATE UNIQUE INDEX "user_role_assignments_institution_uq" ON "user_role_assignments" USING btree ("user_id","role","institution_id") WHERE "user_role_assignments"."scope_type" = 'institution';--> statement-breakpoint
CREATE UNIQUE INDEX "user_role_assignments_faculty_uq" ON "user_role_assignments" USING btree ("user_id","role","faculty_id") WHERE "user_role_assignments"."scope_type" = 'faculty';--> statement-breakpoint
CREATE UNIQUE INDEX "user_role_assignments_department_uq" ON "user_role_assignments" USING btree ("user_id","role","department_id") WHERE "user_role_assignments"."scope_type" = 'department';--> statement-breakpoint
CREATE INDEX "user_role_assignments_user_scope_idx" ON "user_role_assignments" USING btree ("user_id","scope_type");--> statement-breakpoint
CREATE INDEX "user_role_assignments_institution_idx" ON "user_role_assignments" USING btree ("institution_id");--> statement-breakpoint
CREATE INDEX "user_sessions_user_expiry_idx" ON "user_sessions" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "user_sessions_expiry_idx" ON "user_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_institution_email_lower_uq" ON "users" USING btree ("institution_id",lower("email")) WHERE "users"."institution_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "users_platform_email_lower_uq" ON "users" USING btree (lower("email")) WHERE "users"."institution_id" IS NULL;--> statement-breakpoint
CREATE INDEX "users_institution_status_idx" ON "users" USING btree ("institution_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_sessions_institution_code_uq" ON "academic_sessions" USING btree ("institution_id","code");--> statement-breakpoint
CREATE INDEX "academic_sessions_institution_idx" ON "academic_sessions" USING btree ("institution_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "academic_sessions_one_current_per_institution_uq" ON "academic_sessions" USING btree ("institution_id") WHERE "academic_sessions"."is_current" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "course_assignments_offering_lecturer_type_uq" ON "course_assignments" USING btree ("course_offering_id","lecturer_user_id","assignment_type");--> statement-breakpoint
CREATE INDEX "course_assignments_lecturer_idx" ON "course_assignments" USING btree ("institution_id","lecturer_user_id","course_offering_id");--> statement-breakpoint
CREATE UNIQUE INDEX "course_enrollments_offering_student_uq" ON "course_enrollments" USING btree ("course_offering_id","student_user_id");--> statement-breakpoint
CREATE INDEX "course_enrollments_student_status_idx" ON "course_enrollments" USING btree ("institution_id","student_user_id","status");--> statement-breakpoint
CREATE INDEX "course_enrollments_offering_status_idx" ON "course_enrollments" USING btree ("institution_id","course_offering_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "course_offerings_course_department_semester_level_uq" ON "course_offerings" USING btree ("course_id","department_id","semester_id","level");--> statement-breakpoint
CREATE INDEX "course_offerings_department_semester_idx" ON "course_offerings" USING btree ("institution_id","department_id","semester_id");--> statement-breakpoint
CREATE INDEX "course_offerings_course_semester_idx" ON "course_offerings" USING btree ("institution_id","course_id","semester_id");--> statement-breakpoint
CREATE UNIQUE INDEX "courses_institution_code_lower_uq" ON "courses" USING btree ("institution_id",lower("code"));--> statement-breakpoint
CREATE INDEX "courses_institution_title_idx" ON "courses" USING btree ("institution_id","title");--> statement-breakpoint
CREATE UNIQUE INDEX "semesters_session_name_uq" ON "semesters" USING btree ("academic_session_id","name");--> statement-breakpoint
CREATE INDEX "semesters_session_dates_idx" ON "semesters" USING btree ("institution_id","academic_session_id","starts_at");