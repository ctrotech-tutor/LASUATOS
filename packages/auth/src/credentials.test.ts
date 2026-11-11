import { describe, expect, it } from 'vitest';
import {
  createOpaqueToken,
  hashOpaqueToken,
  hashPassword,
  verifyPassword,
  verifyPasswordOrDummy,
} from './credentials.js';

describe('credential helpers', () => {
  it('stores only a salted scrypt password hash and verifies it', async () => {
    const firstHash = await hashPassword('A long test password 2026');
    const secondHash = await hashPassword('A long test password 2026');

    expect(firstHash).not.toBe(secondHash);
    expect(firstHash).not.toContain('A long test password 2026');
    await expect(verifyPassword('A long test password 2026', firstHash)).resolves.toBe(true);
    await expect(verifyPassword('A different password', firstHash)).resolves.toBe(false);
  });

  it('uses a dummy hash for missing accounts and rejects malformed stored hashes', async () => {
    await expect(verifyPasswordOrDummy('any password', null)).resolves.toBe(false);
    await expect(verifyPassword('any password', 'not-a-scrypt-hash')).resolves.toBe(false);
  });

  it('creates high-entropy opaque tokens and stores a one-way digest', () => {
    const firstToken = createOpaqueToken();
    const secondToken = createOpaqueToken();

    expect(firstToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(secondToken).not.toBe(firstToken);
    expect(hashOpaqueToken(firstToken)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashOpaqueToken(firstToken)).not.toBe(firstToken);
  });
});
