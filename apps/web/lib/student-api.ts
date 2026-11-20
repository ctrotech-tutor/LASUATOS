import {
  ClassListImportResultSchema,
  ClassListEntrySchema,
  ClassListLookupResultSchema,
  ClassListSchema,
  FaceEnrollResultSchema,
  OpenAccountResultSchema,
  StudentEmailCodeSentSchema,
  StudentEmailVerifiedSchema,
  StudentMailDeliveryResultSchema,
  StudentMatricSwitchedSchema,
  StudentSecondaryEmailRemovedSchema,
  StudentSetupSchema,
  FaceReplaceConfirmedSchema,
  FaceReplacedSchema,
  RetentionPreviewSchema,
  RetentionSetDetailSchema,
  RetentionRunResultSchema,
  SetupCodeIssuedSchema,
  AccountReleasedSchema,
  UnlistedStudentsSchema,
  UnlistedStudentStatusChangedSchema,
  StudentPasswordResetResultSchema,
  type ClassListEntryUpdate,
  type ClassListImportRequest,
  type FaceFrame,
  type GoogleProof,
} from '@lasuatos/contracts';
import { apiRequest, nextCheckInRetry, pause, type CheckInRetryState, type CheckInWaiting } from './lecture-api';

/**
 * Student accounts from the class list: look up a matric number, confirm the
 * LASU email with a code, register the face; and the class lists HOCs and
 * administrators keep.
 */

const Accepted = { safeParse: (value: unknown) => ({ success: true as const, data: value }) };

export const lookupMatric = (matricNumber: string) =>
  apiRequest('/api/v1/students/lookup', ClassListLookupResultSchema, { json: { matricNumber } });

export const requestOpeningCode = (matricNumber: string, email?: string) =>
  apiRequest('/api/v1/students/open/code', StudentEmailCodeSentSchema, { json: { matricNumber, ...(email ? { email } : {}) } });

export const openAccount = (matricNumber: string, code: string) =>
  apiRequest('/api/v1/students/open', OpenAccountResultSchema, { json: { matricNumber, code } });

/* Google in place of the emailed code (ADR 027): Google confirmed the account, so no code is sent. */

export const openAccountWithGoogle = (matricNumber: string, google: GoogleProof) =>
  apiRequest('/api/v1/students/open/google', OpenAccountResultSchema, { json: { matricNumber, google } });

export const resetPasswordWithGoogle = (matricNumber: string, google: GoogleProof, password: string) =>
  apiRequest('/api/v1/students/password/google', StudentPasswordResetResultSchema, { json: { matricNumber, google, password } });

export const verifyAccountEmailWithGoogle = (google: GoogleProof) =>
  apiRequest('/api/v1/students/me/email-google', StudentEmailVerifiedSchema, { json: { google } });

export const confirmMatricWithGoogle = (matricNumber: string, google: GoogleProof) =>
  apiRequest('/api/v1/students/me/matric/google', StudentMatricSwitchedSchema, { json: { matricNumber, google } });

export const confirmFaceReplaceWithGoogle = (password: string, google: GoogleProof) =>
  apiRequest('/api/v1/students/me/face/replace/google', FaceReplaceConfirmedSchema, { json: { password, google } });

/** No access to the LASU mailbox: the one-time setup code the HOC gave instead. */
export const openWithSetupCode = (matricNumber: string, setupCode: string, email?: string) =>
  apiRequest('/api/v1/students/open/setup-code', OpenAccountResultSchema, { json: { matricNumber, setupCode, ...(email ? { email } : {}) } });

/** Forgot password: a 6-digit code to the account's confirmed LASU email… */
export const requestPasswordCode = (matricNumber: string) =>
  apiRequest('/api/v1/students/password/code', StudentEmailCodeSentSchema, { json: { matricNumber } });

/** …then the new password; every other device is signed out and this one signed in. */
export const resetPasswordWithCode = (matricNumber: string, code: string, password: string) =>
  apiRequest('/api/v1/students/password', StudentPasswordResetResultSchema, { json: { matricNumber, code, password } });

export const loadStudentSetup = (signal?: AbortSignal) =>
  apiRequest('/api/v1/students/me/setup', StudentSetupSchema, signal ? { signal } : undefined);

export const requestAccountEmailCode = (email?: string) =>
  apiRequest('/api/v1/students/me/email-code', StudentEmailCodeSentSchema, { json: email ? { email } : {} });

export const verifyAccountEmail = (code: string) =>
  apiRequest('/api/v1/students/me/email-verify', StudentEmailVerifiedSchema, { json: { code } });

/*
 * A linked personal email (ADR 040), for students who cannot reach their LASU
 * mailbox: it gets the account's mail when chosen, and Google sign-in with it
 * opens the account. Linking asks for the password and a code to the address.
 */
export const requestSecondaryEmailCode = (password: string, email: string) =>
  apiRequest('/api/v1/students/me/secondary-email/code', StudentEmailCodeSentSchema, { json: { password, email } });

export const verifySecondaryEmail = (code: string) =>
  apiRequest('/api/v1/students/me/secondary-email', StudentEmailVerifiedSchema, { json: { code } });

export const removeSecondaryEmail = (password: string) =>
  apiRequest('/api/v1/students/me/secondary-email/remove', StudentSecondaryEmailRemovedSchema, { json: { password } });

export const setMailDelivery = (delivery: 'primary' | 'secondary') =>
  apiRequest('/api/v1/students/me/mail-delivery', StudentMailDeliveryResultSchema, { json: { delivery } });

/**
 * A student on a JAMB number adds their matric number: a code to their LASU
 * email first, then the code switches the account (attendance carried over).
 */
export const requestMatricCode = (matricNumber: string, email: string) =>
  apiRequest('/api/v1/students/me/matric/code', StudentEmailCodeSentSchema, { json: { matricNumber, email } });

export const confirmMatricNumber = (matricNumber: string, email: string, code: string) =>
  apiRequest('/api/v1/students/me/matric', StudentMatricSwitchedSchema, { json: { matricNumber, email, code } });

/**
 * Registers the student's face. When the server is busy with other students'
 * face checks (503 with Retry-After: nothing was analysed or saved), the same
 * photos are sent again by itself, as a check-in does (nextCheckInRetry), and
 * `onWaiting` tells the page. Other failures are shown at once.
 */
export async function registerFace(frames: FaceFrame[], options: { onWaiting?: (waiting: CheckInWaiting) => void } = {}) {
  const started = Date.now();
  const state: CheckInRetryState = { busy: 0, other: 0 };
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await apiRequest('/api/v1/students/me/face', FaceEnrollResultSchema, { json: { consent: true, frames } });
    } catch (error) {
      const retry = nextCheckInRetry(error, state, Date.now() - started);
      if (!retry?.busy) throw error;
      options.onWaiting?.({ busy: true, attempt, retryInSeconds: Math.ceil(retry.delayMs / 1000) });
      await pause(retry.delayMs);
    }
  }
}

export const OWN_FACE_PHOTO_URL = '/api/v1/students/me/face/photo';

/**
 * Asks the server to load its face engine while the student is still in
 * front of the camera, so the photos are checked without a cold start.
 * Best effort: any failure is ignored.
 */
export function warmFaceChecks(): void {
  void apiRequest('/api/v1/students/me/face/warm', Accepted, { json: {} }).catch(() => undefined);
}

/** One list, or with `only: 'lists'` just the summaries of every list in the viewer's area. */
export function loadClassList(query: { departmentId?: string | null; department?: string | null; entryYear?: number | null; only?: 'lists' }, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (query.departmentId) params.set('departmentId', query.departmentId);
  if (query.department) params.set('department', query.department);
  if (query.only) params.set('only', query.only);
  if (query.entryYear) params.set('entryYear', String(query.entryYear));
  const search = params.toString();
  return apiRequest(`/api/v1/class-lists${search ? `?${search}` : ''}`, ClassListSchema, signal ? { signal } : undefined);
}

export const importClassList = (input: ClassListImportRequest) =>
  apiRequest('/api/v1/class-lists/import', ClassListImportResultSchema, { json: input });

export const updateClassListEntry = (entryId: string, changes: ClassListEntryUpdate) =>
  apiRequest(`/api/v1/class-lists/entries/${entryId}`, ClassListEntrySchema, { json: changes });

/** Moves a student to another department's list for the same set; their account and attendance stay. */
export const moveClassListEntry = (entryId: string, departmentId: string) =>
  apiRequest(`/api/v1/class-lists/entries/${entryId}/move`, ClassListEntrySchema, { json: { departmentId } });

export const removeClassListEntry = (entryId: string) =>
  apiRequest(`/api/v1/class-lists/entries/${entryId}/remove`, Accepted, { json: {} });

export const resetClassListFace = (entryId: string) =>
  apiRequest(`/api/v1/class-lists/entries/${entryId}/reset-face`, Accepted, { json: {} });

/** A HOC's one-time setup code for a student who cannot get the emailed code (valid 30 minutes). */
export const issueSetupCode = (entryId: string) =>
  apiRequest(`/api/v1/class-lists/entries/${entryId}/setup-code`, SetupCodeIssuedSchema, { json: {} });

/** Administrators: take a wrongly confirmed account back so the real student can open it. */
export const releaseClassListAccount = (entryId: string, email: string, reason: string) =>
  apiRequest(`/api/v1/class-lists/entries/${entryId}/release`, AccountReleasedSchema, { json: { email, reason } });

export const classListPhotoUrl = (entryId: string) => `/api/v1/class-lists/entries/${entryId}/photo`;

/* ---------------- student accounts on no class list (administrators) ---------------- */

/** Student accounts in the administrator's area that are linked to no class-list name. */
export const loadUnlistedStudents = (signal: AbortSignal) =>
  apiRequest('/api/v1/class-lists/unlisted-accounts', UnlistedStudentsSchema, { signal });

/** Suspends (signing it out everywhere) or reactivates one of them; the reason is audited. */
export const changeUnlistedStudentStatus = (userId: string, action: 'suspend' | 'reactivate', reason: string) =>
  apiRequest(`/api/v1/class-lists/unlisted-accounts/${userId}/${action}`, UnlistedStudentStatusChangedSchema, { json: { reason } });

/* ---------------- taking new face photos ---------------- */

/** Step 1: the account password; a code goes to the LASU email. */
export const requestFaceReplaceCode = (password: string) =>
  apiRequest('/api/v1/students/me/face/replace/code', StudentEmailCodeSentSchema, { json: { password } });

/** Step 2: the code opens 20 minutes to take the new photos. */
export const confirmFaceReplace = (code: string) =>
  apiRequest('/api/v1/students/me/face/replace/confirm', FaceReplaceConfirmedSchema, { json: { code } });

/** Step 3: three new photos; they must look like the face already registered. */
export const replaceFace = (frames: FaceFrame[]) =>
  apiRequest('/api/v1/students/me/face/replace', FaceReplacedSchema, { json: { consent: true, frames } });

/* ---------------- administrators: data retention (the audit log is in audit-api) ---------------- */

export const loadRetention = (signal?: AbortSignal) =>
  apiRequest('/api/v1/admin/retention', RetentionPreviewSchema, signal ? { signal } : undefined);

/** One set, student by student: whose face goes at the next run and who keeps it for now. */
export const loadRetentionSet = (departmentId: string, entryYear: number, signal?: AbortSignal) =>
  apiRequest(`/api/v1/admin/retention/sets/${encodeURIComponent(departmentId)}/${entryYear}`, RetentionSetDetailSchema, signal ? { signal } : undefined);

export const runRetention = () =>
  apiRequest('/api/v1/admin/retention/run', RetentionRunResultSchema, { json: { confirm: true } });
