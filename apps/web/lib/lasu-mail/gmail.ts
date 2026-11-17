import { decodeBase64Url, summaryOf, type GmailMessage, type MailSummary } from './message';

/**
 * The browser's own client for the Gmail API (read-only). Requests go from the
 * student's browser straight to gmail.googleapis.com with their one-hour token;
 * nothing passes through LASUATOS.
 */

const API = 'https://gmail.googleapis.com/gmail/v1/users/me';
const SUMMARY_HEADERS = ['From', 'Subject', 'Date', 'To'];
/** Parallel requests while filling a page of the list (Gmail allows far more; phones prefer fewer). */
const CONCURRENCY = 6;

export class GmailError extends Error {
  constructor(readonly status: number, message: string, readonly reason: string | null = null) {
    super(message);
    this.name = 'GmailError';
  }

  /** The token is no good any more: reconnect. */
  get expired(): boolean {
    return this.status === 401;
  }
}

async function call<T>(token: string, path: string, params: Record<string, string | readonly string[] | undefined> = {}, signal?: AbortSignal): Promise<T> {
  const url = new URL(`${API}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const item of typeof value === 'string' ? [value] : value) url.searchParams.append(key, item);
  }
  let response: Response;
  try {
    response = await fetch(url, { headers: { authorization: `Bearer ${token}` }, cache: 'no-store', ...(signal ? { signal } : {}) });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new GmailError(0, 'Gmail could not be reached. Check your connection and try again.');
  }
  if (response.ok) return (await response.json()) as T;
  let reason: string | null = null;
  try {
    const body = (await response.json()) as { error?: { errors?: { reason?: string }[]; status?: string } };
    reason = body.error?.errors?.[0]?.reason ?? body.error?.status ?? null;
  } catch {
    // No JSON body.
  }
  throw new GmailError(response.status, messageFor(response.status, reason), reason);
}

export function messageFor(status: number, reason: string | null): string {
  if (status === 401) return 'Your mail connection ended. Connect again to keep reading.';
  if (status === 403 && reason && /scope|insufficient/i.test(reason)) return 'LASUATOS wasn’t allowed to read mail. Connect again and leave mail ticked.';
  if (status === 403) return 'Google refused access to this mailbox. LASU may not have approved LASUATOS for mail yet.';
  if (status === 404) return 'That email isn’t there any more (it may have been deleted).';
  if (status === 429) return 'Gmail asked LASUATOS to slow down. Wait a few seconds and try again.';
  return 'Gmail didn’t answer properly. Try again in a moment.';
}

export interface MailProfile {
  readonly emailAddress: string;
  readonly messagesTotal: number;
}

export const loadProfile = (token: string, signal?: AbortSignal) => call<MailProfile>(token, '/profile', {}, signal);

export interface MailLabelCounts {
  readonly messagesUnread: number;
  readonly messagesTotal: number;
}

export const loadInboxCounts = (token: string, signal?: AbortSignal) => call<MailLabelCounts>(token, '/labels/INBOX', {}, signal);

interface ListAnswer {
  readonly messages?: readonly { readonly id: string; readonly threadId: string }[];
  readonly nextPageToken?: string;
  readonly resultSizeEstimate?: number;
}

/** Summaries already fetched, by message id (a message's headers never change). */
const summaries = new Map<string, MailSummary>();

export function forgetSummaries(): void {
  summaries.clear();
}

async function pool<T, R>(items: readonly T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array<R>(items.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export interface MailPage {
  readonly messages: readonly MailSummary[];
  readonly nextPageToken: string | null;
}

/**
 * One page of messages for a Gmail search (`in:inbox`, `is:unread`…), newest first.
 * Read state and stars can change, so labels are refreshed on every load; the
 * headers come from the cache.
 */
export async function loadPage(token: string, query: string, pageToken: string | null, signal?: AbortSignal, size = 25): Promise<MailPage> {
  const list = await call<ListAnswer>(token, '/messages', { q: query, maxResults: String(size), pageToken: pageToken ?? undefined }, signal);
  const ids = list.messages ?? [];
  const messages = await pool(ids, CONCURRENCY, async ({ id }) => {
    const message = await call<GmailMessage>(token, `/messages/${encodeURIComponent(id)}`, { format: 'metadata', metadataHeaders: SUMMARY_HEADERS }, signal);
    const summary = summaryOf(message);
    summaries.set(id, summary);
    return summary;
  });
  return { messages, nextPageToken: list.nextPageToken ?? null };
}

export const loadMessage = (token: string, id: string, signal?: AbortSignal) =>
  call<GmailMessage>(token, `/messages/${encodeURIComponent(id)}`, { format: 'full' }, signal);

/** An attachment's bytes, decoded (Gmail sends base64url). */
export async function loadAttachment(token: string, messageId: string, attachmentId: string, signal?: AbortSignal): Promise<Uint8Array> {
  const answer = await call<{ data?: string }>(token, `/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`, {}, signal);
  return decodeBase64Url(answer.data ?? '');
}
