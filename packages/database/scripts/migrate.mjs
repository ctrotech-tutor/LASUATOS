import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

if (!process.env.DATABASE_URL?.trim()) {
  console.error('DATABASE_URL is required. Set it in .env (local) or .env.production (pnpm prod:migrate).');
  process.exit(1);
}

// Run drizzle-kit's own JavaScript entry with this Node binary: no shell, no .cmd shim,
// so it behaves the same on Windows and Linux (and avoids Node's DEP0190 warning).
const require = createRequire(import.meta.url);
const drizzleKitBin = path.join(path.dirname(require.resolve('drizzle-kit')), 'bin.cjs');
if (!existsSync(drizzleKitBin)) {
  console.error('drizzle-kit is not installed. Run pnpm install first.');
  process.exit(1);
}

const result = spawnSync(process.execPath, [drizzleKitBin, 'migrate', '--config', 'drizzle.migrate.config.ts'], {
  stdio: 'inherit',
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
