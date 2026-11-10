import { spawnSync } from 'node:child_process';

if (!process.env.DATABASE_URL?.trim()) {
  console.error('DATABASE_URL is required. Set it to a dedicated development database before migrating.');
  process.exit(1);
}

const executable = process.platform === 'win32' ? 'drizzle-kit.cmd' : 'drizzle-kit';
const result = spawnSync(executable, ['migrate', '--config', 'drizzle.migrate.config.ts'], {
  shell: process.platform === 'win32',
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
