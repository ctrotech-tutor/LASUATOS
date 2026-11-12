import type { StaffRole } from '@lasuatos/contracts';
import type { StaffPosition } from './policy.js';

export interface PlacementRequest {
  readonly role: StaffRole;
  readonly facultyId: string | null;
  readonly departmentId: string | null;
}

/** A resolved, active place in the institution for a staff role. */
export interface ResolvedPlacement {
  readonly position: StaffPosition;
  readonly scopeLabel: string;
}

export interface StaffInvitationRecord {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: StaffRole;
  readonly position: StaffPosition;
  readonly scopeLabel: string;
  readonly staffNumber: string | null;
  readonly invitedByName: string | null;
  readonly sentAt: Date;
  readonly expiresAt: Date;
  readonly state: 'pending' | 'accepted' | 'revoked';
}

export interface StaffMemberRecord {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly position: StaffPosition;
  readonly scopeLabel: string;
  readonly staffNumber: string | null;
  readonly status: 'active' | 'suspended';
  readonly joinedAt: Date;
}

export interface CreateInvitationInput {
  readonly institutionId: string;
  readonly email: string;
  readonly displayName: string;
  readonly placement: PlacementRequest;
  readonly staffNumber: string | null;
  readonly tokenHash: string;
  readonly sentAt: Date;
  readonly expiresAt: Date;
  /** Null for the server-side bootstrap command. */
  readonly invitedByUserId: string | null;
}

export type CreateInvitationResult =
  | { readonly kind: 'created'; readonly invitation: StaffInvitationRecord }
  | { readonly kind: 'account_exists' }
  | { readonly kind: 'pending_exists' }
  | { readonly kind: 'staff_number_taken' };

export interface InvitationPreviewRecord {
  readonly displayName: string;
  readonly email: string;
  readonly role: StaffRole;
  readonly scopeLabel: string;
  readonly institutionName: string;
  readonly invitedByName: string | null;
  readonly expiresAt: Date;
}

export type AcceptInvitationResult =
  | { readonly kind: 'accepted'; readonly userId: string }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'conflict'; readonly reason: 'account_exists' | 'staff_number_taken' | 'placement_inactive' };

export interface StaffRepository {
  findInstitution(slug: string): Promise<{ readonly id: string; readonly name: string } | null>;
  /** Looks up an active faculty or department by its code (used by the bootstrap command). */
  findUnitIdByCode(institutionId: string, kind: 'faculty' | 'department', code: string): Promise<string | null>;
  /** Faculty of an administrator's department (department administrators carry only the department id). */
  resolvePlacement(institutionId: string, placement: PlacementRequest): Promise<ResolvedPlacement | null>;
  listScopeOptions(institutionId: string): Promise<{
    readonly faculties: readonly { readonly id: string; readonly code: string; readonly name: string }[];
    readonly departments: readonly {
      readonly id: string;
      readonly code: string;
      readonly name: string;
      readonly facultyId: string;
      readonly facultyName: string;
    }[];
  }>;
  createInvitation(input: CreateInvitationInput): Promise<CreateInvitationResult>;
  listInvitations(institutionId: string, now: Date): Promise<StaffInvitationRecord[]>;
  findInvitation(institutionId: string, invitationId: string): Promise<StaffInvitationRecord | null>;
  reissueInvitation(input: {
    readonly invitationId: string;
    readonly institutionId: string;
    readonly tokenHash: string;
    readonly sentAt: Date;
    readonly expiresAt: Date;
    readonly actorUserId: string;
  }): Promise<boolean>;
  revokeInvitation(input: {
    readonly invitationId: string;
    readonly institutionId: string;
    readonly actorUserId: string;
    readonly now: Date;
  }): Promise<boolean>;
  previewInvitation(tokenHash: string, now: Date): Promise<InvitationPreviewRecord | null>;
  acceptInvitation(input: { readonly tokenHash: string; readonly passwordHash: string; readonly now: Date }): Promise<AcceptInvitationResult>;
  listMembers(institutionId: string): Promise<StaffMemberRecord[]>;
  findMember(institutionId: string, userId: string): Promise<StaffMemberRecord | null>;
  /** Suspends (revoking every session) or reactivates an account and records an audit event. */
  setMemberStatus(input: {
    readonly institutionId: string;
    readonly userId: string;
    readonly status: 'active' | 'suspended';
    readonly actorUserId: string;
    readonly reason: string;
    readonly now: Date;
  }): Promise<boolean>;
}
