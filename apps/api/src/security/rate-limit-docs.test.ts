import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { describeLimits, documentedRoute, extractRateLimitBlock, rateLimitTableMarkdown } from './rate-limit-docs.js';
import { RATE_LIMIT_POLICIES } from './rate-limit-policies.js';

const apiDocs = readFileSync(fileURLToPath(new URL('../../../../docs/API.md', import.meta.url)), 'utf8');
const server = buildServer({ logger: false });

afterAll(async () => {
  await server.close();
});

describe('rate-limit documentation', () => {
  it('matches the policy table (run pnpm --filter @lasuatos/api docs:rate-limits after changing a limit)', () => {
    expect(extractRateLimitBlock(apiDocs)).toBe(rateLimitTableMarkdown());
  });

  it('names only routes the API serves, so a renamed route cannot leave its limit behind', async () => {
    await server.ready();
    const missing = Object.keys(RATE_LIMIT_POLICIES).filter((key) => {
      const [method, url] = key.split(' ');
      return !server.hasRoute({ method: method as 'GET' | 'POST' | 'DELETE', url: url ?? '' });
    });
    expect(missing).toEqual([]);
  });

  it('describes limits in plain words', () => {
    expect(describeLimits([
      { subject: 'ip', limit: 600, windowMilliseconds: 15 * 60_000 },
      { subject: 'email', limit: 10, windowMilliseconds: 15 * 60_000 },
    ])).toBe('600 per address and 10 per email, per 15 minutes');
    expect(describeLimits([{ subject: 'ip', limit: 20_000, windowMilliseconds: 10 * 60_000 }])).toBe('20,000 per address per 10 minutes');
    expect(describeLimits([
      { subject: 'session', limit: 20, windowMilliseconds: 60 * 60_000 },
      { subject: 'ip', limit: 600, windowMilliseconds: 15 * 60_000 },
    ])).toBe('20 per session per hour; 600 per address per 15 minutes');
    expect(documentedRoute('POST /api/v1/lecture/sessions/:sessionId/attendees/:attendeeId'))
      .toBe('POST /lecture/sessions/{sessionId}/attendees/{attendeeId}');
  });
});
