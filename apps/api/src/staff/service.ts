import { createOpaqueToken, hashOpaqueToken, hashPassword } from '@lasuatos/auth';
import {
  STAFF_ROLE_LABELS,
  type StaffDirectory,
  type StaffInvitation,
  type StaffInvitationCreate,
  type StaffInvitationPreview,
  type StaffScopeOptions,
} from '@lasuatos/contracts';
import type { AdministratorSessionAccount, AuthenticatedAccount, AuthRepository } from '../auth/repository.js';
import { SESSION_TTL_MILLISECONDS } from '../auth/service.js';
import { emailFailureReason, type EmailTransport } from '../email/transport.js';
import { canManagePosition, rolesGrantableBy, type ActorScope, type StaffPosition } from './policy.js';
import type { PlacementRequest, StaffInvitationRecord, StaffRepository } from './repository.js';

/** Invitations are valid for seven days; resending issues a new link and restarts the clock. */
export const STAFF_INVITATION_TTL_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;

export class StaffError extends Error {
  /** Messages are authored here and never echo request values, so they are safe to show. */
  readonly exposeDetail = true;

  constructor(
    readonly statusCode: 400 | 403 | 404 | 409 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'StaffError';
  }
}

export interface StaffServiceOptions {
  readonly repository: StaffRepository;
  readonly authRepository: AuthRepository;
  readonly emailTransport?: EmailTransport;
  readonly now?: () => Date;
  readonly logger?: { warn(details: Record<string, unknown>, message: string): void };
}

export interface IssuedInvitation {
  readonly invitation: StaffInvitation;
  /** The raw link token. Only the bootstrap command ever shows this; the HTTP API never returns it. */
  readonly token: string;
  readonly emailSent: boolean;
}

export function actorScopeOf(administrator: AdministratorSessionAccount): ActorScope {
  const scope = administrator.scope;
  if (scope.type === 'institution') return { type: 'institution', institutionId: administrator.institutionId };
  if (scope.type === 'faculty') {
    return { type: 'faculty', institutionId: administrator.institutionId, facultyId: scope.id };
  }
  return { type: 'department', institutionId: administrator.institutionId, departmentId: scope.id };
}

function placementOf(input: StaffInvitationCreate): PlacementRequest {
  return {
    role: input.role,
    facultyId: input.role === 'faculty_administrator' ? input.facultyId ?? null : null,
    departmentId: input.role === 'lecturer' || input.role === 'department_administrator' ? input.departmentId ?? null : null,
  };
}

export class StaffService {
  readonly #repository: StaffRepository;
  readonly #authRepository: AuthRepository;
  readonly #emailTransport: EmailTransport | undefined;
  readonly #now: () => Date;
  readonly #logger: StaffServiceOptions['logger'];

  constructor(options: StaffServiceOptions) {
    this.#repository = options.repository;
    this.#authRepository = options.authRepository;
    this.#emailTransport = options.emailTransport;
    this.#now = options.now ?? (() => new Date());
    this.#logger = options.logger;
  }

  #toInvitation(record: StaffInvitationRecord, now: Date): StaffInvitation {
    return {
      id: record.id,
      email: record.email,
      displayName: record.displayName,
      role: record.role,
      scopeLabel: record.scopeLabel,
      staffNumber: record.staffNumber,
      invitedByName: record.invitedByName,
      sentAt: record.sentAt.toISOString(),
      expiresAt: record.expiresAt.toISOString(),
      expired: record.expiresAt <= now,
    };
  }

  async #sendInvitationEmail(record: StaffInvitationRecord, token: string, institutionName: string): Promise<boolean> {
    if (!this.#emailTransport) return false;
    try {
      await this.#emailTransport.sendStaffInvitation({
        to: record.email,
        displayName: record.displayName,
        token,
        roleLabel: STAFF_ROLE_LABELS[record.role],
        scopeLabel: record.scopeLabel,
        institutionName,
        invitedByName: record.invitedByName,
        expiresAt: record.expiresAt,
      });
      return true;
    } catch (error) {
      this.#logger?.warn(
        { invitationId: record.id, reason: emailFailureReason(error) },
        'Staff invitation email could not be delivered.',
      );
      return false;
    }
  }

  async scopeOptions(administrator: AdministratorSessionAccount): Promise<StaffScopeOptions> {
    const actor = actorScopeOf(administrator);
    const options = await this.#repository.listScopeOptions(administrator.institutionId);
    if (actor.type === 'institution') {
      return { allowedRoles: rolesGrantableBy(actor), faculties: [...options.faculties], departments: [...options.departments] };
    }
    if (actor.type === 'faculty') {
      return {
        allowedRoles: rolesGrantableBy(actor),
        faculties: options.faculties.filter((faculty) => faculty.id === actor.facultyId),
        departments: options.departments.filter((department) => department.facultyId === actor.facultyId),
      };
    }
    const departments = options.departments.filter((department) => department.id === actor.departmentId);
    return { allowedRoles: rolesGrantableBy(actor), faculties: [], departments };
  }

  async directory(administrator: AdministratorSessionAccount): Promise<StaffDirectory> {
    const actor = actorScopeOf(administrator);
    const now = this.#now();
    const [members, invitations] = await Promise.all([
      this.#repository.listMembers(administrator.institutionId),
      this.#repository.listInvitations(administrator.institutionId, now),
    ]);
    // Administrators see only the people they could have invited themselves.
    return {
      members: members
        .filter((member) => member.userId === administrator.id || canManagePosition(actor, member.position))
        .map((member) => ({
          userId: member.userId,
          email: member.email,
          displayName: member.displayName,
          role: member.position.role,
          scopeLabel: member.scopeLabel,
          staffNumber: member.staffNumber,
          status: member.status,
          joinedAt: member.joinedAt.toISOString(),
          isSelf: member.userId === administrator.id,
          manageable: member.userId !== administrator.id && canManagePosition(actor, member.position),
        })),
      invitations: invitations
        .filter((invitation) => canManagePosition(actor, invitation.position))
        .map((invitation) => this.#toInvitation(invitation, now)),
    };
  }

  /** Invites a staff member on behalf of a signed-in administrator. */
  async invite(administrator: AdministratorSessionAccount, input: StaffInvitationCreate): Promise<IssuedInvitation> {
    const actor = actorScopeOf(administrator);
    return this.#issue({
      institutionId: administrator.institutionId,
      institutionName: administrator.institutionName,
      input,
      invitedByUserId: administrator.id,
      authorize: (position) => canManagePosition(actor, position),
    });
  }

  /**
   * Creates the first administrator invitation from the server-side bootstrap
   * command. It has no inviting user and is the only path that needs shell access.
   */
  async bootstrap(institutionSlug: string, input: StaffInvitationCreate): Promise<IssuedInvitation> {
    if (input.role === 'lecturer') {
      throw new StaffError(400, 'bootstrap_role', 'The bootstrap command only invites administrators.');
    }
    const institution = await this.#repository.findInstitution(institutionSlug);
    if (!institution) throw new StaffError(404, 'institution_not_found', `No institution with slug "${institutionSlug}".`);
    return this.#issue({
      institutionId: institution.id,
      institutionName: institution.name,
      input,
      invitedByUserId: null,
      authorize: () => true,
    });
  }

  async #issue(options: {
    institutionId: string;
    institutionName: string;
    input: StaffInvitationCreate;
    invitedByUserId: string | null;
    authorize: (position: StaffPosition) => boolean;
  }): Promise<IssuedInvitation> {
    const placement = placementOf(options.input);
    const resolved = await this.#repository.resolvePlacement(options.institutionId, placement);
    // Unknown and out-of-scope places look the same, so ids cannot be probed.
    if (!resolved || !options.authorize(resolved.position)) {
      throw new StaffError(403, 'scope_not_allowed', 'You cannot invite someone to that role or area.');
    }

    const now = this.#now();
    const token = createOpaqueToken();
    const result = await this.#repository.createInvitation({
      institutionId: options.institutionId,
      email: options.input.email.trim().toLowerCase(),
      displayName: options.input.displayName.trim(),
      placement,
      staffNumber: options.input.role === 'lecturer' ? options.input.staffNumber?.trim() ?? null : null,
      tokenHash: hashOpaqueToken(token),
      sentAt: now,
      expiresAt: new Date(now.getTime() + STAFF_INVITATION_TTL_MILLISECONDS),
      invitedByUserId: options.invitedByUserId,
    });
    if (result.kind === 'account_exists') {
      throw new StaffError(409, 'account_exists', 'An account already uses this email address.');
    }
    if (result.kind === 'pending_exists') {
      throw new StaffError(409, 'invitation_pending', 'This person already has a pending invitation. Resend or revoke it instead.');
    }
    if (result.kind === 'staff_number_taken') {
      throw new StaffError(409, 'staff_number_taken', 'Another lecturer already has this staff number.');
    }
    const emailSent = await this.#sendInvitationEmail(result.invitation, token, options.institutionName);
    return { invitation: this.#toInvitation(result.invitation, now), token, emailSent };
  }

  async #managedInvitation(administrator: AdministratorSessionAccount, invitationId: string): Promise<StaffInvitationRecord> {
    const record = await this.#repository.findInvitation(administrator.institutionId, invitationId);
    if (!record || record.state !== 'pending' || !canManagePosition(actorScopeOf(administrator), record.position)) {
      throw new StaffError(404, 'invitation_not_found', 'That pending invitation was not found.');
    }
    return record;
  }

  async resend(administrator: AdministratorSessionAccount, invitationId: string): Promise<{ invitation: StaffInvitation; emailSent: boolean }> {
    const record = await this.#managedInvitation(administrator, invitationId);
    const now = this.#now();
    const token = createOpaqueToken();
    const expiresAt = new Date(now.getTime() + STAFF_INVITATION_TTL_MILLISECONDS);
    const reissued = await this.#repository.reissueInvitation({
      invitationId,
      institutionId: administrator.institutionId,
      tokenHash: hashOpaqueToken(token),
      sentAt: now,
      expiresAt,
      actorUserId: administrator.id,
    });
    if (!reissued) throw new StaffError(404, 'invitation_not_found', 'That pending invitation was not found.');
    const updated: StaffInvitationRecord = { ...record, sentAt: now, expiresAt };
    const emailSent = await this.#sendInvitationEmail(updated, token, administrator.institutionName);
    return { invitation: this.#toInvitation(updated, now), emailSent };
  }

  async revoke(administrator: AdministratorSessionAccount, invitationId: string): Promise<void> {
    await this.#managedInvitation(administrator, invitationId);
    const revoked = await this.#repository.revokeInvitation({
      invitationId,
      institutionId: administrator.institutionId,
      actorUserId: administrator.id,
      now: this.#now(),
    });
    if (!revoked) throw new StaffError(404, 'invitation_not_found', 'That pending invitation was not found.');
  }

  async setStatus(
    administrator: AdministratorSessionAccount,
    userId: string,
    status: 'active' | 'suspended',
    reason: string,
  ): Promise<void> {
    if (userId === administrator.id) {
      throw new StaffError(403, 'self_change', 'You cannot suspend or reactivate your own account.');
    }
    const member = await this.#repository.findMember(administrator.institutionId, userId);
    if (!member || !canManagePosition(actorScopeOf(administrator), member.position)) {
      throw new StaffError(404, 'staff_not_found', 'That staff member was not found.');
    }
    if (member.status === status) {
      throw new StaffError(409, 'status_unchanged', status === 'suspended' ? 'This account is already suspended.' : 'This account is already active.');
    }
    const changed = await this.#repository.setMemberStatus({
      institutionId: administrator.institutionId,
      userId,
      status,
      actorUserId: administrator.id,
      reason: reason.trim(),
      now: this.#now(),
    });
    if (!changed) throw new StaffError(409, 'status_unchanged', 'The account changed while you were editing it. Refresh and try again.');
  }

  /** Corrects a staff member's name or, for lecturers, staff number. */
  async updateMember(
    administrator: AdministratorSessionAccount,
    userId: string,
    input: { readonly displayName?: string | undefined; readonly staffNumber?: string | undefined },
  ): Promise<void> {
    const member = await this.#repository.findMember(administrator.institutionId, userId);
    const isSelf = userId === administrator.id;
    if (!member || (!isSelf && !canManagePosition(actorScopeOf(administrator), member.position))) {
      throw new StaffError(404, 'staff_not_found', 'That staff member was not found.');
    }
    if (input.staffNumber !== undefined && member.position.role !== 'lecturer') {
      throw new StaffError(400, 'no_staff_number', 'Only lecturer accounts have a staff number.');
    }
    const result = await this.#repository.updateMember({
      institutionId: administrator.institutionId,
      userId,
      actorUserId: administrator.id,
      displayName: input.displayName,
      staffNumber: input.staffNumber?.trim(),
      now: this.#now(),
    });
    if (result === 'missing') throw new StaffError(404, 'staff_not_found', 'That staff member was not found.');
    if (result === 'staff_number_taken') throw new StaffError(409, 'staff_number_taken', 'Another staff member already has that staff number.');
  }

  async preview(token: string): Promise<StaffInvitationPreview> {
    const record = await this.#repository.previewInvitation(hashOpaqueToken(token), this.#now());
    if (!record) throw new StaffError(404, 'invitation_invalid', 'This invitation link is invalid, expired or already used.');
    return { ...record, expiresAt: record.expiresAt.toISOString() };
  }

  /** Activates the invited account, confirms its email and signs the person in. */
  async accept(token: string, password: string): Promise<{ token: string; account: AuthenticatedAccount }> {
    const now = this.#now();
    const result = await this.#repository.acceptInvitation({
      tokenHash: hashOpaqueToken(token),
      passwordHash: await hashPassword(password),
      now,
    });
    if (result.kind === 'invalid') {
      throw new StaffError(404, 'invitation_invalid', 'This invitation link is invalid, expired or already used.');
    }
    if (result.kind === 'conflict') {
      const message = {
        account_exists: 'An account already uses this email address. Sign in instead, or ask your administrator for help.',
        staff_number_taken: 'Another lecturer already has this staff number. Ask your administrator to send a corrected invitation.',
        placement_inactive: 'The faculty or department on this invitation is no longer active. Ask your administrator for a new invitation.',
      }[result.reason];
      throw new StaffError(409, result.reason, message);
    }
    const sessionToken = createOpaqueToken();
    const account = await this.#authRepository.createSession(
      result.userId,
      hashOpaqueToken(sessionToken),
      now,
      new Date(now.getTime() + SESSION_TTL_MILLISECONDS),
    );
    if (!account) throw new StaffError(503, 'session_unavailable', 'Your account is ready, but signing in failed. Please sign in.');
    return { token: sessionToken, account };
  }
}
