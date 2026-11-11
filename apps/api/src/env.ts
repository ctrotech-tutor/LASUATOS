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
  DATABASE_URL: optionalDatabaseUrl,
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

export function loadEnvironment(source: NodeJS.ProcessEnv = process.env): Environment {
  return environmentSchema.parse(source);
}
