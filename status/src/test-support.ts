import { DatabaseSync } from 'node:sqlite';
import type { GitHubComment, GitHubIssue } from './incidents.ts';
import type { D1Database, D1PreparedStatement, Env } from './platform.ts';

/** D1 over Node's built-in SQLite, so the real SQL runs in tests. */
export function memoryD1(): D1Database & { raw: DatabaseSync } {
  const raw = new DatabaseSync(':memory:');
  const statement = (query: string, values: unknown[] = []): D1PreparedStatement => ({
    bind: (...next: unknown[]) => statement(query, next),
    first: async <T,>() => (raw.prepare(query).get(...(values as never[])) as T | undefined) ?? null,
    all: async <T,>() => ({ results: raw.prepare(query).all(...(values as never[])) as T[] }),
    run: async () => raw.prepare(query).run(...(values as never[])),
  });
  return {
    raw,
    prepare: (query: string) => statement(query),
    batch: async (statements: D1PreparedStatement[]) => {
      raw.exec('BEGIN');
      try {
        const results = [];
        for (const item of statements) results.push(await item.run());
        raw.exec('COMMIT');
        return results;
      } catch (error) {
        raw.exec('ROLLBACK');
        throw error;
      }
    },
    exec: async (query: string) => raw.exec(query),
  };
}

export interface FakeTarget {
  site: 'ok' | 'down' | 'wrong';
  api: 'ok' | 'down';
  /** The /api/v1/status components, or 'down' for no usable answer. */
  deep: Record<string, string> | 'down';
  /** Response delay reported via the clock, ms. */
  slowMs: number;
  calls: string[];
}

export function fakeTarget(): FakeTarget {
  return { site: 'ok', api: 'ok', deep: { core: 'operational', errors: 'operational', email: 'operational', google: 'operational', face: 'operational' }, slowMs: 0, calls: [] };
}

/** A clock for probes: each call moves on by `target.slowMs` on fetch. */
export function targetFetch(target: FakeTarget, clock: { t: number }): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    target.calls.push(url.pathname);
    clock.t += target.slowMs;
    if (url.pathname === '/') {
      if (target.site === 'down') throw new Error('timeout');
      return new Response(target.site === 'ok' ? '<title>LASUATOS</title>' : 'Deployment not found', { status: target.site === 'ok' ? 200 : 404 });
    }
    if (url.pathname === '/api/v1/health') {
      if (target.api === 'down') return new Response('bad gateway', { status: 502 });
      return Response.json({ status: 'ok' });
    }
    if (url.pathname === '/api/v1/status') {
      if (target.api === 'down' || target.deep === 'down') return new Response('error', { status: 500 });
      const coreDown = target.deep.core === 'down';
      return Response.json({ service: 'lasuatos', checkedAt: new Date().toISOString(), components: target.deep }, { status: coreDown ? 503 : 200 });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}

/** Just enough of the GitHub Issues API, with ETags. */
export class FakeGitHub {
  issues: GitHubIssue[] = [];
  comments = new Map<number, GitHubComment[]>();
  labels = new Set<string>();
  requests: string[] = [];
  fail = false;
  #version = 0;
  #next = 1;
  now = () => new Date().toISOString();

  #touch(number: number) {
    this.#version += 1;
    this.issues = this.issues.map((issue) => (issue.number === number ? { ...issue, updated_at: this.#stamp() } : issue));
  }

  #stamp(): string {
    // A distinct updated_at per change even within one millisecond.
    return new Date(Date.parse(this.now()) + this.#version).toISOString();
  }

  add(input: { title: string; body?: string; labels: string[]; association?: string; createdAt?: string; state?: 'open' | 'closed'; closedAt?: string }): GitHubIssue {
    this.#version += 1;
    const issue: GitHubIssue = {
      number: this.#next++,
      title: input.title,
      body: input.body ?? null,
      state: input.state ?? 'open',
      labels: input.labels.map((name) => ({ name })),
      created_at: input.createdAt ?? this.now(),
      updated_at: this.#stamp(),
      closed_at: input.closedAt ?? null,
      author_association: input.association ?? 'OWNER',
      user: { login: 'maintainer' },
    };
    this.issues.push(issue);
    return issue;
  }

  addComment(number: number, body: string, association = 'OWNER', at = this.now()): void {
    const list = this.comments.get(number) ?? [];
    list.push({ id: list.length + 1, body, created_at: at, author_association: association, user: { login: 'someone' } });
    this.comments.set(number, list);
    this.#touch(number);
  }

  close(number: number, at = this.now()): void {
    this.issues = this.issues.map((issue) => (issue.number === number ? { ...issue, state: 'closed', closed_at: at } : issue));
    this.#touch(number);
  }

  get fetch(): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method ?? 'GET';
      this.requests.push(`${method} ${url.pathname}${url.search}`);
      if (this.fail) return new Response('{}', { status: 502 });
      const headers = new Headers(init?.headers);
      if (headers.get('authorization') !== 'Bearer token') return new Response('{}', { status: 401 });
      const path = url.pathname.replace(/^\/repos\/[^/]+\/[^/]+/, '');
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      if (method === 'POST' && path === '/labels') {
        if (this.labels.has(String(body.name))) return new Response('{}', { status: 422 });
        this.labels.add(String(body.name));
        return Response.json(body, { status: 201 });
      }
      if (method === 'GET' && path === '/issues') {
        const etag = `"v${this.#version}"`;
        if (headers.get('if-none-match') === etag) return new Response(null, { status: 304 });
        const list = this.issues
          .filter((issue) => issue.labels.some((label) => (typeof label === 'string' ? label : label.name) === 'status'))
          .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
          .slice(0, 30);
        return Response.json(list, { headers: { etag } });
      }
      if (method === 'POST' && path === '/issues') {
        const issue = this.add({ title: String(body.title), body: String(body.body), labels: body.labels as string[] });
        return Response.json(issue, { status: 201 });
      }
      const match = /^\/issues\/(\d+)(\/comments)?$/.exec(path);
      if (match) {
        const number = Number(match[1]);
        if (match[2] && method === 'GET') return Response.json(this.comments.get(number) ?? []);
        if (match[2] && method === 'POST') {
          // Posted with the owner's token, so GitHub marks it OWNER.
          this.addComment(number, String(body.body), 'OWNER');
          return Response.json({}, { status: 201 });
        }
        if (method === 'PATCH') {
          if (body.state === 'closed') this.close(number);
          this.issues = this.issues.map((issue) => (issue.number === number ? {
            ...issue,
            ...(typeof body.title === 'string' ? { title: body.title } : {}),
            ...(Array.isArray(body.labels) ? { labels: (body.labels as string[]).map((name) => ({ name })) } : {}),
          } : issue));
          this.#touch(number);
          return Response.json(this.issues.find((issue) => issue.number === number));
        }
      }
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
  }
}

export function testEnv(db: D1Database, extra: Partial<Env> = {}): Env {
  return { DB: db, TARGET_URL: 'https://lasuatos.test', PUBLIC_URL: 'https://status.test', GITHUB_REPO: 'owner/repo', GITHUB_TOKEN: 'token', ...extra };
}
