import {
  ClassListImportResultSchema,
  ClassListEntrySchema,
  ClassListLookupResultSchema,
  ClassListSchema,
  FaceEnrollResultSchema,
  OpenAccountResultSchema,
  StudentEmailCodeSentSchema,
  StudentEmailVerifiedSchema,
  StudentSetupSchema,
  AuditLogPageSchema,
  FaceReplaceConfirmedSchema,
  FaceReplacedSchema,
  RetentionPreviewSchema,
  RetentionRunResultSchema,
  type AuditLogQuery,
  type ClassListEntryUpdate,
  type ClassListImportRequest,
  type FaceFrame,
} from '@lasuatos/contracts';
import { apiRequest } from './lecture-api';

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

export const loadStudentSetup = (signal?: AbortSignal) =>
  apiRequest('/api/v1/students/me/setup', StudentSetupSchema, signal ? { signal } : undefined);

export const requestAccountEmailCode = (email?: string) =>
  apiRequest('/api/v1/students/me/email-code', StudentEmailCodeSentSchema, { json: email ? { email } : {} });

export const verifyAccountEmail = (code: string) =>
  apiRequest('/api/v1/students/me/email-verify', StudentEmailVerifiedSchema, { json: { code } });

export const registerFace = (frames: FaceFrame[]) =>
  apiRequest('/api/v1/students/me/face', FaceEnrollResultSchema, { json: { consent: true, frames } });

export const OWN_FACE_PHOTO_URL = '/api/v1/students/me/face/photo';

export function loadClassList(query: { departmentId?: string | null; entryYear?: number | null }, signal?: AbortSignal) {
  const params = new URLSearchParams();
  if (query.departmentId) params.set('departmentId', query.departmentId);
  if (query.entryYear) params.set('entryYear', String(query.entryYear));
  const search = params.toString();
  return apiRequest(`/api/v1/class-lists${search ? `?${search}` : ''}`, ClassListSchema, signal ? { signal } : undefined);
}

export const importClassList = (input: ClassListImportRequest) =>
  apiRequest('/api/v1/class-lists/import', ClassListImportResultSchema, { json: input });

export const updateClassListEntry = (entryId: string, changes: ClassListEntryUpdate) =>
  apiRequest(`/api/v1/class-lists/entries/${entryId}`, ClassListEntrySchema, { json: changes });

export const removeClassListEntry = (entryId: string) =>
  apiRequest(`/api/v1/class-lists/entries/${entryId}/remove`, Accepted, { json: {} });

export const resetClassListFace = (entryId: string) =>
  apiRequest(`/api/v1/class-lists/entries/${entryId}/reset-face`, Accepted, { json: {} });

export const classListPhotoUrl = (entryId: string) => `/api/v1/class-lists/entries/${entryId}/photo`;

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

/* ---------------- administrators: audit log and data retention ---------------- */

export function loadAuditLog(query: AuditLogQuery, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
  const search = params.toString();
  return apiRequest(`/api/v1/admin/audit${search ? `?${search}` : ''}`, AuditLogPageSchema, signal ? { signal } : undefined);
}

export const loadRetention = (signal?: AbortSignal) =>
  apiRequest('/api/v1/admin/retention', RetentionPreviewSchema, signal ? { signal } : undefined);

export const runRetention = () =>
  apiRequest('/api/v1/admin/retention/run', RetentionRunResultSchema, { json: { confirm: true } });
