import { spawnSync } from 'node:child_process';

const packageManager = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const checks = [
  ['pnpm', '--filter', '@lasuatos/contracts', 'typecheck'],
  ['pnpm', '--filter', '@lasuatos/auth', 'typecheck'],
  ['pnpm', '--filter', '@lasuatos/database', 'typecheck'],
  ['pnpm', '--filter', '@lasuatos/api', 'typecheck'],
  ['pnpm', '--filter', '@lasuatos/web', 'build'],
];

for (const args of checks) {
  const result = spawnSync(packageManager, args, {
    env: process.env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
