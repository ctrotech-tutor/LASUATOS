import { describe, expect, it } from 'vitest';
// @ts-expect-error - plain JavaScript build script without type declarations.
import { shouldMigrate } from './migrate-on-deploy.mjs';

describe('database migrations on deploy', () => {
  const url = 'postgresql://user:pass@db.example/app';

  it('migrates production deploys that have a database', () => {
    expect(shouldMigrate({ VERCEL_ENV: 'production', DATABASE_URL: url })).toBe(true);
  });

  it('never migrates previews, local builds or builds without a database', () => {
    expect(shouldMigrate({ VERCEL_ENV: 'preview', DATABASE_URL: url })).toBe(false);
    expect(shouldMigrate({ DATABASE_URL: url })).toBe(false);
    expect(shouldMigrate({ VERCEL_ENV: 'production' })).toBe(false);
    expect(shouldMigrate({ VERCEL_ENV: 'production', DATABASE_URL: '  ' })).toBe(false);
  });

  it('can be switched off, or on for other hosts', () => {
    expect(shouldMigrate({ VERCEL_ENV: 'production', DATABASE_URL: url, SKIP_DATABASE_MIGRATIONS: 'true' })).toBe(false);
    expect(shouldMigrate({ DATABASE_URL: url, MIGRATE_ON_BUILD: '1' })).toBe(true);
  });
});
