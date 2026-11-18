import { RETENTION_DEFAULTS } from '@lasuatos/contracts';
import { z } from 'zod';

const optionalDatabaseUrl = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().url().optional(),
);

const optionalEnvironmentValue = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
  z.string().trim().min(1).optional(),
);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().trim().min(1).default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(1).max(65_535).default(4_000),
  API_INTERNAL_URL: z.string().url().default('http://127.0.0.1:4000'),
  PUBLIC_APP_URL: z.string().url().default('http://localhost:3000'),
  SELF_REGISTRATION_INSTITUTION_SLUG: z.string().trim().min(1).max(80).default('lasu'),
  /**
   * `required` (default): students register their face when they open their
   * account and every check-in confirms it. `off`: no face checks (for a
   * deployment that cannot run the face models).
   */
  FACE_CHECK: z.enum(['required', 'off']).default('required'),
  /**
   * How long a face check may wait for its turn on one server instance before
   * the phone is told to try again (503 + Retry-After). Keep it well under the
   * platform's function time limit (30 s for /api/v1 on Vercel).
   */
  FACE_QUEUE_BUDGET_MS: z.coerce.number().int().min(1_000).max(25_000).default(15_000),
  /**
   * Data retention (see docs/FACE_VERIFICATION.md). A set's registered faces
   * are deleted this many months after its final session ends (1 September
   * after the final year), unless the student checked in to a lecture in the
   * last RETENTION_ACTIVE_DAYS (still studying: an extra year or carry-overs).
   * Check-in photos kept for review are deleted after RETENTION_CHECK_PHOTO_DAYS.
   */
  RETENTION_GRACE_MONTHS: z.coerce.number().int().min(0).max(120).default(RETENTION_DEFAULTS.graceMonths),
  RETENTION_ACTIVE_DAYS: z.coerce.number().int().min(0).max(3650).default(RETENTION_DEFAULTS.activeWithinDays),
  RETENTION_CHECK_PHOTO_DAYS: z.coerce.number().int().min(1).max(3650).default(RETENTION_DEFAULTS.checkPhotoDays),
  /** Shared secret Vercel Cron sends (Authorization: Bearer …) to run retention daily. Unset: no scheduled run. */
  CRON_SECRET: optionalEnvironmentValue,
  /**
   * `class_list` (default): students open accounts only from the class list
   * their HOC uploaded. `open`: the old form where students type their own
   * details is also available (development only).
   */
  STUDENT_SIGN_UP: z.enum(['class_list', 'open']).default('class_list'),
  DATABASE_URL: optionalDatabaseUrl,
  /** Connections per process; defaults to 10 (3 in the serverless /api/v1 function). */
  DATABASE_POOL_MAX: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.coerce.number().int().min(1).max(50).optional(),
  ),
  /** Neon and other scale-to-zero databases can take a few seconds to wake. */
  DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(60_000).default(10_000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  EMAIL_PROVIDER: z.enum(['none', 'mailpit', 'gmail', 'brevo', 'resend']).default('none'),
  EMAIL_FROM_ADDRESS: optionalEnvironmentValue,
  EMAIL_FROM_NAME: optionalEnvironmentValue.default('LASUATOS'),
  MAILPIT_HOST: z.string().trim().min(1).default('127.0.0.1'),
  MAILPIT_PORT: z.coerce.number().int().min(1).max(65_535).default(1_025),
  GMAIL_USER: optionalEnvironmentValue,
  GMAIL_APP_PASSWORD: optionalEnvironmentValue,
  GMAIL_CLIENT_ID: optionalEnvironmentValue,
  GMAIL_CLIENT_SECRET: optionalEnvironmentValue,
  GMAIL_REFRESH_TOKEN: optionalEnvironmentValue,
  BREVO_API_KEY: optionalEnvironmentValue,
  RESEND_API_KEY: optionalEnvironmentValue,
  /**
   * Providers that take over, in order, when EMAIL_PROVIDER refuses or has used its
   * daily limit (ADR 029). `auto` (default): every other provider whose credentials
   * are set (Brevo, then Gmail, then Resend; Resend only with a sender on your own
   * domain). `none`: no failover. Or a list such as `gmail,resend`.
   */
  EMAIL_FALLBACK_PROVIDERS: z.string().trim().toLowerCase().default('auto'),
  /** Overrides the free-plan daily limits (brevo:300, resend:100, gmail:500), e.g. `brevo:300,gmail:450`; `none` for no limit. */
  EMAIL_DAILY_LIMITS: z.string().trim().default(''),
  /**
   * "Continue with Google" in place of the emailed code (ADR 027): the OAuth
   * client ID of a Google Cloud "Web application" client whose authorised
   * redirect URI is PUBLIC_APP_URL + /auth/google. No secret is needed. Unset:
   * students use emailed codes only.
   */
  GOOGLE_CLIENT_ID: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.string().trim()
      .regex(/^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/, 'GOOGLE_CLIENT_ID is the client ID (it ends in .apps.googleusercontent.com), not the client secret.')
      .optional(),
  ),
  /**
   * LASU mail (ADR 030): students read their LASU inbox inside LASUATOS, read-only,
   * straight from Google to their browser. Needs GOOGLE_CLIENT_ID and LASU's Google
   * Workspace administrator to trust that client. `off` (default), `pilot` (only the
   * addresses in LASU_MAIL_PILOT, to try it before everyone) or `on`.
   */
  LASU_MAIL: z.enum(['off', 'pilot', 'on']).default('off'),
  /** Comma-separated account emails that see LASU mail while LASU_MAIL=pilot. */
  LASU_MAIL_PILOT: z.string().trim().toLowerCase().default(''),
  /** Email domains whose mailboxes are on Google and may be opened (comma separated). */
  LASU_MAIL_DOMAINS: z.string().trim().toLowerCase().default('st.lasu.edu.ng'),
  /**
   * Which peers may set X-Forwarded-For. `loopback` fits the default topology
   * (Next.js rewrites on the same host); behind a load balancer list its
   * addresses/CIDRs (comma separated). `false` trusts no proxy.
   */
  TRUST_PROXY: z.string().trim().min(1).default('loopback'),
  /** Rate-limit counter store; `memory` is per-process and only for single-instance or tests. */
  RATE_LIMIT_STORE: z.enum(['postgres', 'memory', 'off']).default('postgres'),
  /** Extra origins (comma separated) allowed to send state-changing requests, besides PUBLIC_APP_URL. */
  TRUSTED_ORIGINS: z.string().trim().default(''),
  /**
   * The independent status page (ADR 034), e.g. https://lasuatos-status.<account>.workers.dev.
   * Its incident and maintenance notices are shown as a banner in the app, and Help links to it.
   * Unset: no banner, and /status opens Help instead.
   */
  STATUS_PAGE_URL: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    z.url({ protocol: /^https?$/ }).optional(),
  ),
  /**
   * Nightly database backups (ADR 035, docs/BACKUPS.md): the repository, as owner/name, whose
   * .github/workflows/backup.yml on main may report backups to POST /api/v1/ops/backups.
   * Set: System health shows backups and an email goes out when one fails or none arrives for
   * 30 hours. Unset: backups are shown as not set up and reports are refused.
   */
  BACKUP_SOURCE_REPOSITORY: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value),
    z.string().regex(/^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/, 'Use owner/name, e.g. ctrotech-tutor/LASUATOS.').optional(),
  ),
  /**
   * Who is emailed when something breaks (server errors, page crashes, database
   * behind the code). Comma separated; empty means alerts are only logged.
   */
  ALERT_EMAIL: z.preprocess(
    (value) => (typeof value === 'string' ? value.split(',').map((item) => item.trim()).filter(Boolean) : []),
    z.array(z.email().max(320)).max(10),
  ),
}).superRefine((environment, context) => {
  let publicAppUrl: URL | undefined;
  try {
    publicAppUrl = new URL(environment.PUBLIC_APP_URL);
  } catch {
    // The base Zod URL check reports invalid URLs.
  }

  if (
    publicAppUrl &&
    (publicAppUrl.protocol !== 'https:' && publicAppUrl.protocol !== 'http:' ||
      publicAppUrl.username !== '' || publicAppUrl.password !== '' ||
      publicAppUrl.search !== '' || publicAppUrl.hash !== '')
  ) {
    context.addIssue({
      code: 'custom',
      path: ['PUBLIC_APP_URL'],
      message: 'Use an HTTP or HTTPS application origin without credentials, query or fragment.',
    });
  }

  if (environment.NODE_ENV === 'production' && publicAppUrl?.protocol !== 'https:') {
    context.addIssue({
      code: 'custom',
      path: ['PUBLIC_APP_URL'],
      message: 'Production email links require an HTTPS application URL.',
    });
  }

  if (environment.NODE_ENV === 'production' && environment.RATE_LIMIT_STORE === 'off') {
    context.addIssue({
      code: 'custom',
      path: ['RATE_LIMIT_STORE'],
      message: 'Rate limiting cannot be disabled in production.',
    });
  }

  for (const origin of splitList(environment.TRUSTED_ORIGINS)) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(origin);
    } catch {
      // reported below
    }
    if (!parsed || (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') || parsed.origin !== origin.replace(/\/$/, '')) {
      context.addIssue({
        code: 'custom',
        path: ['TRUSTED_ORIGINS'],
        message: `TRUSTED_ORIGINS entries must be bare origins such as https://attendance.example.edu (got "${origin.slice(0, 80)}").`,
      });
    }
  }

  if (
    environment.EMAIL_FROM_ADDRESS &&
    !z.email().safeParse(environment.EMAIL_FROM_ADDRESS).success
  ) {
    context.addIssue({
      code: 'custom',
      path: ['EMAIL_FROM_ADDRESS'],
      message: 'EMAIL_FROM_ADDRESS must be a valid email address.',
    });
  }

  if (environment.EMAIL_PROVIDER === 'mailpit') {
    if (environment.NODE_ENV === 'production') {
      context.addIssue({
        code: 'custom',
        path: ['EMAIL_PROVIDER'],
        message: 'Mailpit is only available in development or test environments.',
      });
    }
    if (!['localhost', '127.0.0.1', '::1'].includes(environment.MAILPIT_HOST.toLowerCase())) {
      context.addIssue({
        code: 'custom',
        path: ['MAILPIT_HOST'],
        message: 'Mailpit SMTP must use a loopback host; remote SMTP hosts are not allowed for local capture.',
      });
    }
    if (!environment.EMAIL_FROM_ADDRESS) {
      context.addIssue({
        code: 'custom',
        path: ['EMAIL_FROM_ADDRESS'],
        message: 'A sender address is required for the local Mailpit adapter.',
      });
    }
  }

  if (environment.EMAIL_PROVIDER === 'gmail') {
    if (!environment.GMAIL_USER) {
      context.addIssue({
        code: 'custom',
        path: ['GMAIL_USER'],
        message: 'GMAIL_USER is required when EMAIL_PROVIDER is gmail.',
      });
    }

    const oauthCredentials = [
      environment.GMAIL_CLIENT_ID,
      environment.GMAIL_CLIENT_SECRET,
      environment.GMAIL_REFRESH_TOKEN,
    ];
    const suppliedOAuthCredentials = oauthCredentials.filter(Boolean).length;
    if (suppliedOAuthCredentials > 0 && suppliedOAuthCredentials < oauthCredentials.length) {
      context.addIssue({
        code: 'custom',
        path: ['GMAIL_CLIENT_ID'],
        message: 'Configure all Gmail OAuth2 values or none of them.',
      });
    }
    if (suppliedOAuthCredentials === 0 && !environment.GMAIL_APP_PASSWORD) {
      context.addIssue({
        code: 'custom',
        path: ['GMAIL_APP_PASSWORD'],
        message: 'Configure Gmail OAuth2 credentials or an eligible Google App Password.',
      });
    }
  }

  if (environment.EMAIL_PROVIDER === 'brevo' && !environment.BREVO_API_KEY) {
    context.addIssue({
      code: 'custom',
      path: ['BREVO_API_KEY'],
      message: 'BREVO_API_KEY is required when EMAIL_PROVIDER is brevo.',
    });
  }

  if (environment.EMAIL_PROVIDER === 'resend' && !environment.RESEND_API_KEY) {
    context.addIssue({
      code: 'custom',
      path: ['RESEND_API_KEY'],
      message: 'RESEND_API_KEY is required when EMAIL_PROVIDER is resend.',
    });
  }

  const fallbacks = environment.EMAIL_FALLBACK_PROVIDERS;
  if (fallbacks !== 'auto' && fallbacks !== 'none') {
    const seen = new Set<string>();
    for (const entry of splitList(fallbacks)) {
      if (!FALLBACK_PROVIDERS.includes(entry as FallbackProvider)) {
        context.addIssue({ code: 'custom', path: ['EMAIL_FALLBACK_PROVIDERS'], message: `EMAIL_FALLBACK_PROVIDERS takes auto, none, or a list of brevo, gmail and resend (got "${entry.slice(0, 40)}").` });
        continue;
      }
      if (entry === environment.EMAIL_PROVIDER || seen.has(entry)) {
        context.addIssue({ code: 'custom', path: ['EMAIL_FALLBACK_PROVIDERS'], message: `${entry} is listed twice (EMAIL_PROVIDER is always tried first).` });
      } else if (!providerConfigured(environment, entry as FallbackProvider)) {
        context.addIssue({ code: 'custom', path: ['EMAIL_FALLBACK_PROVIDERS'], message: `${entry} is a fallback provider but its credentials are not set (${PROVIDER_NEEDS[entry as FallbackProvider]}).` });
      }
      seen.add(entry);
    }
  }

  for (const entry of splitList(environment.EMAIL_DAILY_LIMITS)) {
    if (!/^(brevo|gmail|resend|mailpit)\s*[:=]\s*(\d{1,7}|none)$/i.test(entry)) {
      context.addIssue({ code: 'custom', path: ['EMAIL_DAILY_LIMITS'], message: `EMAIL_DAILY_LIMITS entries look like brevo:300 (got "${entry.slice(0, 40)}").` });
    }
  }

  if (
    (environment.EMAIL_PROVIDER === 'brevo' || environment.EMAIL_PROVIDER === 'resend') &&
    (!environment.EMAIL_FROM_ADDRESS || !z.email().safeParse(environment.EMAIL_FROM_ADDRESS).success)
  ) {
    context.addIssue({
      code: 'custom',
      path: ['EMAIL_FROM_ADDRESS'],
      message: 'A valid verified sender address is required for this email provider.',
    });
  }
});

export type Environment = z.infer<typeof environmentSchema>;

const FALLBACK_PROVIDERS = ['brevo', 'gmail', 'resend'] as const;
type FallbackProvider = (typeof FALLBACK_PROVIDERS)[number];
type EmailProviderName = Exclude<Environment['EMAIL_PROVIDER'], 'none'>;

const PROVIDER_NEEDS: Readonly<Record<FallbackProvider, string>> = {
  brevo: 'BREVO_API_KEY and EMAIL_FROM_ADDRESS',
  gmail: 'GMAIL_USER and GMAIL_APP_PASSWORD',
  resend: 'RESEND_API_KEY and EMAIL_FROM_ADDRESS',
};

/** Free mail domains: Resend only sends from a domain you verified, which these never are. */
const FREE_MAIL_DOMAIN = /@(?:gmail|googlemail|yahoo|ymail|outlook|hotmail|live|icloud|aol|proton|protonmail)\.[a-z.]+$/i;

type ProviderSettings = Pick<Environment, 'BREVO_API_KEY' | 'RESEND_API_KEY' | 'EMAIL_FROM_ADDRESS' | 'GMAIL_USER' | 'GMAIL_APP_PASSWORD' | 'GMAIL_CLIENT_ID' | 'GMAIL_CLIENT_SECRET' | 'GMAIL_REFRESH_TOKEN'>;

function providerConfigured(environment: ProviderSettings, provider: FallbackProvider): boolean {
  switch (provider) {
    case 'brevo':
      return Boolean(environment.BREVO_API_KEY && environment.EMAIL_FROM_ADDRESS);
    case 'resend':
      return Boolean(environment.RESEND_API_KEY && environment.EMAIL_FROM_ADDRESS);
    case 'gmail':
      return Boolean(environment.GMAIL_USER && (environment.GMAIL_APP_PASSWORD || (environment.GMAIL_CLIENT_ID && environment.GMAIL_CLIENT_SECRET && environment.GMAIL_REFRESH_TOKEN)));
  }
}

/**
 * The providers email is sent through, in order: EMAIL_PROVIDER, then the fallbacks
 * (ADR 029). Empty when EMAIL_PROVIDER is "none". Mailpit (local capture) never gets
 * fallbacks, so development never emails real inboxes by surprise.
 */
export function emailProviderOrder(environment: Environment): EmailProviderName[] {
  const primary = environment.EMAIL_PROVIDER;
  if (primary === 'none') return [];
  if (primary === 'mailpit') return ['mailpit'];
  const setting = environment.EMAIL_FALLBACK_PROVIDERS;
  if (setting === 'none') return [primary];
  const fallbacks = setting === 'auto'
    ? FALLBACK_PROVIDERS.filter((provider) => (
        provider !== primary &&
        providerConfigured(environment, provider) &&
        !(provider === 'resend' && FREE_MAIL_DOMAIN.test(environment.EMAIL_FROM_ADDRESS ?? ''))
      ))
    : splitList(setting).filter((provider): provider is FallbackProvider => FALLBACK_PROVIDERS.includes(provider as FallbackProvider) && provider !== primary);
  return [primary, ...new Set(fallbacks)];
}

export function splitList(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

/** Converts TRUST_PROXY into Fastify's `trustProxy` option. */
export function parseTrustProxy(value: string): boolean | string[] {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  return splitList(value);
}

/**
 * On Vercel, PUBLIC_APP_URL falls back to the project's production domain
 * (VERCEL_PROJECT_PRODUCTION_URL, set by the platform), so email links and the
 * origin check work even if the variable was not added by hand.
 */
export function withPlatformDefaults(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const vercelHost = source.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (source.PUBLIC_APP_URL?.trim() || !vercelHost) return source;
  return { ...source, PUBLIC_APP_URL: `https://${vercelHost.replace(/^https?:\/\//, '').replace(/\/+$/, '')}` };
}

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  return environmentSchema.parse(withPlatformDefaults(source));
}

/** Configuration that is valid but leaves part of the product unusable; logged once at startup. */
export function environmentWarnings(environment: Environment): string[] {
  const warnings: string[] = [];
  if (environment.NODE_ENV === 'production' && environment.EMAIL_PROVIDER === 'none') {
    warnings.push('EMAIL_PROVIDER is "none": students cannot verify their email, nobody can reset a password, and staff invitations are not delivered. Configure brevo (free), gmail or resend.');
  }
  const order = emailProviderOrder(environment);
  if (environment.NODE_ENV === 'production' && order.length === 1 && order[0] !== 'mailpit' && environment.EMAIL_FALLBACK_PROVIDERS === 'auto') {
    warnings.push(`Only one email provider (${order[0]}) is set up, so when its daily limit is used up students get no codes until it resets. Add a fallback, for example GMAIL_USER and GMAIL_APP_PASSWORD (see docs/DEPLOYMENT.md), or set EMAIL_FALLBACK_PROVIDERS=none to silence this.`);
  }
  if (order.includes('resend') && FREE_MAIL_DOMAIN.test(environment.EMAIL_FROM_ADDRESS ?? '')) {
    warnings.push('Resend only sends from a domain you verified, and EMAIL_FROM_ADDRESS is a free mail address, so every Resend send will be refused. Use an address on your own domain, or remove resend from EMAIL_FALLBACK_PROVIDERS.');
  }
  if (environment.LASU_MAIL !== 'off' && !environment.GOOGLE_CLIENT_ID) {
    warnings.push(`LASU_MAIL is "${environment.LASU_MAIL}" but GOOGLE_CLIENT_ID is not set, so LASU mail stays hidden. Set up Continue with Google first (docs/DEPLOYMENT.md).`);
  }
  if (environment.LASU_MAIL === 'pilot' && splitList(environment.LASU_MAIL_PILOT).length === 0) {
    warnings.push('LASU_MAIL is "pilot" but LASU_MAIL_PILOT lists nobody, so nobody sees LASU mail.');
  }
  if (environment.NODE_ENV === 'production' && !environment.DATABASE_URL) {
    warnings.push('DATABASE_URL is not set: only /api/v1/health works until it is configured.');
  }
  return warnings;
}
