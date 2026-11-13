import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Brings the database up to date at the start of a production build, before the new
// code is built, so a merge can never leave the live site running against an older
// schema. It is the first step of the web app's own build (apps/web `build`), which is
// what Vercel runs. If a migration fails, the build fails and Vercel keeps serving the
// previous deployment. Migrations only add to the schema and are recorded, so a build
// with nothing new does nothing.
//
// Runs when VERCEL_ENV=production (or MIGRATE_ON_BUILD=1 on other hosts) and
// DATABASE_URL is set. Previews never touch the database (DATABASE_URL is
// production-only on Vercel), and SKIP_DATABASE_MIGRATIONS=true opts out.

const truthy = (value) => ['1', 'true', 'yes'].includes(String(value ?? '').trim().toLowerCase());

export function shouldMigrate(env) {
  if (truthy(env.SKIP_DATABASE_MIGRATIONS)) return false;
  if (!env.DATABASE_URL?.trim()) return false;
  return env.VERCEL_ENV === 'production' || truthy(env.MIGRATE_ON_BUILD);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!shouldMigrate(process.env)) {
    console.log('Database migrations: not a production deploy, skipped.');
  } else {
    console.log('Applying database migrations before the production build…');
    const databasePackage = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../packages/database');
    const result = spawnSync(process.execPath, ['scripts/migrate.mjs'], { cwd: databasePackage, env: process.env, stdio: 'inherit' });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.error('Database migrations failed, so this deployment stops here and the current site keeps running.');
      process.exit(result.status ?? 1);
    }
    console.log('Database migrations: up to date.');
  }
}
