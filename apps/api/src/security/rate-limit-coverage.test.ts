import { describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { RATE_LIMIT_POLICIES, UNLIMITED_MUTATIONS } from './rate-limit-policies.js';

const STATE_CHANGING = /^(POST|PUT|PATCH|DELETE) /;

async function registeredRoutes(): Promise<string[]> {
  const routes: string[] = [];
  const server = buildServer({ logger: false, onRoute: (route) => routes.push(route) });
  await server.ready();
  await server.close();
  return routes;
}

describe('rate-limit coverage (ADR 036)', () => {
  it('limits every route that changes something, unless it is listed with a reason', async () => {
    const changing = (await registeredRoutes()).filter((route) => STATE_CHANGING.test(route));
    expect(changing.length).toBeGreaterThan(100);
    const unlimited = changing.filter((route) => !RATE_LIMIT_POLICIES[route] && !UNLIMITED_MUTATIONS[route]);
    expect(unlimited, 'Add these to RATE_LIMIT_POLICIES (or to UNLIMITED_MUTATIONS with a reason)').toEqual([]);
  });

  it('keeps the list of deliberate exceptions short and real', async () => {
    const routes = new Set(await registeredRoutes());
    for (const [route, reason] of Object.entries(UNLIMITED_MUTATIONS)) {
      expect(routes.has(route), route).toBe(true);
      expect(RATE_LIMIT_POLICIES[route], `${route} is both limited and listed as unlimited`).toBeUndefined();
      expect(reason.length).toBeGreaterThan(10);
    }
    expect(Object.keys(UNLIMITED_MUTATIONS).length).toBeLessThanOrEqual(3);
  });

  it('has no limits left for routes that no longer exist', async () => {
    const routes = new Set(await registeredRoutes());
    expect(Object.keys(RATE_LIMIT_POLICIES).filter((route) => !routes.has(route))).toEqual([]);
  });
});
