import {
  ContactInboxSchema,
  ContactMessageDetailSchema,
  ContactMessageSchema,
  ContactMessageSentSchema,
  ContactNewCountSchema,
  type ContactInboxQuery,
  type ContactMessageRequest,
  type ContactMessageStatus,
} from '@lasuatos/contracts';
import { apiRequest } from './lecture-api';

/** Messages to the LASUATOS team (the contact page) and the administrators' inbox. */

export const sendContactMessage = (message: ContactMessageRequest) =>
  apiRequest('/api/v1/contact', ContactMessageSentSchema, { json: message });

export function loadContactInbox(query: ContactInboxQuery, signal?: AbortSignal) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) if (value) params.set(key, String(value));
  const search = params.toString();
  return apiRequest(`/api/v1/admin/messages${search ? `?${search}` : ''}`, ContactInboxSchema, signal ? { signal } : undefined);
}

export const loadContactNewCount = (signal?: AbortSignal) =>
  apiRequest('/api/v1/admin/messages/count', ContactNewCountSchema, signal ? { signal } : undefined).then((value) => value.new);

/** One message by its reference, with the sender's other messages. */
export const loadContactMessage = (reference: string, signal?: AbortSignal) =>
  apiRequest(`/api/v1/admin/messages/${encodeURIComponent(reference)}`, ContactMessageDetailSchema, signal ? { signal } : undefined);

/** Marks a message handled (with an optional note: what was done) or new again. */
export const setContactMessageStatus = (id: string, status: ContactMessageStatus, note?: string) =>
  apiRequest(`/api/v1/admin/messages/${encodeURIComponent(id)}`, ContactMessageSchema, { json: note === undefined ? { status } : { status, note } });

/** Fired after a message is marked, so the menu badge updates at once. */
export const CONTACT_INBOX_CHANGED_EVENT = 'lasuatos:contact-inbox-changed';
