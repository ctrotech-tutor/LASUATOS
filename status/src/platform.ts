/**
 * The few Cloudflare Workers types the status page uses, declared here so it
 * needs no dependencies (it lives outside the pnpm workspace; see ADR 034).
 */

export interface D1Result<T> {
  readonly results: T[];
}

export interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
  run(): Promise<unknown>;
}

export interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch(statements: D1PreparedStatement[]): Promise<unknown[]>;
  exec(query: string): Promise<unknown>;
}

export interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

export interface ScheduledController {
  readonly scheduledTime: number;
  readonly cron: string;
}

export interface Env {
  readonly DB: D1Database;
  /** The LASUATOS deployment to check, e.g. https://lasuatos.vercel.app */
  readonly TARGET_URL: string;
  /** This page's own public address, for links in notices and the feed. */
  readonly PUBLIC_URL?: string;
  /** owner/name of the repository whose issues carry incidents (label "status"). */
  readonly GITHUB_REPO?: string;
  /** Fine-grained token: Issues read and write on GITHUB_REPO only. A Worker secret. */
  readonly GITHUB_TOKEN?: string;
  /** Minutes between deep checks in the day (06:00–21:59 WAT) and at night. */
  readonly DEEP_EVERY_DAY_MINUTES?: string;
  readonly DEEP_EVERY_NIGHT_MINUTES?: string;
}
