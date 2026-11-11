import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const baseLocalEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'development',
  DATABASE_URL: 'postgresql://lasuatos_dev:lasuatos_dev_only@127.0.0.1:5433/lasuatos_dev',
  POSTGRES_DB: 'lasuatos_dev',
  POSTGRES_USER: 'lasuatos_dev',
  POSTGRES_PASSWORD: 'lasuatos_dev_only',
  POSTGRES_PORT: '5433',
  LOCAL_DEMO_MODE: 'true',
  SELF_REGISTRATION_INSTITUTION_SLUG: 'lasuatos-local-demo',
  EMAIL_PROVIDER: 'mailpit',
  MAILPIT_HOST: '127.0.0.1',
  MAILPIT_PORT: '1025',
  MAILPIT_SMTP_PORT: '1025',
};

function runScript(relativePath: string, environment: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, [resolve(process.cwd(), relativePath)], {
    encoding: 'utf8',
    env: { ...baseLocalEnvironment, ...environment },
  });
}

describe('local development setup safety', () => {
  it('refuses a remote database before invoking Docker or migrations', () => {
    const result = runScript('scripts/dev-setup.mjs', {
      DATABASE_URL: 'postgresql://lasuatos_dev:lasuatos_dev_only@db.example.org:5433/lasuatos_dev',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Local setup stopped before starting Docker');
    expect(result.stderr).not.toContain('db.example.org');
  });

  it('refuses a loopback database that is not the dedicated Compose port', () => {
    const result = runScript('scripts/dev-setup.mjs', {
      DATABASE_URL: 'postgresql://lasuatos_dev:lasuatos_dev_only@127.0.0.1:5432/lasuatos_dev',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Local setup stopped before starting Docker');
  });

  it('refuses database credentials that do not match the Compose service', () => {
    const result = runScript('scripts/dev-setup.mjs', {
      POSTGRES_PASSWORD: 'different-local-password',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Local setup stopped before starting Docker');
  });

  it('refuses to seed a remote database', () => {
    const result = runScript('packages/database/scripts/seed-local-demo.mjs', {
      DATABASE_URL: 'postgresql://lasuatos_dev:lasuatos_dev_only@db.example.org:5433/lasuatos_dev',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Local demo seeding is restricted');
    expect(result.stderr).not.toContain('db.example.org');
  });

  it('refuses to seed a loopback database that is not the dedicated Compose port', () => {
    const result = runScript('packages/database/scripts/seed-local-demo.mjs', {
      DATABASE_URL: 'postgresql://lasuatos_dev:lasuatos_dev_only@127.0.0.1:5432/lasuatos_dev',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Local demo seeding is restricted');
  });

  it('refuses to seed when Compose credentials do not match the database URL', () => {
    const result = runScript('packages/database/scripts/seed-local-demo.mjs', {
      POSTGRES_PASSWORD: 'different-local-password',
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Local demo seeding is restricted');
  });
});
