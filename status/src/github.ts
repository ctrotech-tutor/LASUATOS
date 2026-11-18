import { LABELS, type GitHubComment, type GitHubIssue } from './incidents.ts';

/**
 * The GitHub REST calls the checker makes, with a fine-grained token limited to
 * Issues on one repository. Works the same for a private repository. Polling uses
 * an ETag, so an unchanged list costs nothing against the rate limit.
 */

export interface GitHubOptions {
  readonly repo: string;
  readonly token: string;
  readonly fetch?: typeof fetch;
}

export class GitHubError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
    this.name = 'GitHubError';
  }
}

export class GitHub {
  readonly #repo: string;
  readonly #token: string;
  readonly #fetch: typeof fetch;

  constructor(options: GitHubOptions) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(options.repo)) throw new Error('GITHUB_REPO must look like owner/name');
    this.#repo = options.repo;
    this.#token = options.token;
    this.#fetch = options.fetch ?? fetch;
  }

  async #call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Response> {
    const response = await this.#fetch(`https://api.github.com/repos/${this.#repo}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.#token}`,
        'x-github-api-version': '2022-11-28',
        'user-agent': 'LASUATOS-Status',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status >= 400) throw new GitHubError(response.status, `GitHub ${method} ${path} answered ${response.status}`);
    return response;
  }

  /** The 30 most recently updated issues labelled "status"; `null` when unchanged since `etag`. */
  async statusIssues(etag: string | null): Promise<{ issues: GitHubIssue[]; etag: string | null } | null> {
    const response = await this.#call('GET', '/issues?labels=status&state=all&sort=updated&direction=desc&per_page=30', undefined, etag ? { 'if-none-match': etag } : {}).catch((error: unknown) => {
      if (error instanceof GitHubError && error.status === 304) return null;
      throw error;
    });
    if (!response || response.status === 304) return null;
    return { issues: (await response.json()) as GitHubIssue[], etag: response.headers.get('etag') };
  }

  async comments(number: number): Promise<GitHubComment[]> {
    const response = await this.#call('GET', `/issues/${number}/comments?per_page=100`);
    return (await response.json()) as GitHubComment[];
  }

  async createIssue(input: { title: string; body: string; labels: string[] }): Promise<GitHubIssue> {
    const response = await this.#call('POST', '/issues', input);
    return (await response.json()) as GitHubIssue;
  }

  async comment(number: number, body: string): Promise<void> {
    await this.#call('POST', `/issues/${number}/comments`, { body });
  }

  async updateIssue(number: number, patch: { title?: string; labels?: string[]; state?: 'open' | 'closed'; state_reason?: 'completed' }): Promise<GitHubIssue> {
    const response = await this.#call('PATCH', `/issues/${number}`, patch);
    return (await response.json()) as GitHubIssue;
  }

  /** Creates the status labels (with colours and descriptions) that do not exist yet. */
  async ensureLabels(): Promise<void> {
    for (const label of LABELS) {
      await this.#call('POST', '/labels', label).catch((error: unknown) => {
        // 422: it exists already.
        if (!(error instanceof GitHubError && error.status === 422)) throw error;
      });
    }
  }
}
