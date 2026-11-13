import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Typecheck every package, then build the web app. The web build also bundles the
// embedded API (apps/api/dist/embedded.mjs) used by the free single-deployment setup.
const steps = [
  ['--filter', '@lasuatos/contracts', 'typecheck'],
  ['--filter', '@lasuatos/auth', 'typecheck'],
  ['--filter', '@lasuatos/verification', 'typecheck'],
  ['--filter', '@lasuatos/database', 'typecheck'],
  ['--filter', '@lasuatos/api', 'typecheck'],
  ['--filter', '@lasuatos/web', 'typecheck'],
  ['--filter', '@lasuatos/web', 'build'],
];

// Re-use the pnpm that started this script (`pnpm build`). npm_execpath is either its
// JavaScript entry or (pnpm 11+) a native executable; both run without a shell or PATH lookup.
const pnpmEntry = process.env.npm_execpath ?? '';
const viaNode = /\.(c|m)?js$/i.test(pnpmEntry);
const direct = Boolean(pnpmEntry) && !viaNode && !/\.(cmd|bat)$/i.test(pnpmEntry);

function runPnpm(args) {
  if (viaNode) return spawnSync(process.execPath, [pnpmEntry, ...args], { env: process.env, stdio: 'inherit' });
  if (direct) return spawnSync(pnpmEntry, args, { env: process.env, stdio: 'inherit' });
  // Fallback: on Windows pnpm is a .cmd shim and needs a shell. These arguments contain no
  // spaces, so one joined command string is safe and avoids Node's DEP0190 warning.
  return process.platform === 'win32'
    ? spawnSync(`pnpm ${args.join(' ')}`, { env: process.env, shell: true, stdio: 'inherit' })
    : spawnSync('pnpm', args, { env: process.env, stdio: 'inherit' });
}

function run(args) {
  const result = runPnpm(args);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  // The web build starts with scripts/migrate-on-deploy.mjs, which only migrates on
  // production deploys (or with MIGRATE_ON_BUILD=1).
  for (const args of steps) run(args);
}
