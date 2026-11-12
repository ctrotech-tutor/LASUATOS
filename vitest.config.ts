import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['apps/**/*.test.ts', 'packages/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    // Integration tests run a full in-memory Postgres (PGlite) plus password hashing;
    // shared CI runners can exceed the 5s default, so allow more headroom.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
