import { StatusNoticeSchema, type StatusNotice, type StatusNotices } from '@lasuatos/contracts';

/**
 * Incident and maintenance notices from the independent status page (ADR 034),
 * for the banner in the app. Fetched by the server, never by the browser, so a
 * student's address never reaches the status page's host and the Content
 * Security Policy stays 'self'. One answer is reused for a minute per instance;
 * when the status page cannot be reached the last good answer is kept for ten
 * minutes, then the banner simply disappears. A status page problem must never
 * break the app.
 */

export const NOTICE_TTL = 60_000;
export const NOTICE_STALE_LIMIT = 10 * 60_000;
export const NOTICE_TIMEOUT = 2_500;

export interface StatusNoticeSourceOptions {
  /** STATUS_PAGE_URL, e.g. https://lasuatos-status.example.workers.dev */
  readonly statusPageUrl: string | undefined;
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export class StatusNoticeSource {
  readonly #url: string | null;
  readonly #fetch: typeof fetch;
  readonly #now: () => number;
  #good: { readonly at: number; readonly notices: StatusNotice[] } | null = null;
  #pending: { readonly at: number; readonly value: Promise<StatusNotice[]> } | null = null;

  constructor(options: StatusNoticeSourceOptions) {
    this.#url = options.statusPageUrl ? options.statusPageUrl.replace(/\/+$/, '') : null;
    this.#fetch = options.fetch ?? fetch;
    this.#now = options.now ?? Date.now;
  }

  get statusPageUrl(): string | null {
    return this.#url;
  }

  async current(): Promise<StatusNotices> {
    if (!this.#url) return { statusPageUrl: null, notices: [] };
    return { statusPageUrl: this.#url, notices: await this.#notices() };
  }

  #notices(): Promise<StatusNotice[]> {
    const now = this.#now();
    if (this.#good && now - this.#good.at < NOTICE_TTL) return Promise.resolve(this.#good.notices);
    if (this.#pending && now - this.#pending.at < NOTICE_TIMEOUT * 2) return this.#pending.value;
    const value = this.#load()
      .then((notices) => {
        this.#good = { at: this.#now(), notices };
        return notices;
      })
      .catch(() => (this.#good && this.#now() - this.#good.at < NOTICE_STALE_LIMIT ? this.#good.notices : []))
      .finally(() => {
        this.#pending = null;
      });
    this.#pending = { at: now, value };
    return value;
  }

  async #load(): Promise<StatusNotice[]> {
    const response = await this.#fetch(`${this.#url}/api/notices.json`, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(NOTICE_TIMEOUT),
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`status page answered ${response.status}`);
    const body: unknown = await response.json();
    const list = body && typeof body === 'object' && 'notices' in body && Array.isArray(body.notices) ? body.notices : [];
    // Keep the notices that are well formed and point at the status page itself; drop the rest.
    const origin = new URL(this.#url!).origin;
    return list
      .map((item: unknown) => StatusNoticeSchema.safeParse(item))
      .filter((parsed): parsed is { success: true; data: StatusNotice } => parsed.success)
      .map((parsed) => parsed.data)
      .filter((notice) => new URL(notice.url).origin === origin)
      .slice(0, 5);
  }
}
