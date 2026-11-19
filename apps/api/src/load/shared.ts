/**
 * Plumbing shared by the load rehearsals (lecture-rush.ts, pilot-morning.ts):
 * a local PostgreSQL check, the migrations (the same journal as pnpm db:migrate), server
 * instances that each run the production wiring in their own process (like
 * one warm Vercel function instance), a recorder for latencies and an HTTP
 * client that behaves like a browser on the live site (same origin header,
 * cut off at the platform's 30-second limit).
 */
import { fork, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { createDatabase } from '@lasuatos/database';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';

const here = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(here, '../../../..');
const migrations = path.join(repositoryRoot, 'packages/database/drizzle/migrations');

/** The origin the instances believe they serve (PUBLIC_APP_URL); every request sends it. */
export const APP_ORIGIN = 'https://lasuatos.load.test';
/** Vercel cuts /api/v1 off at 30 seconds. */
export const PLATFORM_LIMIT_MS = 30_000;

export const clampInt = (value: string | undefined, fallback: number, min: number, max: number) => {
  const number = Number.parseInt(value ?? '', 10);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
};
export const share = (value: string | undefined, fallback: number) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
};
export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function isLoopbackDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host === '127.0.0.1' || host === 'localhost' || host === '[::1]' || host === '::1';
  } catch {
    return false;
  }
}

/**
 * DATABASE_URL, refused unless it is on this computer: the rehearsals write
 * thousands of rows and clear the rate-limit counters, so they are for a local
 * copy (a fresh database or a restored copy of staging), never the live site.
 */
export function localDatabaseUrl(): string {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    throw new Error([
      'Set DATABASE_URL to a PostgreSQL database on this computer, for example',
      '  docker compose up -d postgres   then   DATABASE_URL=postgres://lasuatos_dev:lasuatos_dev@127.0.0.1:5432/lasuatos_dev',
      'A fresh database is set up automatically. Never point this at the live database.',
    ].join('\n'));
  }
  if (!isLoopbackDatabase(databaseUrl)) {
    throw new Error('DATABASE_URL must be a database on this computer (127.0.0.1 or localhost): this test writes thousands of rows. Restore a copy locally instead.');
  }
  return databaseUrl;
}

export type LocalDatabase = ReturnType<typeof createDatabase>;

/**
 * Opens the local database and brings it up to the latest migration: all of
 * them on an empty database, only the new ones on a database from an earlier
 * run (recorded in the same journal pnpm db:migrate keeps, so a branch that
 * adds a migration is measured with it).
 */
export async function openLocalDatabase(databaseUrl: string, maxConnections = 4) {
  const database = createDatabase(databaseUrl, { maxConnections });
  const rows = async <T>(query: ReturnType<typeof sql>) => ((await database.db.execute(query)) as unknown as { rows: T[] }).rows;
  const [state] = await rows<{ schema: boolean; journal: boolean }>(sql`SELECT
    to_regclass('public.institutions') IS NOT NULL AS schema,
    to_regclass('drizzle.__drizzle_migrations') IS NOT NULL AS journal`);
  const journalled = state?.journal
    ? Number((await rows<{ count: string }>(sql`SELECT count(*) AS count FROM drizzle.__drizzle_migrations`))[0]?.count ?? 0) > 0
    : false;
  if (state?.schema && !journalled) {
    await database.close();
    throw new Error('This database has tables but no migration journal (an older load run made it), so its migrations cannot be brought up to date. Drop it and create it again (dropdb, createdb); the run seeds it in under a minute.');
  }
  await migrate(database.db, { migrationsFolder: migrations });
  return { database, db: database.db, rows };
}

/**
 * Gives seeded faces the packed copy of their signature that registration
 * writes (students/centroid-pack.ts), with the same statement migration 0033
 * packs older rows with, so the duplicate search reads what it reads in
 * production.
 */
export async function packSeededCentroids(db: LocalDatabase['db'], institutionId: string): Promise<void> {
  await db.execute(sql`
    UPDATE student_face_profiles SET centroid_packed = (
      SELECT string_agg(float4send(element.value::float4), ''::bytea ORDER BY element.position)
      FROM jsonb_array_elements_text(student_face_profiles.centroid) WITH ORDINALITY AS element(value, position)
    ) WHERE institution_id = ${institutionId} AND centroid_packed IS NULL AND jsonb_typeof(centroid) = 'array'`);
}

/* ------------------------------------------------------------------ */
/* Server instances (child processes running instance.ts)               */
/* ------------------------------------------------------------------ */

export interface Instance { readonly child: ChildProcess; readonly base: string }

export interface FaceFigures { waiting: number; waitingPhotos: number; photoMilliseconds: number; completed: number; turnedAway: number }
export interface InstanceFigures {
  readonly cpuMs: number;
  readonly peakRssMb: number;
  /** The longest the request thread was blocked since the last reset (event-loop delay, ms). */
  readonly loopDelayMaxMs: number;
  readonly loopDelayP99Ms: number;
  readonly face: FaceFigures | null;
  /** Average database round trips per request, by route (instance.ts counts them). */
  readonly queriesPerRoute: Readonly<Record<string, number>>;
}

/**
 * The environment every instance gets: production mode with the serverless
 * pool, the given database and rate-limit store, no email, quiet logs.
 */
export function instanceEnvironment(input: {
  readonly databaseUrl: string;
  readonly slug: string;
  readonly poolMax: number;
  readonly rateLimits: string;
  readonly logs: boolean;
  readonly extra?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_ENV: 'production',
    DATABASE_URL: input.databaseUrl,
    DATABASE_POOL_MAX: String(input.poolMax),
    PUBLIC_APP_URL: APP_ORIGIN,
    SELF_REGISTRATION_INSTITUTION_SLUG: input.slug,
    RATE_LIMIT_STORE: input.rateLimits,
    EMAIL_PROVIDER: 'none',
    ALERT_EMAIL: '',
    LOG_LEVEL: input.logs ? 'error' : 'silent',
    ...input.extra,
  };
}

export function startInstance(environment: NodeJS.ProcessEnv): Promise<Instance> {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(here, 'instance.ts'), [], { env: environment, execArgv: process.execArgv, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const timer = setTimeout(() => reject(new Error('A server instance did not start within 60 seconds.')), 60_000);
    child.once('message', (message: { type?: string; port?: number }) => {
      if (message?.type !== 'ready') return;
      clearTimeout(timer);
      resolve({ child, base: `http://127.0.0.1:${message.port}` });
    });
    child.once('exit', (code) => reject(new Error(`A server instance stopped while starting (exit ${code}).`)));
  });
}

/**
 * CPU used, peak memory and request-thread stalls; `reset` starts a new
 * event-loop window. Wrap it when mapping (`instances.map((i) => instanceStats(i))`).
 */
export function instanceStats(instance: Instance, options: { readonly reset?: boolean } = {}): Promise<InstanceFigures> {
  return new Promise((resolve) => {
    const listener = (message: { type?: string } & Partial<InstanceFigures>) => {
      if (message?.type !== 'stats') return;
      instance.child.off('message', listener);
      resolve({
        cpuMs: message.cpuMs ?? 0,
        peakRssMb: message.peakRssMb ?? 0,
        loopDelayMaxMs: message.loopDelayMaxMs ?? 0,
        loopDelayP99Ms: message.loopDelayP99Ms ?? 0,
        face: message.face ?? null,
        queriesPerRoute: message.queriesPerRoute ?? {},
      });
    };
    instance.child.on('message', listener);
    instance.child.send({ type: 'stats', reset: options.reset === true });
  });
}

export function stopInstances(instances: readonly Instance[]): void {
  for (const instance of instances) instance.child.send({ type: 'stop' });
}

/* ------------------------------------------------------------------ */
/* Measurements                                                         */
/* ------------------------------------------------------------------ */

export interface Sample { readonly ms: number; readonly status: number; readonly outcome: string }

export function percentile(sorted: readonly number[], p: number): number | null {
  if (!sorted.length) return null;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]!);
}

export function summarize(list: readonly Sample[]) {
  const latencies = list.map((sample) => sample.ms).sort((a, b) => a - b);
  const outcomes: Record<string, number> = {};
  for (const sample of list) outcomes[`${sample.status} ${sample.outcome}`] = (outcomes[`${sample.status} ${sample.outcome}`] ?? 0) + 1;
  return {
    requests: list.length,
    outcomes,
    p50Ms: percentile(latencies, 50),
    p95Ms: percentile(latencies, 95),
    p99Ms: percentile(latencies, 99),
    maxMs: latencies.length ? Math.round(latencies.at(-1)!) : null,
  };
}

export class Recorder {
  readonly #samples = new Map<string, Sample[]>();

  record(step: string, ms: number, status: number, outcome: string): void {
    if (!this.#samples.has(step)) this.#samples.set(step, []);
    this.#samples.get(step)!.push({ ms, status, outcome });
  }

  get(step: string): readonly Sample[] {
    return this.#samples.get(step) ?? [];
  }

  /** Every step, sorted by name, summarised. */
  report() {
    return Object.fromEntries([...this.#samples.keys()].sort().map((step) => [step, summarize(this.#samples.get(step)!)]));
  }
}

export interface CallResult {
  readonly status: number;
  readonly json: Record<string, unknown> | null;
  readonly headers: Headers;
  readonly cookies: string[];
}

/**
 * A fetch that records each request under `step`: latency, HTTP status and the
 * answer's `status` field (or its problem detail). A request still running at
 * 30 s is cut off and recorded as 504, as the platform would.
 */
export function createClient(recorder: Recorder, pickBase: () => string) {
  return async function call(
    step: string,
    method: string,
    route: string,
    init: { body?: unknown; cookie?: string | undefined; base?: string } = {},
  ): Promise<CallResult> {
    const started = performance.now();
    try {
      const response = await fetch(`${init.base ?? pickBase()}${route}`, {
        method,
        headers: {
          accept: 'application/json',
          origin: APP_ORIGIN,
          ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
          ...(init.cookie ? { cookie: init.cookie } : {}),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(PLATFORM_LIMIT_MS),
      });
      const text = await response.text();
      let json: Record<string, unknown> | null = null;
      try { json = text ? JSON.parse(text) as Record<string, unknown> : null; } catch { /* not JSON */ }
      const outcome = String(json?.status && typeof json.status === 'string' ? json.status : response.ok ? 'ok' : (json?.detail ?? json?.title ?? `http_${response.status}`)).slice(0, 70);
      recorder.record(step, performance.now() - started, response.status, outcome);
      return { status: response.status, json, headers: response.headers, cookies: response.headers.getSetCookie() };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === 'TimeoutError';
      recorder.record(step, performance.now() - started, timedOut ? 504 : 0, timedOut ? 'cut off at 30 s (platform limit)' : 'network error');
      return { status: timedOut ? 504 : 0, json: null, headers: new Headers(), cookies: [] };
    }
  };
}

/** The `lasuatos_session=…` pair from a response's Set-Cookie lines. */
export function sessionCookieFrom(cookies: readonly string[]): string {
  return cookies.map((line) => line.split(';')[0]).filter((part) => part?.startsWith('lasuatos_session=')).join('; ');
}
