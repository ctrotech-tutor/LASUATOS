import {
  StaffDirectorySchema,
  StaffInvitationCreateSchema,
  StaffInvitationSchema,
  StaffScopeOptionsSchema,
  UpdateStaffMemberRequestSchema,
} from '@lasuatos/contracts';
import { z } from 'zod';
import { requestJson } from './course-api';

const InvitationIssuedSchema = z.object({ invitation: StaffInvitationSchema, emailSent: z.boolean() });
/** 204 responses have no body; requestJson then sees `null`. */
const NoContentSchema = z.null();

const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
});

export function loadStaffDirectory(signal?: AbortSignal) {
  return requestJson('/api/v1/admin/staff', StaffDirectorySchema, signal ? { signal } : undefined);
}

export function loadStaffOptions(signal?: AbortSignal) {
  return requestJson('/api/v1/admin/staff/options', StaffScopeOptionsSchema, signal ? { signal } : undefined);
}

export function inviteStaff(input: unknown) {
  return requestJson('/api/v1/admin/staff/invitations', InvitationIssuedSchema, post(StaffInvitationCreateSchema.parse(input)));
}

export function resendStaffInvitation(invitationId: string) {
  return requestJson(`/api/v1/admin/staff/invitations/${encodeURIComponent(invitationId)}/resend`, InvitationIssuedSchema, post());
}

export function revokeStaffInvitation(invitationId: string) {
  return requestJson(`/api/v1/admin/staff/invitations/${encodeURIComponent(invitationId)}/revoke`, NoContentSchema, post());
}

export function changeStaffStatus(userId: string, action: 'suspend' | 'reactivate', reason: string) {
  return requestJson(`/api/v1/admin/staff/members/${encodeURIComponent(userId)}/${action}`, NoContentSchema, post({ reason }));
}

/** Corrects a staff member's name and, for lecturers, their staff number. */
export function updateStaffMember(userId: string, input: unknown) {
  return requestJson(`/api/v1/admin/staff/members/${encodeURIComponent(userId)}`, NoContentSchema, post(UpdateStaffMemberRequestSchema.parse(input)));
}
