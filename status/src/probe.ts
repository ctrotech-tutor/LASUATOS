import type { DeepReport, Probe, ReportedState } from './model.ts';

/**
 * The checks themselves. Each failure is tried once more a few seconds later before
 * it counts, so one dropped packet between Cloudflare and Vercel never shows as an outage.
 */

export const USER_AGENT = 'LASUATOS-Status/1.0 (+independent status checker)';
export const RETRY_AFTER_MS = 4_000;

export interface ProbeOptions {
  readonly fetch?: typeof fetch;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly now?: () => number;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function once<T>(url: string, timeoutMs: number, read: (response: Response) => Promise<T | null>, options: ProbeOptions): Promise<{ probe: Probe; value: T | null }> {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const started = now();
  try {
    const response = await fetcher(url, {
      headers: { 'user-agent': USER_AGENT, accept: '*/*', 'cache-control': 'no-cache' },
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const value = await read(response);
    const ms = now() - started;
    return { probe: { ok: value !== null, ms, status: response.status }, value };
  } catch {
    return { probe: { ok: false, ms: null, status: 0 }, value: null };
  }
}

async function withRetry<T>(url: string, timeoutMs: number, read: (response: Response) => Promise<T | null>, options: ProbeOptions): Promise<{ probe: Probe; value: T | null }> {
  const first = await once(url, timeoutMs, read, options);
  if (first.probe.ok) return first;
  await (options.sleep ?? wait)(RETRY_AFTER_MS);
  return once(url, timeoutMs, read, options);
}

/** The home page: answers 200 and is really LASUATOS (not an error page from the host). */
export async function probeSite(target: string, options: ProbeOptions = {}): Promise<Probe> {
  const result = await withRetry(`${target}/`, 10_000, async (response) => {
    if (response.status !== 200) return null;
    const text = await response.text();
    return text.includes('LASUATOS') ? true : null;
  }, options);
  return result.probe;
}

/** The API is running (no database needed): GET /api/v1/health. */
export async function probeApi(target: string, options: ProbeOptions = {}): Promise<Probe> {
  const result = await withRetry(`${target}/api/v1/health`, 8_000, async (response) => {
    if (response.status !== 200) return null;
    const body: unknown = await response.json().catch(() => null);
    return body && typeof body === 'object' && 'status' in body && body.status === 'ok' ? true : null;
  }, options);
  return result.probe;
}

const STATES = new Set<ReportedState>(['operational', 'degraded', 'down', 'off']);

export function readDeep(body: unknown): DeepReport | null {
  if (!body || typeof body !== 'object' || !('service' in body) || body.service !== 'lasuatos' || !('components' in body)) return null;
  const components = body.components as Record<string, unknown> | null;
  if (!components || typeof components !== 'object') return null;
  const pick = (key: keyof DeepReport): ReportedState | null => (STATES.has(components[key] as ReportedState) ? (components[key] as ReportedState) : null);
  const report = { core: pick('core'), errors: pick('errors'), email: pick('email'), google: pick('google'), face: pick('face') };
  if (Object.values(report).some((value) => value === null)) return null;
  return report as DeepReport;
}

/**
 * LASUATOS's own view (GET /api/v1/status): database, emails, Google, face engine.
 * It answers 503 with the same body when its database is down; no usable answer at
 * all means the database-backed part of the API is failing, so it counts as down,
 * keeping what was turned off as off.
 */
export async function probeDeep(target: string, previous: DeepReport | null, options: ProbeOptions = {}): Promise<{ probe: Probe; report: DeepReport }> {
  const result = await withRetry(`${target}/api/v1/status`, 20_000, async (response) => {
    if (response.status !== 200 && response.status !== 503) return null;
    return readDeep(await response.json().catch(() => null));
  }, options);
  if (result.value) return { probe: result.probe, report: result.value };
  return {
    probe: result.probe,
    report: {
      core: 'down',
      errors: 'operational',
      email: 'down',
      google: previous?.google === 'off' ? 'off' : 'down',
      face: previous?.face === 'off' ? 'off' : 'down',
    },
  };
}
