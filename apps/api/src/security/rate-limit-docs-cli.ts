/**
 * Rewrites the rate-limit table in docs/API.md from the policy table:
 *
 *   pnpm --filter @lasuatos/api docs:rate-limits
 */
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { replaceRateLimitBlock } from './rate-limit-docs.js';

const apiDocs = fileURLToPath(new URL('../../../../docs/API.md', import.meta.url));
const before = await readFile(apiDocs, 'utf8');
const after = replaceRateLimitBlock(before);
if (after === before) {
  console.log('docs/API.md rate limits are already up to date.');
} else {
  await writeFile(apiDocs, after);
  console.log('Updated the rate-limit table in docs/API.md.');
}
