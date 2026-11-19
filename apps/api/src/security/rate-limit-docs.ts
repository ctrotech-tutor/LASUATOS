import { LECTURE_CODE_MISS_RULE, LECTURE_SIGN_IN_RULES, RATE_LIMIT_POLICIES } from './rate-limit-policies.js';

/**
 * Renders the rate-limit table in docs/API.md from the policy table, so the
 * documentation cannot drift from what the API enforces. A test compares the
 * two; `pnpm --filter @lasuatos/api docs:rate-limits` rewrites the block.
 */

export const RATE_LIMIT_DOCS_START = '<!-- rate-limits:start (generated from apps/api/src/security/rate-limit-policies.ts; run pnpm --filter @lasuatos/api docs:rate-limits) -->';
export const RATE_LIMIT_DOCS_END = '<!-- rate-limits:end -->';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

const SUBJECT_LABELS: Readonly<Record<string, string>> = {
  ip: 'address',
  email: 'email',
  session: 'session',
  matric: 'matric number',
  account: 'account',
};

interface Limit {
  readonly subject: string;
  readonly limit: number;
  readonly windowMilliseconds: number;
}

function windowLabel(milliseconds: number): string {
  if (milliseconds === HOUR) return 'hour';
  if (milliseconds % HOUR === 0) return `${milliseconds / HOUR} hours`;
  if (milliseconds % MINUTE === 0) return `${milliseconds / MINUTE} minutes`;
  return `${milliseconds / 1000} seconds`;
}

function count(value: number): string {
  return value.toLocaleString('en-US');
}

/** "600 per address and 10 per email, per 15 minutes", or one "per window" each when windows differ. */
export function describeLimits(limits: readonly Limit[]): string {
  if (limits.length === 0) return 'none';
  const parts = limits.map((limit) => `${count(limit.limit)} per ${SUBJECT_LABELS[limit.subject] ?? limit.subject}`);
  const windows = new Set(limits.map((limit) => limit.windowMilliseconds));
  if (windows.size === 1) {
    const window = windowLabel(limits[0]!.windowMilliseconds);
    return limits.length === 1 ? `${parts[0]} per ${window}` : `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}, per ${window}`;
  }
  return limits.map((limit, index) => `${parts[index]} per ${windowLabel(limit.windowMilliseconds)}`).join('; ');
}

/** `POST /api/v1/lecture/sessions/:sessionId` → `POST /lecture/sessions/{sessionId}` */
export function documentedRoute(policyKey: string): string {
  const [method, path = ''] = policyKey.split(' ');
  return `${method} ${path.replace(/^\/api\/v1/, '').replace(/:([A-Za-z]+)/g, '{$1}')}`;
}

export function rateLimitTableMarkdown(): string {
  const rows = Object.entries(RATE_LIMIT_POLICIES).map(([key, limits]) => `| \`${documentedRoute(key)}\` | ${describeLimits(limits)} |`);
  rows.push(
    `| \`${documentedRoute('POST /api/v1/lecture/resolve')}\`, wrong typed codes only | ${describeLimits([{ subject: 'ip', limit: LECTURE_CODE_MISS_RULE.limit, windowMilliseconds: LECTURE_CODE_MISS_RULE.windowMilliseconds }])} |`,
    `| \`${documentedRoute('POST /api/v1/lecture/check-in')}\` with \`signIn\` (a classmate signs in on this phone) | ${describeLimits([
      { subject: 'ip', limit: LECTURE_SIGN_IN_RULES.ip.limit, windowMilliseconds: LECTURE_SIGN_IN_RULES.ip.windowMilliseconds },
      { subject: 'account', limit: LECTURE_SIGN_IN_RULES.identifier.limit, windowMilliseconds: LECTURE_SIGN_IN_RULES.identifier.windowMilliseconds },
    ])} |`,
  );
  return ['| Route | Limits |', '| --- | --- |', ...rows].join('\n');
}

/** The block between the markers in docs/API.md, or null when the markers are missing. */
export function extractRateLimitBlock(markdown: string): string | null {
  const start = markdown.indexOf(RATE_LIMIT_DOCS_START);
  const end = markdown.indexOf(RATE_LIMIT_DOCS_END);
  if (start === -1 || end === -1 || end < start) return null;
  return markdown.slice(start + RATE_LIMIT_DOCS_START.length, end).trim();
}

export function replaceRateLimitBlock(markdown: string): string {
  const start = markdown.indexOf(RATE_LIMIT_DOCS_START);
  const end = markdown.indexOf(RATE_LIMIT_DOCS_END);
  if (start === -1 || end === -1 || end < start) throw new Error('docs/API.md has no rate-limit markers.');
  return `${markdown.slice(0, start + RATE_LIMIT_DOCS_START.length)}\n${rateLimitTableMarkdown()}\n${markdown.slice(end)}`;
}
