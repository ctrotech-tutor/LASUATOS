import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildServer } from '../server.js';
import { MemoryRateLimitStore, RateLimiter } from '../security/rate-limit.js';
import { LECTURE_CODE_MISS_RULE } from '../security/rate-limit-policies.js';
import { LectureError, type LectureService } from './service.js';

const servers: ReturnType<typeof buildServer>[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

const RESOLVED = {
  ticket: 'ticket-0123456789',
  ticketExpiresAt: new Date(Date.now() + 600_000).toISOString(),
  session: { id: '00000000-0000-4000-8000-000000000001', courseCode: 'CSC 301', courseTitle: 'Operating Systems', lecturerName: null, takenBy: 'Lecturer', endsAt: new Date(Date.now() + 600_000).toISOString() },
};

function createServer(resolve: (input: { code?: string; challenge?: string }) => Promise<unknown>, checkIn = vi.fn(async () => ({ status: 'checked_in' }))) {
  const lecture = { resolve: vi.fn(async (_account: unknown, input: { code?: string; challenge?: string }) => resolve(input)), checkIn };
  const server = buildServer({
    logger: false,
    lecture: lecture as unknown as LectureService,
    rateLimiter: new RateLimiter({ store: new MemoryRateLimitStore() }),
  });
  servers.push(server);
  return { server, lecture };
}

const resolveRequest = (body: object, ip = '203.0.113.7') => ({
  method: 'POST' as const,
  url: '/api/v1/lecture/resolve',
  remoteAddress: ip,
  payload: body,
});

describe('lecture check-in rate limits', () => {
  it('stops an address after too many wrong typed codes, before checking the next guess', async () => {
    const { server, lecture } = createServer(async (input) => {
      if (input.code === 'RIGHT1') return RESOLVED;
      throw new LectureError(404, 'That code is not right or has expired.');
    });
    for (let index = 0; index < LECTURE_CODE_MISS_RULE.limit; index += 1) {
      const miss = await server.inject(resolveRequest({ code: 'WRONG1' }));
      expect(miss.statusCode).toBe(404);
    }
    const calls = lecture.resolve.mock.calls.length;
    const blocked = await server.inject(resolveRequest({ code: 'RIGHT1' }));
    expect(blocked.statusCode).toBe(429);
    expect(blocked.headers['retry-after']).toBeDefined();
    // The guess was refused without being looked up.
    expect(lecture.resolve.mock.calls.length).toBe(calls);

    // Another address (another hall) is unaffected, and so are scanned QR challenges.
    expect((await server.inject(resolveRequest({ code: 'RIGHT1' }, '198.51.100.20'))).statusCode).toBe(200);
  });

  it('never counts correct codes, so a full hall on one address is not slowed', async () => {
    const { server } = createServer(async () => RESOLVED);
    for (let index = 0; index < LECTURE_CODE_MISS_RULE.limit + 50; index += 1) {
      const response = await server.inject(resolveRequest({ code: 'RIGHT1', scanned: true }));
      expect(response.statusCode).toBe(200);
    }
  });

  it('does not count wrong scanned challenges as guesses (they are signed)', async () => {
    const { server } = createServer(async () => { throw new LectureError(404, 'This QR code is not recognised.'); });
    for (let index = 0; index < LECTURE_CODE_MISS_RULE.limit + 5; index += 1) {
      expect((await server.inject(resolveRequest({ challenge: 'lasu2.not-a-real-challenge' }))).statusCode).toBe(404);
    }
  });

  it('lets a whole hall share one ticket (everyone scanning in the same second gets the same one)', async () => {
    const { server } = createServer(async () => RESOLVED);
    const submit = (matric: string) => server.inject({
      method: 'POST',
      url: '/api/v1/lecture/check-in',
      remoteAddress: '203.0.113.7',
      payload: { ticket: 'ticket-0123456789', fullName: 'Ada Obi', matricNumber: matric },
    });
    for (let index = 0; index < 400; index += 1) expect((await submit(`22059${String(1000 + index)}`)).statusCode).toBe(201);
  });
});
