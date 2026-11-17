import { SystemHealthSchema } from '@lasuatos/contracts';
import { apiRequest } from './lecture-api';

/** System health (/admin/health): the database, email providers, alerts and the nightly clean-up. */
export const loadSystemHealth = (signal?: AbortSignal) =>
  apiRequest('/api/v1/admin/health', SystemHealthSchema, signal ? { signal } : undefined);
