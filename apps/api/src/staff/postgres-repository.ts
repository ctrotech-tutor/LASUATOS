import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import {
  departments,
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
  CreateInvitationInput,
  CreateInvitationResult,
  InvitationPreviewRecord,
  PlacementRequest,
  ResolvedPlacement,
  StaffInvitationRecord,
  StaffMemberRecord,
  StaffRepository,
} from './repository.js';

const STAFF_ROLES: readonly StaffRole[] = [
  'lecturer',
  'department_administrator',
  'faculty_administrator',
  'institution_administrator',
];

type Executor = Pick<DatabaseClient, 'select' | 'insert' | 'update'>;

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
    };
  }

  async acceptInvitation(input: { readonly tokenHash: string; readonly passwordHash: string; readonly now: Date }): Promise<AcceptInvitationResult> {
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

      if (invitation.role === 'lecturer' && invitation.staffNumber) {
        const [taken] = await transaction
          .select({ userId: lecturerProfiles.userId })
          .from(lecturerProfiles)
          .where(and(
            eq(lecturerProfiles.institutionId, invitation.institutionId),
            eq(lecturerProfiles.staffNumber, invitation.staffNumber),
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
          staffNumber: invitation.staffNumber!,
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

  async listMembers(institutionId: string): Promise<StaffMemberRecord[]> {
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
  async updateMember(input: {
    readonly institutionId: string;
    readonly userId: string;
    readonly actorUserId: string;
    readonly displayName?: string | undefined;
    readonly staffNumber?: string | undefined;
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
        if (profile.staffNumber !== input.staffNumber) {
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
          await transaction
            .update(lecturerProfiles)
            .set({ staffNumber: input.staffNumber, updatedAt: input.now })
            .where(eq(lecturerProfiles.userId, user.id));
          notes.push(`Staff number: ${profile.staffNumber} → ${input.staffNumber}`);
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
