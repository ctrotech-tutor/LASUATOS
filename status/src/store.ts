import type { Incident } from './incidents.ts';
import { COMPONENT_IDS, INITIAL, type ComponentId, type ComponentState, type DeepReport, type State } from './model.ts';
import type { D1Database } from './platform.ts';

/**
 * Storage on Cloudflare D1 (free plan: 100,000 rows written and 5 million read a day).
 * A run writes about 8 rows: one day row per part, one response-time bucket, the
 * state and the page summary, which is ~11,500 rows a day. A page view reads one row
 * (the summary the last run prepared).
 */

export const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)',
  // Minutes per part per WAT day in each state; `maint` minutes do not count against uptime.
  'CREATE TABLE IF NOT EXISTS daily (component TEXT NOT NULL, day TEXT NOT NULL, up INTEGER NOT NULL DEFAULT 0, degraded INTEGER NOT NULL DEFAULT 0, down INTEGER NOT NULL DEFAULT 0, maint INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (component, day))',
  // Five-minute response time buckets, kept three days.
  'CREATE TABLE IF NOT EXISTS latency (bucket INTEGER PRIMARY KEY, site_sum INTEGER NOT NULL DEFAULT 0, site_n INTEGER NOT NULL DEFAULT 0, api_sum INTEGER NOT NULL DEFAULT 0, api_n INTEGER NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS incidents (id TEXT PRIMARY KEY, data TEXT NOT NULL, created_at INTEGER NOT NULL, resolved_at INTEGER, updated_at TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS incidents_created ON incidents (created_at)',
];

export interface CheckerState {
  readonly components: Record<ComponentId, ComponentState>;
  readonly hidden: ComponentId[];
  readonly deep: DeepReport | null;
  readonly deepAt: number | null;
  readonly lastRun: number | null;
  readonly site: { readonly ms: number | null; readonly ok: boolean } | null;
  readonly api: { readonly ms: number | null; readonly ok: boolean } | null;
}

export interface AutoIncident {
  /** The GitHub issue, or null when it is kept here only (no GitHub token, or GitHub failed). */
  readonly issue: number | null;
  readonly localId: string | null;
  readonly components: ComponentId[];
  readonly startedAt: number;
  /** A maintainer closed it while things were still wrong: do not reopen until they recover. */
  readonly suppressed: boolean;
}

export interface GitHubSync {
  readonly etag: string | null;
  readonly labelsReady: boolean;
  readonly lastError: string | null;
}

export function initialState(): CheckerState {
  return {
    components: Object.fromEntries(COMPONENT_IDS.map((id) => [id, INITIAL])) as Record<ComponentId, ComponentState>,
    hidden: [],
    deep: null,
    deepAt: null,
    lastRun: null,
    site: null,
    api: null,
  };
}

export class Store {
  readonly #db: D1Database;
  /** Databases whose tables exist, for this isolate. */
  static readonly #ready = new WeakSet<D1Database>();

  constructor(db: D1Database) {
    this.#db = db;
  }

  /** Creates the tables on the first use in this isolate; nothing to run by hand. */
  async ready(): Promise<void> {
    if (Store.#ready.has(this.#db)) return;
    await this.#db.batch(SCHEMA.map((statement) => this.#db.prepare(statement)));
    Store.#ready.add(this.#db);
  }

  async meta<T>(key: string): Promise<T | null> {
    const row = await this.#db.prepare('SELECT value FROM meta WHERE key = ?').bind(key).first<{ value: string }>();
    if (!row) return null;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return null;
    }
  }

  setMeta(key: string, value: unknown) {
    return this.#db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value').bind(key, JSON.stringify(value));
  }

  async state(): Promise<CheckerState> {
    const stored = await this.meta<CheckerState>('state');
    if (!stored) return initialState();
    // Parts added later start as operational.
    const components = { ...initialState().components, ...stored.components };
    return { ...initialState(), ...stored, components };
  }

  /** One minute in each part's state, for today's bar. */
  countMinute(day: string, minutes: Record<ComponentId, State | 'maint' | null>) {
    return COMPONENT_IDS.flatMap((id) => {
      const state = minutes[id];
      if (!state) return [];
      const column = state === 'operational' ? 'up' : state;
      return [this.#db.prepare(`INSERT INTO daily (component, day, ${column}) VALUES (?, ?, 1) ON CONFLICT (component, day) DO UPDATE SET ${column} = ${column} + 1`).bind(id, day)];
    });
  }

  recordLatency(bucket: number, siteMs: number | null, apiMs: number | null) {
    return this.#db.prepare(
      'INSERT INTO latency (bucket, site_sum, site_n, api_sum, api_n) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (bucket) DO UPDATE SET site_sum = site_sum + ?2, site_n = site_n + ?3, api_sum = api_sum + ?4, api_n = api_n + ?5',
    ).bind(bucket, siteMs ?? 0, siteMs === null ? 0 : 1, apiMs ?? 0, apiMs === null ? 0 : 1);
  }

  async days(fromDay: string): Promise<Array<{ component: string; day: string; up: number; degraded: number; down: number; maint: number }>> {
    const result = await this.#db.prepare('SELECT component, day, up, degraded, down, maint FROM daily WHERE day >= ? ORDER BY day').bind(fromDay).all<{ component: string; day: string; up: number; degraded: number; down: number; maint: number }>();
    return result.results;
  }

  async latency(fromBucket: number): Promise<Array<{ bucket: number; site_sum: number; site_n: number; api_sum: number; api_n: number }>> {
    const result = await this.#db.prepare('SELECT bucket, site_sum, site_n, api_sum, api_n FROM latency WHERE bucket >= ? ORDER BY bucket').bind(fromBucket).all<{ bucket: number; site_sum: number; site_n: number; api_sum: number; api_n: number }>();
    return result.results;
  }

  saveIncident(incident: Incident, updatedAt: string) {
    return this.#db.prepare(
      'INSERT INTO incidents (id, data, created_at, resolved_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET data = excluded.data, created_at = excluded.created_at, resolved_at = excluded.resolved_at, updated_at = excluded.updated_at',
    ).bind(incident.id, JSON.stringify(incident), incident.createdAt, incident.resolvedAt, updatedAt);
  }

  deleteIncident(id: string) {
    return this.#db.prepare('DELETE FROM incidents WHERE id = ?').bind(id);
  }

  async incidentUpdatedAt(): Promise<Map<string, string>> {
    const result = await this.#db.prepare('SELECT id, updated_at FROM incidents WHERE created_at >= ?').bind(Date.now() - 400 * 86_400_000).all<{ id: string; updated_at: string }>();
    return new Map(result.results.map((row) => [row.id, row.updated_at]));
  }

  /** Open ones, and those created or ended since `since`. */
  async incidents(since: number, limit = 100): Promise<Incident[]> {
    const result = await this.#db.prepare(
      'SELECT data FROM incidents WHERE resolved_at IS NULL OR created_at >= ?1 OR resolved_at >= ?1 ORDER BY created_at DESC LIMIT ?2',
    ).bind(since, limit).all<{ data: string }>();
    return result.results.flatMap((row) => {
      try {
        return [JSON.parse(row.data) as Incident];
      } catch {
        return [];
      }
    });
  }

  async incident(id: string): Promise<Incident | null> {
    const row = await this.#db.prepare('SELECT data FROM incidents WHERE id = ?').bind(id).first<{ data: string }>();
    return row ? (JSON.parse(row.data) as Incident) : null;
  }

  /** Daily clean-up: response times after 3 days, day rows after 400 days. */
  prune(now: number, oldestDay: string) {
    return [
      this.#db.prepare('DELETE FROM latency WHERE bucket < ?').bind(Math.floor((now - 3 * 86_400_000) / 300_000)),
      this.#db.prepare('DELETE FROM daily WHERE day < ?').bind(oldestDay),
    ];
  }

  async batch(statements: ReturnType<D1Database['prepare']>[]): Promise<void> {
    if (statements.length) await this.#db.batch(statements);
  }
}
