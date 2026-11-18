import { refreshSummary, run } from './checker.ts';
import type { Env, ExecutionContext, ScheduledController } from './platform.ts';
import { FAVICON, renderBadge, renderFeed, renderHistory, renderHome, renderIncident, renderNotFound } from './render.ts';
import { Store } from './store.ts';
import { notices, type Summary } from './summary.ts';

/**
 * The LASUATOS status page (ADR 034): a Cloudflare Worker with a Cron Trigger and a
 * D1 database. It runs apart from LASUATOS (another provider, another network), so it
 * still answers when LASUATOS, Vercel or the database is down.
 */

const HTML_CSP = (nonce: string) => [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  `script-src 'nonce-${nonce}'`,
  "connect-src 'self'",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const COMMON_HEADERS: Record<string, string> = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'strict-transport-security': 'max-age=31536000',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
};

function respond(body: string, type: string, init: { status?: number; cache?: string; headers?: Record<string, string> } = {}): Response {
  return new Response(body, {
    status: init.status ?? 200,
    headers: {
      ...COMMON_HEADERS,
      'content-type': type,
      'cache-control': init.cache ?? 'public, max-age=30, stale-while-revalidate=30',
      ...init.headers,
    },
  });
}

function json(value: unknown, init: { status?: number; cache?: string } = {}): Response {
  return respond(JSON.stringify(value), 'application/json; charset=utf-8', {
    ...init,
    headers: { 'access-control-allow-origin': '*' },
  });
}

function nonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

async function summaryOf(store: Store, now: number): Promise<Summary> {
  const stored = await store.meta<Summary>('summary');
  if (stored) return stored;
  await refreshSummary(store, now);
  return (await store.meta<Summary>('summary'))!;
}

export async function handle(request: Request, env: Env, now = Date.now()): Promise<Response> {
  const url = new URL(request.url);
  const origin = (env.PUBLIC_URL ?? url.origin).replace(/\/+$/, '');
  const target = env.TARGET_URL.replace(/\/+$/, '');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, HEAD', 'access-control-max-age': '86400' } });
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') return respond('Method not allowed', 'text/plain; charset=utf-8', { status: 405, headers: { allow: 'GET, HEAD' } });

  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/favicon.svg' || path === '/favicon.ico') return respond(FAVICON, 'image/svg+xml', { cache: 'public, max-age=86400' });
  if (path === '/robots.txt') return respond(`User-agent: *\nAllow: /\n`, 'text/plain; charset=utf-8', { cache: 'public, max-age=86400' });

  const store = new Store(env.DB);
  await store.ready();
  const pageOptions = { nonce: nonce(), target, origin, now };

  switch (path) {
    case '/': {
      const summary = await summaryOf(store, now);
      return respond(renderHome(summary, pageOptions), 'text/html; charset=utf-8', { cache: 'no-cache', headers: { 'content-security-policy': HTML_CSP(pageOptions.nonce) } });
    }
    case '/history': {
      const incidents = await store.incidents(now - 90 * 86_400_000, 200);
      const list = incidents.filter((incident) => incident.resolvedAt !== null || incident.kind === 'incident' || (incident.startsAt ?? 0) <= now);
      return respond(renderHistory(list, pageOptions), 'text/html; charset=utf-8', { headers: { 'content-security-policy': HTML_CSP(pageOptions.nonce) } });
    }
    case '/feed.atom':
    case '/feed':
    case '/feed.xml': {
      const incidents = await store.incidents(now - 90 * 86_400_000, 30);
      return respond(renderFeed(incidents, origin, now), 'application/atom+xml; charset=utf-8', { cache: 'public, max-age=60' });
    }
    case '/badge.svg': {
      const summary = await summaryOf(store, now);
      return respond(renderBadge(summary.overall), 'image/svg+xml', { cache: 'public, max-age=60', headers: { 'access-control-allow-origin': '*' } });
    }
    case '/api/summary.json':
      return json(await summaryOf(store, now), { cache: 'no-cache' });
    case '/api/status.json': {
      // A small answer for other tools: overall state and each part's state.
      const summary = await summaryOf(store, now);
      return json({
        page: { name: 'LASUATOS', url: `${origin}/` },
        status: summary.overall,
        lastCheckAt: summary.lastCheckAt === null ? null : new Date(summary.lastCheckAt).toISOString(),
        components: summary.components.map((component) => ({ id: component.id, name: component.name, status: component.state, uptime90d: component.uptime })),
        incidents: summary.active.map((incident) => ({ id: incident.id, title: incident.title, impact: incident.impact, url: `${origin}/incidents/${incident.id}` })),
      });
    }
    case '/api/notices.json': {
      // For the banner in the app (StatusNoticesSchema in @lasuatos/contracts).
      const summary = await summaryOf(store, now);
      return json({ statusPageUrl: origin, notices: notices(summary, origin, now) }, { cache: 'public, max-age=30' });
    }
    default:
      break;
  }

  const incidentPath = /^\/incidents\/((?:gh|auto)-\d{1,15})$/.exec(path);
  if (incidentPath) {
    const incident = await store.incident(incidentPath[1]!);
    if (incident) return respond(renderIncident(incident, pageOptions), 'text/html; charset=utf-8', { headers: { 'content-security-policy': HTML_CSP(pageOptions.nonce) } });
  }
  return respond(renderNotFound(pageOptions), 'text/html; charset=utf-8', { status: 404, headers: { 'content-security-policy': HTML_CSP(pageOptions.nonce) } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      return await handle(request, env);
    } catch {
      return respond('The status page could not load its data. Try again in a minute.', 'text/plain; charset=utf-8', { status: 503, cache: 'no-store' });
    }
  },

  async scheduled(controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(run(env, { at: controller.scheduledTime }).then(() => undefined));
  },
};
