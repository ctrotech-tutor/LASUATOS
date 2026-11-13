import { createHash } from 'node:crypto';
import { and, eq, gt, lt, sql } from 'drizzle-orm';
import { rateLimitCounters, type DatabaseClient } from '@lasuatos/database';

/** Result of counting one hit against a fixed window. */
export interface RateLimitHit {
  readonly count: number;
  readonly resetAt: Date;
}

/**
 * Counter storage. `hit` increments the counter for `keyHash` in the current
 * window (starting a new window if the previous one has expired) and returns
 * the post-increment count. Implementations must be safe under concurrency.
 */
export interface RateLimitStore {
  hit(keyHash: string, windowMilliseconds: number, now: Date): Promise<RateLimitHit>;
  /** The current window's count without counting a hit; null when no window is open. */
  peek?(keyHash: string, now: Date): Promise<RateLimitHit | null>;
}

export interface RateLimitRule {
  /** Stable policy name, e.g. `auth.login:ip`. Part of the hashed key. */
  readonly name: string;
  /** Subject being limited (client address, normalized email, session token…). */
  readonly subject: string;
  readonly limit: number;
  readonly windowMilliseconds: number;
}

export type RateLimitDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly rule: string; readonly retryAfterSeconds: number };

/** Digest of policy + subject; raw addresses, emails and tokens never reach storage. */
export function rateLimitKey(name: string, subject: string): string {
  return createHash('sha256').update(`lasuatos-rate-limit\u0000${name}\u0000${subject}`).digest('hex');
}

/**
 * Process-local store for single-instance deployments and tests. Memory is
 * bounded: expired windows are pruned periodically, and when `maxKeys` is
 * reached the oldest windows are evicted first.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  readonly #windows = new Map<string, { count: number; resetAt: number }>();
  readonly #maxKeys: number;
  #hitsSincePrune = 0;

  constructor(options: { readonly maxKeys?: number } = {}) {
    this.#maxKeys = options.maxKeys ?? 50_000;
  }

  get size(): number {
    return this.#windows.size;
  }

  async hit(keyHash: string, windowMilliseconds: number, now: Date): Promise<RateLimitHit> {
    const nowMs = now.getTime();
    if (++this.#hitsSincePrune >= 1_000) this.#prune(nowMs);

    const current = this.#windows.get(keyHash);
    if (current && current.resetAt > nowMs) {
      current.count += 1;
      return { count: current.count, resetAt: new Date(current.resetAt) };
    }

    if (!current && this.#windows.size >= this.#maxKeys) {
      this.#prune(nowMs);
      // Map iteration follows insertion order, so the first keys are the oldest.
      for (const key of this.#windows.keys()) {
        if (this.#windows.size < this.#maxKeys) break;
        this.#windows.delete(key);
      }
    }
    const window = { count: 1, resetAt: nowMs + windowMilliseconds };
    this.#windows.delete(keyHash);
    this.#windows.set(keyHash, window);
    return { count: 1, resetAt: new Date(window.resetAt) };
  }

  async peek(keyHash: string, now: Date): Promise<RateLimitHit | null> {
    const current = this.#windows.get(keyHash);
    if (!current || current.resetAt <= now.getTime()) return null;
    return { count: current.count, resetAt: new Date(current.resetAt) };
  }

  #prune(nowMs: number): void {
    this.#hitsSincePrune = 0;
    for (const [key, window] of this.#windows) {
      if (window.resetAt <= nowMs) this.#windows.delete(key);
    }
  }
}

/**
 * PostgreSQL store shared by every API instance. A single upsert either starts
 * a new window or increments the current one atomically, so concurrent
 * requests cannot under-count. Expired rows are pruned opportunistically.
 */
export class PostgresRateLimitStore implements RateLimitStore {
  readonly #database: Pick<DatabaseClient, 'insert' | 'delete' | 'select'>;
  readonly #random: () => number;

  constructor(database: Pick<DatabaseClient, 'insert' | 'delete' | 'select'>, options: { readonly random?: () => number } = {}) {
    this.#database = database;
    this.#random = options.random ?? Math.random;
  }

  async hit(keyHash: string, windowMilliseconds: number, now: Date): Promise<RateLimitHit> {
    const resetAt = new Date(now.getTime() + windowMilliseconds);
    const nowIso = now.toISOString();
    const resetIso = resetAt.toISOString();
    const expired = sql`${rateLimitCounters.expiresAt} <= ${nowIso}::timestamptz`;
    const [row] = await this.#database
      .insert(rateLimitCounters)
      .values({ keyHash, count: 1, windowStartedAt: now, expiresAt: resetAt })
      .onConflictDoUpdate({
        target: rateLimitCounters.keyHash,
        set: {
          count: sql`CASE WHEN ${expired} THEN 1 ELSE ${rateLimitCounters.count} + 1 END`,
          windowStartedAt: sql`CASE WHEN ${expired} THEN ${nowIso}::timestamptz ELSE ${rateLimitCounters.windowStartedAt} END`,
          expiresAt: sql`CASE WHEN ${expired} THEN ${resetIso}::timestamptz ELSE ${rateLimitCounters.expiresAt} END`,
        },
      })
      .returning({ count: rateLimitCounters.count, expiresAt: rateLimitCounters.expiresAt });

    if (this.#random() < 0.01) {
      // Best effort; a failed prune must never fail the request being counted.
      await this.#database
        .delete(rateLimitCounters)
        .where(lt(rateLimitCounters.expiresAt, now))
        .catch(() => undefined);
    }

    if (!row) return { count: 1, resetAt };
    return { count: Number(row.count), resetAt: new Date(row.expiresAt) };
  }

  async peek(keyHash: string, now: Date): Promise<RateLimitHit | null> {
    const [row] = await this.#database
      .select({ count: rateLimitCounters.count, expiresAt: rateLimitCounters.expiresAt })
      .from(rateLimitCounters)
      .where(and(eq(rateLimitCounters.keyHash, keyHash), gt(rateLimitCounters.expiresAt, now)))
      .limit(1);
    return row ? { count: Number(row.count), resetAt: new Date(row.expiresAt) } : null;
  }
}

export interface RateLimiterOptions {
  readonly store: RateLimitStore;
  readonly now?: () => Date;
  /** Called when the store fails; the request is then allowed (fail-open). */
  readonly onStoreError?: (error: unknown) => void;
}

/**
 * Applies several rules to one request. Every rule is counted (so a client
 * cannot dodge one limit by tripping another first), and the decision reports
 * the rule with the longest wait. Store failures fail open: availability of
 * sign-in and check-in matters more than a missed count, and the failure is
 * reported through `onStoreError` for monitoring.
 */
export class RateLimiter {
  readonly #store: RateLimitStore;
  readonly #now: () => Date;
  readonly #onStoreError: ((error: unknown) => void) | undefined;

  constructor(options: RateLimiterOptions) {
    this.#store = options.store;
    this.#now = options.now ?? (() => new Date());
    this.#onStoreError = options.onStoreError;
  }

  async consume(rules: readonly RateLimitRule[]): Promise<RateLimitDecision> {
    if (!rules.length) return { allowed: true };
    const now = this.#now();
    let worst: { rule: string; retryAfterSeconds: number } | null = null;
    try {
      const hits = await Promise.all(rules.map((rule) => (
        this.#store.hit(rateLimitKey(rule.name, rule.subject), rule.windowMilliseconds, now)
      )));
      hits.forEach((hit, index) => {
        const rule = rules[index]!;
        if (hit.count <= rule.limit) return;
        const retryAfterSeconds = Math.max(1, Math.ceil((hit.resetAt.getTime() - now.getTime()) / 1_000));
        if (!worst || retryAfterSeconds > worst.retryAfterSeconds) worst = { rule: rule.name, retryAfterSeconds };
      });
    } catch (error) {
      this.#onStoreError?.(error);
      return { allowed: true };
    }
    return worst ? { allowed: false, ...(worst as { rule: string; retryAfterSeconds: number }) } : { allowed: true };
  }

  /**
   * Whether a rule's limit is already used up, without counting this request.
   * Pairs with `consume` for limits that count only failures (wrong typed codes):
   * check first, then count the attempt only if it failed. Fails open like `consume`.
   */
  async check(rule: RateLimitRule): Promise<RateLimitDecision> {
    if (!this.#store.peek) return { allowed: true };
    const now = this.#now();
    try {
      const current = await this.#store.peek(rateLimitKey(rule.name, rule.subject), now);
      if (!current || current.count < rule.limit) return { allowed: true };
      return {
        allowed: false,
        rule: rule.name,
        retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt.getTime() - now.getTime()) / 1_000)),
      };
    } catch (error) {
      this.#onStoreError?.(error);
      return { allowed: true };
    }
  }
}
