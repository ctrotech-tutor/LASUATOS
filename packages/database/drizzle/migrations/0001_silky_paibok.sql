ALTER TABLE "user_role_assignments" DROP CONSTRAINT "user_role_assignments_system_role_ck";--> statement-breakpoint
ALTER TABLE "user_role_assignments" ADD CONSTRAINT "user_role_assignments_role_scope_ck" CHECK ((
        ("user_role_assignments"."role" = 'system_administrator' AND "user_role_assignments"."scope_type" = 'system')
        OR ("user_role_assignments"."role" = 'institution_administrator' AND "user_role_assignments"."scope_type" = 'institution')
        OR ("user_role_assignments"."role" = 'faculty_administrator' AND "user_role_assignments"."scope_type" = 'faculty')
        OR ("user_role_assignments"."role" = 'department_administrator' AND "user_role_assignments"."scope_type" = 'department')
        OR ("user_role_assignments"."role" IN ('student', 'lecturer', 'course_coordinator') AND "user_role_assignments"."scope_type" IN ('institution', 'faculty', 'department'))
      ));