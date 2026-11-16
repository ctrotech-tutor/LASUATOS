import {
  AuditEntryDetailSchema,
  AuditLogPageSchema,
  AuditSummarySchema,
  type AuditLogQuery,
} from '@lasuatos/contracts';
import { apiRequest } from './lecture-api';

/** The audit log (administrators): every trail in one list, a summary, one entry, a CSV. */

function search(query: AuditLogQuery): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : '';
}

export const loadAuditLog = (query: AuditLogQuery, signal?: AbortSignal) =>
  apiRequest(`/api/v1/admin/audit${search(query)}`, AuditLogPageSchema, signal ? { signal } : undefined);

export const loadAuditSummary = (signal?: AbortSignal) =>
  apiRequest('/api/v1/admin/audit/summary', AuditSummarySchema, signal ? { signal } : undefined);

export const loadAuditEntry = async (id: string, signal?: AbortSignal) =>
  (await apiRequest(`/api/v1/admin/audit/entries/${encodeURIComponent(id)}`, AuditEntryDetailSchema, signal ? { signal } : undefined)).entry;

/** The CSV download for the same filters (a plain link: the browser saves the file). */
export const auditExportHref = (query: Omit<AuditLogQuery, 'cursor'>) => `/api/v1/admin/audit/export${search(query)}`;
