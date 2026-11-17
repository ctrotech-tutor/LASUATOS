import { and, asc, desc, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  attendanceDisputes,
  attendanceSessions,
  courseAssignments,
  courseOfferings,
  courses,
  departments,
  lectureSessions,
  semesters,
  faculties,
  institutions,
  lecturerProfiles,
  staffAuditEvents,
  staffInvitations,
  userRoleAssignments,
  userSessions,
  users,
  type DatabaseClient,
} from '@lasuatos/database';
import type { StaffRole } from '@lasuatos/contracts';
import type { StaffPosition } from './policy.js';
import type {
  AcceptInvitationResult,
  ChangePositionResult,
  LeavingCourseRecord,
  PositionImpactRecord,
  CreateInvitationInput,
  CreateInvitationResult,
  InvitationPreviewRecord,
  PlacementRequest,
  ResolvedPlacement,
  StaffInvitationRecord,
  StaffMemberRecord,
  StaffRepository,
} from './repository.js';

const STAFF_ROLE_NAMES: Readonly<Record<StaffRole, string>> = {
  lecturer: 'Lecturer',
  department_administrator: 'Department administrator',
  faculty_administrator: 'Faculty administrator',
  institution_administrator: 'Institution administrator',
};

const STAFF_ROLES: readonly StaffRole[] = [
  'lecturer',
  'department_administrator',
  'faculty_administrator',
  'institution_administrator',
];

type Executor = Pick<DatabaseClient, 'select' | 'insert' | 'update' | 'delete'>;

/** True when a position lets its holder teach an offering of this department (lecturers, own department only). */
function teachesIn(position: StaffPosition, departmentId: string): boolean {
  return position.role === 'lecturer' && position.departmentId === departmentId;
}

const AUDIT_TEXT_MAX = 1_900;

interface DirectoryMaps {
  readonly institutionName: string;
  readonly faculties: ReadonlyMap<string, { readonly name: string; readonly isActive: boolean }>;
  readonly departments: ReadonlyMap<string, {
    readonly name: string;
    readonly facultyId: string;
    readonly isActive: boolean;
  }>;
}

function positionFor(
  maps: DirectoryMaps,
  institutionId: string,
  role: StaffRole,
  facultyId: string | null,
  departmentId: string | null,
): StaffPosition {
  if (role === 'institution_administrator') return { institutionId, role, facultyId: null, departmentId: null };
  if (role === 'faculty_administrator') return { institutionId, role, facultyId, departmentId: null };
  const department = departmentId ? maps.departments.get(departmentId) : undefined;
  return { institutionId, role, facultyId: department?.facultyId ?? null, departmentId };
}

function labelFor(maps: DirectoryMaps, position: StaffPosition): string {
  if (position.role === 'institution_administrator') return maps.institutionName;
  if (position.role === 'faculty_administrator') {
    return (position.facultyId && maps.faculties.get(position.facultyId)?.name) || 'Unknown faculty';
  }
  const department = position.departmentId ? maps.departments.get(position.departmentId) : undefined;
  if (!department) return 'Unknown department';
  const faculty = maps.faculties.get(department.facultyId);
  return faculty ? `${department.name}, ${faculty.name}` : department.name;
}

function placementIsActive(maps: DirectoryMaps, position: StaffPosition): boolean {
  if (position.role === 'institution_administrator') return true;
  if (position.role === 'faculty_administrator') {
    return Boolean(position.facultyId && maps.faculties.get(position.facultyId)?.isActive);
  }
  const department = position.departmentId ? maps.departments.get(position.departmentId) : undefined;
  return Boolean(department?.isActive && maps.faculties.get(department.facultyId)?.isActive);
}

function audit(
  executor: Executor,
  values: {
    institutionId: string;
    actorUserId: string | null;
    action: (typeof staffAuditEvents.$inferInsert)['action'];
    targetUserId?: string | null;
    invitationId?: string | null;
    reason?: string | null;
    createdAt: Date;
  },
) {
  return executor.insert(staffAuditEvents).values({
    institutionId: values.institutionId,
    actorUserId: values.actorUserId,
    action: values.action,
    targetUserId: values.targetUserId ?? null,
    invitationId: values.invitationId ?? null,
    reason: values.reason ?? null,
    createdAt: values.createdAt,
  });
}

export class PostgresStaffRepository implements StaffRepository {
  constructor(private readonly database: DatabaseClient) {}

  private async directoryMaps(executor: Executor, institutionId: string): Promise<DirectoryMaps> {
    const [institution, facultyRows, departmentRows] = await Promise.all([
      executor.select({ name: institutions.name }).from(institutions).where(eq(institutions.id, institutionId)).limit(1),
      executor
        .select({ id: faculties.id, name: faculties.name, isActive: faculties.isActive })
        .from(faculties)
        .where(eq(faculties.institutionId, institutionId)),
      executor
        .select({ id: departments.id, name: departments.name, facultyId: departments.facultyId, isActive: departments.isActive })
        .from(departments)
        .where(eq(departments.institutionId, institutionId)),
    ]);
    return {
      institutionName: institution[0]?.name ?? 'Institution',
      faculties: new Map(facultyRows.map((row) => [row.id, row])),
      departments: new Map(departmentRows.map((row) => [row.id, row])),
    };
  }

  async findInstitution(slug: string) {
    const [row] = await this.database
      .select({ id: institutions.id, name: institutions.name })
      .from(institutions)
      .where(eq(institutions.slug, slug))
      .limit(1);
    return row ?? null;
  }

  async findUnitIdByCode(institutionId: string, kind: 'faculty' | 'department', code: string): Promise<string | null> {
    const table = kind === 'faculty' ? faculties : departments;
    const [row] = await this.database
      .select({ id: table.id })
      .from(table)
      .where(and(eq(table.institutionId, institutionId), sql`upper(${table.code}) = ${code.trim().toUpperCase()}`))
      .limit(1);
    return row?.id ?? null;
  }

  async resolvePlacement(institutionId: string, placement: PlacementRequest): Promise<ResolvedPlacement | null> {
    const maps = await this.directoryMaps(this.database, institutionId);
    const position = positionFor(maps, institutionId, placement.role, placement.facultyId, placement.departmentId);
    if (!placementIsActive(maps, position)) return null;
    return { position, scopeLabel: labelFor(maps, position) };
  }

  async listScopeOptions(institutionId: string) {
    const maps = await this.directoryMaps(this.database, institutionId);
    const activeFaculties = [...maps.faculties].filter(([, faculty]) => faculty.isActive);
    const facultyCodes = await this.database
      .select({ id: faculties.id, code: faculties.code })
      .from(faculties)
      .where(eq(faculties.institutionId, institutionId));
    const departmentCodes = await this.database
      .select({ id: departments.id, code: departments.code })
      .from(departments)
      .where(eq(departments.institutionId, institutionId));
    const facultyCode = new Map(facultyCodes.map((row) => [row.id, row.code]));
    const departmentCode = new Map(departmentCodes.map((row) => [row.id, row.code]));
    return {
      faculties: activeFaculties
        .map(([id, faculty]) => ({ id, code: facultyCode.get(id) ?? '', name: faculty.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      departments: [...maps.departments]
        .filter(([, department]) => department.isActive && maps.faculties.get(department.facultyId)?.isActive)
        .map(([id, department]) => ({
          id,
          code: departmentCode.get(id) ?? '',
          name: department.name,
          facultyId: department.facultyId,
          facultyName: maps.faculties.get(department.facultyId)?.name ?? '',
        }))
        .sort((a, b) => a.facultyName.localeCompare(b.facultyName) || a.name.localeCompare(b.name)),
    };
  }

  async createInvitation(input: CreateInvitationInput): Promise<CreateInvitationResult> {
    const outcome = await this.database.transaction(async (transaction) => {
      const [existingUser] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.institutionId, input.institutionId), sql`lower(${users.email}) = ${input.email}`))
        .limit(1);
      if (existingUser) return { kind: 'account_exists' as const };

      const [pending] = await transaction
        .select({ id: staffInvitations.id, expiresAt: staffInvitations.expiresAt })
        .from(staffInvitations)
        .where(and(
          eq(staffInvitations.institutionId, input.institutionId),
          sql`lower(${staffInvitations.email}) = ${input.email}`,
          isNull(staffInvitations.acceptedAt),
          isNull(staffInvitations.revokedAt),
        ))
        .for('update')
        .limit(1);
      if (pending && pending.expiresAt > input.sentAt) return { kind: 'pending_exists' as const };
      if (pending) {
        // An expired, unused invitation is closed so a fresh one can be sent.
        await transaction
          .update(staffInvitations)
          .set({ revokedAt: input.sentAt, revokedByUserId: input.invitedByUserId })
          .where(eq(staffInvitations.id, pending.id));
        await audit(transaction, {
          institutionId: input.institutionId,
          actorUserId: input.invitedByUserId,
          action: 'invitation_revoked',
          invitationId: pending.id,
          reason: 'Expired without being accepted; replaced by a new invitation.',
          createdAt: input.sentAt,
        });
      }

      if (input.staffNumber) {
        const [taken] = await transaction
          .select({ userId: lecturerProfiles.userId })
          .from(lecturerProfiles)
          .where(and(
            eq(lecturerProfiles.institutionId, input.institutionId),
            eq(lecturerProfiles.staffNumber, input.staffNumber),
          ))
          .limit(1);
        if (taken) return { kind: 'staff_number_taken' as const };
      }

      const [created] = await transaction
        .insert(staffInvitations)
        .values({
          institutionId: input.institutionId,
          email: input.email,
          displayName: input.displayName,
          role: input.placement.role,
          facultyId: input.placement.role === 'faculty_administrator' ? input.placement.facultyId : null,
          departmentId: input.placement.role === 'lecturer' || input.placement.role === 'department_administrator'
            ? input.placement.departmentId
            : null,
          staffNumber: input.placement.role === 'lecturer' ? input.staffNumber : null,
          tokenHash: input.tokenHash,
          sentAt: input.sentAt,
          expiresAt: input.expiresAt,
          invitedByUserId: input.invitedByUserId,
          createdAt: input.sentAt,
        })
        .onConflictDoNothing()
        .returning({ id: staffInvitations.id });
      if (!created) return { kind: 'pending_exists' as const };
      await audit(transaction, {
        institutionId: input.institutionId,
        actorUserId: input.invitedByUserId,
        action: 'invitation_created',
        invitationId: created.id,
        createdAt: input.sentAt,
      });
      return { kind: 'created' as const, id: created.id };
    });

    if (outcome.kind !== 'created') return outcome;
    const invitation = await this.findInvitation(input.institutionId, outcome.id);
    if (!invitation) throw new Error('Created invitation could not be read back.');
    return { kind: 'created', invitation };
  }

  private async invitationRecords(institutionId: string, invitationId?: string): Promise<StaffInvitationRecord[]> {
    const inviters = alias(users, 'staff_inviters');
    const rows = await this.database
      .select({
        id: staffInvitations.id,
        email: staffInvitations.email,
        displayName: staffInvitations.displayName,
        role: staffInvitations.role,
        facultyId: staffInvitations.facultyId,
        departmentId: staffInvitations.departmentId,
        staffNumber: staffInvitations.staffNumber,
        invitedByName: inviters.displayName,
        sentAt: staffInvitations.sentAt,
        expiresAt: staffInvitations.expiresAt,
        acceptedAt: staffInvitations.acceptedAt,
        revokedAt: staffInvitations.revokedAt,
      })
      .from(staffInvitations)
      .leftJoin(inviters, eq(inviters.id, staffInvitations.invitedByUserId))
      .where(and(
        eq(staffInvitations.institutionId, institutionId),
        invitationId ? eq(staffInvitations.id, invitationId) : and(isNull(staffInvitations.acceptedAt), isNull(staffInvitations.revokedAt)),
      ))
      .orderBy(desc(staffInvitations.sentAt))
      .limit(invitationId ? 1 : 500);
    if (!rows.length) return [];
    const maps = await this.directoryMaps(this.database, institutionId);
    return rows.map((row) => {
      const position = positionFor(maps, institutionId, row.role, row.facultyId, row.departmentId);
      return {
        id: row.id,
        email: row.email,
        displayName: row.displayName,
        role: row.role,
        position,
        scopeLabel: labelFor(maps, position),
        staffNumber: row.staffNumber,
        invitedByName: row.invitedByName ?? null,
        sentAt: row.sentAt,
        expiresAt: row.expiresAt,
        state: row.acceptedAt ? 'accepted' : row.revokedAt ? 'revoked' : 'pending',
      };
    });
  }

  async listInvitations(institutionId: string): Promise<StaffInvitationRecord[]> {
    return this.invitationRecords(institutionId);
  }

  async findInvitation(institutionId: string, invitationId: string): Promise<StaffInvitationRecord | null> {
    return (await this.invitationRecords(institutionId, invitationId))[0] ?? null;
  }

  async reissueInvitation(input: {
    readonly invitationId: string;
    readonly institutionId: string;
    readonly tokenHash: string;
    readonly sentAt: Date;
    readonly expiresAt: Date;
    readonly actorUserId: string;
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(staffInvitations)
        .set({ tokenHash: input.tokenHash, sentAt: input.sentAt, expiresAt: input.expiresAt })
        .where(and(
          eq(staffInvitations.id, input.invitationId),
          eq(staffInvitations.institutionId, input.institutionId),
          isNull(staffInvitations.acceptedAt),
          isNull(staffInvitations.revokedAt),
        ))
        .returning({ id: staffInvitations.id });
      if (!updated.length) return false;
      await audit(transaction, {
        institutionId: input.institutionId,
        actorUserId: input.actorUserId,
        action: 'invitation_resent',
        invitationId: input.invitationId,
        createdAt: input.sentAt,
      });
      return true;
    });
  }

  async revokeInvitation(input: {
    readonly invitationId: string;
    readonly institutionId: string;
    readonly actorUserId: string;
    readonly now: Date;
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(staffInvitations)
        .set({ revokedAt: input.now, revokedByUserId: input.actorUserId })
        .where(and(
          eq(staffInvitations.id, input.invitationId),
          eq(staffInvitations.institutionId, input.institutionId),
          isNull(staffInvitations.acceptedAt),
          isNull(staffInvitations.revokedAt),
        ))
        .returning({ id: staffInvitations.id });
      if (!updated.length) return false;
      await audit(transaction, {
        institutionId: input.institutionId,
        actorUserId: input.actorUserId,
        action: 'invitation_revoked',
        invitationId: input.invitationId,
        createdAt: input.now,
      });
      return true;
    });
  }

  async previewInvitation(tokenHash: string, now: Date): Promise<InvitationPreviewRecord | null> {
    const inviters = alias(users, 'staff_preview_inviters');
    const [row] = await this.database
      .select({
        institutionId: staffInvitations.institutionId,
        email: staffInvitations.email,
        displayName: staffInvitations.displayName,
        role: staffInvitations.role,
        facultyId: staffInvitations.facultyId,
        departmentId: staffInvitations.departmentId,
        invitedByName: inviters.displayName,
        expiresAt: staffInvitations.expiresAt,
        staffNumber: staffInvitations.staffNumber,
      })
      .from(staffInvitations)
      .leftJoin(inviters, eq(inviters.id, staffInvitations.invitedByUserId))
      .where(and(
        eq(staffInvitations.tokenHash, tokenHash),
        isNull(staffInvitations.acceptedAt),
        isNull(staffInvitations.revokedAt),
        gt(staffInvitations.expiresAt, now),
      ))
      .limit(1);
    if (!row) return null;
    const maps = await this.directoryMaps(this.database, row.institutionId);
    const position = positionFor(maps, row.institutionId, row.role, row.facultyId, row.departmentId);
    return {
      displayName: row.displayName,
      email: row.email,
      role: row.role,
      scopeLabel: labelFor(maps, position),
      institutionName: maps.institutionName,
      invitedByName: row.invitedByName ?? null,
      expiresAt: row.expiresAt,
      staffNumber: row.role === 'lecturer' ? row.staffNumber : null,
    };
  }

  async acceptInvitation(input: {
    readonly tokenHash: string;
    readonly passwordHash: string;
    readonly staffNumber?: string | null | undefined;
    readonly now: Date;
  }): Promise<AcceptInvitationResult> {
    return this.database.transaction(async (transaction) => {
      const [invitation] = await transaction
        .select()
        .from(staffInvitations)
        .where(and(
          eq(staffInvitations.tokenHash, input.tokenHash),
          isNull(staffInvitations.acceptedAt),
          isNull(staffInvitations.revokedAt),
          gt(staffInvitations.expiresAt, input.now),
        ))
        .for('update')
        .limit(1);
      if (!invitation) return { kind: 'invalid' as const };

      const maps = await this.directoryMaps(transaction, invitation.institutionId);
      const position = positionFor(maps, invitation.institutionId, invitation.role, invitation.facultyId, invitation.departmentId);
      if (!placementIsActive(maps, position)) return { kind: 'conflict' as const, reason: 'placement_inactive' as const };

      const [existingUser] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.institutionId, invitation.institutionId), sql`lower(${users.email}) = lower(${invitation.email})`))
        .limit(1);
      if (existingUser) return { kind: 'conflict' as const, reason: 'account_exists' as const };

      // The lecturer's own entry wins over what the administrator typed (they know their number).
      const staffNumber = invitation.role === 'lecturer'
        ? (input.staffNumber === undefined ? invitation.staffNumber : input.staffNumber)
        : null;
      if (staffNumber) {
        const [taken] = await transaction
          .select({ userId: lecturerProfiles.userId })
          .from(lecturerProfiles)
          .where(and(
            eq(lecturerProfiles.institutionId, invitation.institutionId),
            eq(lecturerProfiles.staffNumber, staffNumber),
          ))
          .limit(1);
        if (taken) return { kind: 'conflict' as const, reason: 'staff_number_taken' as const };
      }

      const [user] = await transaction
        .insert(users)
        .values({
          institutionId: invitation.institutionId,
          email: invitation.email,
          displayName: invitation.displayName,
          passwordHash: input.passwordHash,
          status: 'active',
          // The invitation link was delivered to this mailbox, so opening it confirms the address.
          emailVerifiedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .returning({ id: users.id });
      if (!user) throw new Error('Staff account could not be created.');

      if (invitation.role === 'lecturer') {
        await transaction.insert(lecturerProfiles).values({
          userId: user.id,
          institutionId: invitation.institutionId,
          departmentId: invitation.departmentId!,
          staffNumber,
        });
      }
      await transaction.insert(userRoleAssignments).values({
        userId: user.id,
        role: invitation.role,
        institutionId: invitation.institutionId,
        ...(invitation.role === 'institution_administrator'
          ? { scopeType: 'institution' as const, facultyId: null, departmentId: null }
          : invitation.role === 'faculty_administrator'
            ? { scopeType: 'faculty' as const, facultyId: invitation.facultyId, departmentId: null }
            : { scopeType: 'department' as const, facultyId: null, departmentId: invitation.departmentId }),
      });
      await transaction
        .update(staffInvitations)
        .set({ acceptedAt: input.now, acceptedUserId: user.id })
        .where(eq(staffInvitations.id, invitation.id));
      await audit(transaction, {
        institutionId: invitation.institutionId,
        actorUserId: user.id,
        action: 'invitation_accepted',
        targetUserId: user.id,
        invitationId: invitation.id,
        createdAt: input.now,
      });
      return { kind: 'accepted' as const, userId: user.id };
    });
  }

  async listMembers(institutionId: string, activitySince = new Date(Date.now() - 30 * 86_400_000)): Promise<StaffMemberRecord[]> {
    const since = activitySince.toISOString();
    const rows = await this.database
      .select({
        userId: users.id,
        email: users.email,
        displayName: users.displayName,
        status: users.status,
        joinedAt: users.createdAt,
        role: userRoleAssignments.role,
        facultyId: userRoleAssignments.facultyId,
        assignmentDepartmentId: userRoleAssignments.departmentId,
        profileDepartmentId: lecturerProfiles.departmentId,
        staffNumber: lecturerProfiles.staffNumber,
        lastActiveAt: sql<string | null>`(select max(coalesce(us.last_seen_at, us.created_at)) from user_sessions us where us.user_id = ${users.id})`,
        recentSessions: sql<number>`(select count(*)::int from lecture_sessions ls where ls.created_by_user_id = ${users.id} and ls.starts_at >= ${since}::timestamptz)`,
        lastSessionAt: sql<string | null>`(select max(ls.starts_at) from lecture_sessions ls where ls.created_by_user_id = ${users.id})`,
      })
      .from(userRoleAssignments)
      .innerJoin(users, eq(users.id, userRoleAssignments.userId))
      .leftJoin(lecturerProfiles, eq(lecturerProfiles.userId, users.id))
      .where(and(
        eq(userRoleAssignments.institutionId, institutionId),
        inArray(userRoleAssignments.role, [...STAFF_ROLES]),
        inArray(users.status, ['active', 'suspended']),
      ))
      .orderBy(asc(users.displayName), asc(users.id))
      .limit(2_000);
    if (!rows.length) return [];
    const maps = await this.directoryMaps(this.database, institutionId);
    return rows.map((row) => {
      const role = row.role as StaffRole;
      const departmentId = role === 'lecturer' ? row.profileDepartmentId ?? row.assignmentDepartmentId : row.assignmentDepartmentId;
      const position = positionFor(maps, institutionId, role, row.facultyId, departmentId);
      return {
        userId: row.userId,
        email: row.email,
        displayName: row.displayName,
        position,
        scopeLabel: labelFor(maps, position),
        staffNumber: role === 'lecturer' ? row.staffNumber ?? null : null,
        status: row.status === 'suspended' ? 'suspended' : 'active',
        joinedAt: row.joinedAt,
        lastActiveAt: row.lastActiveAt ? new Date(row.lastActiveAt) : null,
        recentSessions: Number(row.recentSessions ?? 0),
        lastSessionAt: row.lastSessionAt ? new Date(row.lastSessionAt) : null,
      };
    });
  }

  async findMember(institutionId: string, userId: string): Promise<StaffMemberRecord | null> {
    return (await this.listMembers(institutionId)).find((member) => member.userId === userId) ?? null;
  }

  async setMemberStatus(input: {
    readonly institutionId: string;
    readonly userId: string;
    readonly status: 'active' | 'suspended';
    readonly actorUserId: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const updated = await transaction
        .update(users)
        .set({ status: input.status, updatedAt: input.now })
        .where(and(
          eq(users.id, input.userId),
          eq(users.institutionId, input.institutionId),
          eq(users.status, input.status === 'suspended' ? 'active' : 'suspended'),
        ))
        .returning({ id: users.id });
      if (!updated.length) return false;
      if (input.status === 'suspended') {
        await transaction
          .update(userSessions)
          .set({ revokedAt: input.now })
          .where(and(eq(userSessions.userId, input.userId), isNull(userSessions.revokedAt)));
      }
      await audit(transaction, {
        institutionId: input.institutionId,
        actorUserId: input.actorUserId,
        action: input.status === 'suspended' ? 'staff_suspended' : 'staff_reactivated',
        targetUserId: input.userId,
        reason: input.reason,
        createdAt: input.now,
      });
      return true;
    });
  }
  /** Course assignments (this semester or later) the move from `from` to `to` would end, with what they affect. */
  private async leavingAssignments(executor: Executor, input: {
    readonly institutionId: string;
    readonly userId: string;
    readonly from: StaffPosition;
    readonly to: StaffPosition;
    readonly now: Date;
  }): Promise<{ readonly assignmentIds: string[]; readonly offeringIds: string[]; readonly courses: LeavingCourseRecord[] }> {
    const rows = await executor
      .select({
        assignmentId: courseAssignments.id,
        offeringId: courseOfferings.id,
        departmentId: courseOfferings.departmentId,
        courseCode: courses.code,
        courseTitle: courses.title,
        departmentName: departments.name,
        semesterName: semesters.name,
      })
      .from(courseAssignments)
      .innerJoin(courseOfferings, and(
        eq(courseOfferings.id, courseAssignments.courseOfferingId),
        eq(courseOfferings.institutionId, courseAssignments.institutionId),
      ))
      .innerJoin(courses, eq(courses.id, courseOfferings.courseId))
      .innerJoin(departments, eq(departments.id, courseOfferings.departmentId))
      .innerJoin(semesters, eq(semesters.id, courseOfferings.semesterId))
      .where(and(
        eq(courseAssignments.institutionId, input.institutionId),
        eq(courseAssignments.lecturerUserId, input.userId),
        gt(semesters.endsAt, input.now),
      ))
      .orderBy(asc(courses.code))
      .limit(500);
    // Only what they can teach now and could not after the move. Assignments the current
    // place already does not cover were not working before, so they are left alone.
    const leaving = rows.filter((row) => teachesIn(input.from, row.departmentId) && !teachesIn(input.to, row.departmentId));
    if (!leaving.length) return { assignmentIds: [], offeringIds: [], courses: [] };
    const offeringIds = [...new Set(leaving.map((row) => row.offeringId))];
    const others = await executor
      .select({ offeringId: courseAssignments.courseOfferingId, count: sql<number>`count(distinct ${courseAssignments.lecturerUserId})::int` })
      .from(courseAssignments)
      .where(and(
        inArray(courseAssignments.courseOfferingId, offeringIds),
        ne(courseAssignments.lecturerUserId, input.userId),
        eq(courseAssignments.assignmentType, 'lecturer'),
      ))
      .groupBy(courseAssignments.courseOfferingId);
    const otherCount = new Map(others.map((row) => [row.offeringId, Number(row.count)]));
    const seen = new Set<string>();
    const courseList: LeavingCourseRecord[] = [];
    for (const row of leaving) {
      if (seen.has(row.offeringId)) continue;
      seen.add(row.offeringId);
      courseList.push({
        courseCode: row.courseCode,
        courseTitle: row.courseTitle,
        departmentName: row.departmentName,
        semesterName: row.semesterName,
        otherLecturers: otherCount.get(row.offeringId) ?? 0,
      });
    }
    return { assignmentIds: leaving.map((row) => row.assignmentId), offeringIds, courses: courseList };
  }

  private async isTeachingNow(executor: Executor, userId: string, now: Date): Promise<boolean> {
    const [lecture, session] = await Promise.all([
      executor
        .select({ id: lectureSessions.id })
        .from(lectureSessions)
        .where(and(
          eq(lectureSessions.createdByUserId, userId),
          isNull(lectureSessions.closedAt),
          lte(lectureSessions.startsAt, now),
          gt(lectureSessions.endsAt, now),
        ))
        .limit(1),
      executor
        .select({ id: attendanceSessions.id })
        .from(attendanceSessions)
        .where(and(
          eq(attendanceSessions.lecturerUserId, userId),
          eq(attendanceSessions.status, 'open'),
          lte(attendanceSessions.startsAt, now),
          gt(attendanceSessions.endsAt, now),
        ))
        .limit(1),
    ]);
    return lecture.length > 0 || session.length > 0;
  }

  async positionImpact(input: {
    readonly institutionId: string;
    readonly userId: string;
    readonly from: StaffPosition;
    readonly to: StaffPosition;
    readonly now: Date;
  }): Promise<PositionImpactRecord> {
    const [leaving, teachingNow] = await Promise.all([
      this.leavingAssignments(this.database, input),
      this.isTeachingNow(this.database, input.userId, input.now),
    ]);
    let openDisputes = 0;
    if (leaving.offeringIds.length) {
      const [row] = await this.database
        .select({ count: sql<number>`count(*)::int` })
        .from(attendanceDisputes)
        .where(and(
          eq(attendanceDisputes.institutionId, input.institutionId),
          inArray(attendanceDisputes.courseOfferingId, leaving.offeringIds),
          eq(attendanceDisputes.status, 'open'),
        ));
      openDisputes = Number(row?.count ?? 0);
    }
    return { coursesLeaving: leaving.courses, openDisputes, teachingNow };
  }

  async changeMemberPosition(input: {
    readonly institutionId: string;
    readonly userId: string;
    readonly actorUserId: string;
    readonly from: StaffPosition;
    readonly to: StaffPosition;
    readonly fromLabel: string;
    readonly toLabel: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<ChangePositionResult> {
    return this.database.transaction(async (transaction) => {
      const [user] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(and(
          eq(users.id, input.userId),
          eq(users.institutionId, input.institutionId),
          inArray(users.status, ['active', 'suspended']),
        ))
        .for('update', { of: users })
        .limit(1);
      if (!user) return { kind: 'stale' as const };

      // Their role must still be the one the administrator saw.
      const [assignments, [profile], maps] = await Promise.all([
        transaction
          .select({ role: userRoleAssignments.role, facultyId: userRoleAssignments.facultyId, departmentId: userRoleAssignments.departmentId })
          .from(userRoleAssignments)
          .where(and(
            eq(userRoleAssignments.userId, user.id),
            eq(userRoleAssignments.institutionId, input.institutionId),
            inArray(userRoleAssignments.role, [...STAFF_ROLES]),
          )),
        transaction
          .select({ departmentId: lecturerProfiles.departmentId })
          .from(lecturerProfiles)
          .where(eq(lecturerProfiles.userId, user.id))
          .limit(1),
        this.directoryMaps(transaction, input.institutionId),
      ]);
      const current = assignments.map((row) => positionFor(
        maps,
        input.institutionId,
        row.role as StaffRole,
        row.facultyId,
        row.role === 'lecturer' ? profile?.departmentId ?? row.departmentId : row.departmentId,
      ));
      const same = (a: StaffPosition, b: StaffPosition) => a.role === b.role && a.facultyId === b.facultyId && a.departmentId === b.departmentId;
      if (current.length !== 1 || !same(current[0]!, input.from)) return { kind: 'stale' as const };
      if (await this.isTeachingNow(transaction, user.id, input.now)) return { kind: 'teaching_now' as const };

      const leaving = await this.leavingAssignments(transaction, { ...input, userId: user.id });
      if (leaving.assignmentIds.length) {
        await transaction.delete(courseAssignments).where(inArray(courseAssignments.id, leaving.assignmentIds));
      }
      await transaction.delete(userRoleAssignments).where(and(
        eq(userRoleAssignments.userId, user.id),
        eq(userRoleAssignments.institutionId, input.institutionId),
        inArray(userRoleAssignments.role, [...STAFF_ROLES]),
      ));
      const to = input.to;
      await transaction.insert(userRoleAssignments).values({
        userId: user.id,
        role: to.role,
        institutionId: input.institutionId,
        ...(to.role === 'institution_administrator'
          ? { scopeType: 'institution' as const, facultyId: null, departmentId: null }
          : to.role === 'faculty_administrator'
            ? { scopeType: 'faculty' as const, facultyId: to.facultyId, departmentId: null }
            : { scopeType: 'department' as const, facultyId: null, departmentId: to.departmentId }),
        createdAt: input.now,
      });
      if (to.role === 'lecturer') {
        // A lecturer's department lives on their profile too. An earlier profile (they taught
        // before) is reused, keeping their staff number and past courses.
        if (profile) {
          await transaction
            .update(lecturerProfiles)
            .set({ departmentId: to.departmentId!, updatedAt: input.now })
            .where(eq(lecturerProfiles.userId, user.id));
        } else {
          await transaction.insert(lecturerProfiles).values({
            userId: user.id,
            institutionId: input.institutionId,
            departmentId: to.departmentId!,
            staffNumber: null,
            createdAt: input.now,
            updatedAt: input.now,
          });
        }
      }
      const fromRole = STAFF_ROLE_NAMES[input.from.role];
      const toRole = STAFF_ROLE_NAMES[to.role];
      const parts = [
        ...(fromRole !== toRole ? [`Role: ${fromRole} → ${toRole}`] : []),
        ...(input.fromLabel !== input.toLabel ? [`Area: ${input.fromLabel} → ${input.toLabel}`] : []),
        ...(leaving.courses.length ? [`Courses handed back: ${leaving.courses.map((course) => course.courseCode).join(', ')}`] : []),
      ];
      const why = input.reason.replace(/\s+/g, ' ').trim();
      await audit(transaction, {
        institutionId: input.institutionId,
        actorUserId: input.actorUserId,
        action: 'staff_role_changed',
        targetUserId: user.id,
        reason: `${parts.join('; ')}; Why: ${why}`.slice(0, AUDIT_TEXT_MAX),
        createdAt: input.now,
      });
      return { kind: 'changed' as const, coursesLeft: leaving.courses };
    });
  }

  async updateMember(input: {
    readonly institutionId: string;
    readonly userId: string;
    readonly actorUserId: string;
    readonly displayName?: string | undefined;
    readonly staffNumber?: string | null | undefined;
    readonly now: Date;
  }): Promise<'updated' | 'missing' | 'staff_number_taken'> {
    return this.database.transaction(async (transaction) => {
      const [user] = await transaction
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(and(eq(users.id, input.userId), eq(users.institutionId, input.institutionId)))
        .for('update', { of: users })
        .limit(1);
      if (!user) return 'missing';
      const notes: string[] = [];
      if (input.displayName !== undefined && input.displayName !== user.displayName) {
        await transaction
          .update(users)
          .set({ displayName: input.displayName, updatedAt: input.now })
          .where(eq(users.id, user.id));
        notes.push(`Name: ${user.displayName} → ${input.displayName}`);
      }
      if (input.staffNumber !== undefined) {
        const [profile] = await transaction
          .select({ staffNumber: lecturerProfiles.staffNumber })
          .from(lecturerProfiles)
          .where(eq(lecturerProfiles.userId, user.id))
          .limit(1);
        if (!profile) return 'missing';
        if (profile.staffNumber !== input.staffNumber && input.staffNumber !== null) {
          const [clash] = await transaction
            .select({ userId: lecturerProfiles.userId })
            .from(lecturerProfiles)
            .where(and(
              eq(lecturerProfiles.institutionId, input.institutionId),
              eq(lecturerProfiles.staffNumber, input.staffNumber),
              ne(lecturerProfiles.userId, user.id),
            ))
            .limit(1);
          if (clash) return 'staff_number_taken';
        }
        if (profile.staffNumber !== input.staffNumber) {
          await transaction
            .update(lecturerProfiles)
            .set({ staffNumber: input.staffNumber, updatedAt: input.now })
            .where(eq(lecturerProfiles.userId, user.id));
          notes.push(`Staff number: ${profile.staffNumber ?? 'none'} → ${input.staffNumber ?? 'none'}`);
        }
      }
      if (notes.length) {
        await audit(transaction, {
          institutionId: input.institutionId,
          actorUserId: input.actorUserId,
          action: 'staff_updated',
          targetUserId: user.id,
          reason: notes.join('; '),
          createdAt: input.now,
        });
      }
      return 'updated';
    });
  }
}
