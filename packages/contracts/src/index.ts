import { z } from 'zod';

export const userRoles = [
  'student',
  'lecturer',
  'course_coordinator',
  'department_administrator',
  'faculty_administrator',
  'institution_administrator',
  'system_administrator',
] as const;

export const UserRoleSchema = z.enum(userRoles);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const ApiProblemSchema = z.object({
  type: z.string(),
  title: z.string(),
  status: z.number().int().min(400).max(599),
  detail: z.string().optional(),
  instance: z.string().optional(),
  requestId: z.string().optional(),
});
export type ApiProblem = z.infer<typeof ApiProblemSchema>;

export const ApiHealthSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('lasuatos-api'),
  timestamp: z.iso.datetime(),
});
export type ApiHealth = z.infer<typeof ApiHealthSchema>;

export const DatabaseReadinessSchema = z.enum(['up', 'down', 'not_configured']);
export type DatabaseReadiness = z.infer<typeof DatabaseReadinessSchema>;

export const ApiReadinessSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('ready'),
    checks: z.object({ database: z.literal('up') }),
  }),
  z.object({
    status: z.literal('not_ready'),
    checks: z.object({ database: z.enum(['down', 'not_configured']) }),
  }),
]);
export type ApiReadiness = z.infer<typeof ApiReadinessSchema>;

export const AuthStudentSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  displayName: z.string().min(1).max(160),
  accountType: z.literal('student'),
  emailVerified: z.literal(true),
  matricNumber: z.string().min(1).max(64),
  matricNumberVerified: z.boolean(),
  sessionExpiresAt: z.iso.datetime(),
});
export type AuthStudent = z.infer<typeof AuthStudentSchema>;

export const AuthenticatedSessionSchema = z.object({
  status: z.literal('authenticated'),
  student: AuthStudentSchema,
});
export type AuthenticatedSession = z.infer<typeof AuthenticatedSessionSchema>;

export const RegistrationAcceptedSchema = z.object({
  status: z.literal('accepted'),
  message: z.string(),
});
export type RegistrationAccepted = z.infer<typeof RegistrationAcceptedSchema>;

export const EmailVerifiedSchema = z.object({
  status: z.literal('verified'),
  student: AuthStudentSchema,
});
export type EmailVerified = z.infer<typeof EmailVerifiedSchema>;
