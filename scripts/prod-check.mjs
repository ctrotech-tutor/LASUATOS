// Checks a deployed LASUATOS site: pages load, the API answers, and the database is reachable.
// Usage: pnpm prod:check            (reads PUBLIC_APP_URL from .env.production)
//        pnpm prod:check https://your-project.vercel.app
const base = (process.argv[2] ?? process.env.PUBLIC_APP_URL ?? '').replace(/\/+$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('Give the site address, e.g. pnpm prod:check https://your-project.vercel.app (or set PUBLIC_APP_URL in .env.production).');
  process.exit(2);
}

async function check(label, path, expect) {
  const started = Date.now();
  try {
    const response = await fetch(`${base}${path}`, { redirect: 'manual', signal: AbortSignal.timeout(30_000) });
    const text = await response.text();
    const outcome = expect(response, text);
    console.log(`${outcome.ok ? 'OK  ' : 'FAIL'} ${label} (${response.status}, ${Date.now() - started} ms)${outcome.note ? ` - ${outcome.note}` : ''}`);
    return outcome.ok;
  } catch (error) {
    console.log(`FAIL ${label} - ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

console.log(`Checking ${base}\n(The first request can take a few seconds while the free database wakes up.)\n`);
const results = [
  await check('Home page', '/', (response) => ({ ok: response.status === 200 })),
  await check('Sign-in page', '/sign-in', (response) => ({ ok: response.status === 200 })),
  await check('API health', '/api/v1/health', (response, text) => ({
    ok: response.status === 200 && text.includes('lasuatos-api'),
    note: response.status === 503 ? 'the API could not start; open Vercel → Logs to see which setting is missing (API_MODE=embedded?)' : '',
  })),
  await check('Database', '/api/v1/ready', (response, text) => ({
    ok: response.status === 200 && text.includes('"up"'),
    note: text.includes('not_configured') ? 'DATABASE_URL is not set on Vercel'
      : text.includes('down') ? 'DATABASE_URL is set but the database did not answer (wrong URL, or Neon compute suspended for the month)' : '',
  })),
  await check('HTTPS security header', '/', (response) => ({
    ok: !base.startsWith('https://') || Boolean(response.headers.get('strict-transport-security')),
    note: base.startsWith('https://') && !response.headers.get('strict-transport-security') ? 'set PUBLIC_APP_URL to this https address and redeploy' : '',
  })),
];

const failed = results.filter((ok) => !ok).length;
console.log(failed ? `\n${failed} check(s) failed. See docs/DEPLOYMENT.md → Troubleshooting.` : '\nAll checks passed.');
process.exit(failed ? 1 : 0);
