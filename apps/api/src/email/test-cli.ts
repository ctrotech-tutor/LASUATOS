import { z } from 'zod';
import { emailProviderOrder, loadEnvironment } from '../env.js';
import { EMAIL_PROVIDER_LABELS, EmailProviderNameSchema, type EmailProviderName } from '@lasuatos/contracts';
import { createEmailTransport, emailFailureReason, sendTestEmail } from './transport.js';

const USAGE = 'Usage: pnpm prod:email:test --to you@example.com [--provider brevo|resend|gmail]   (or pnpm email:test --to … for the local .env)';

function parseProvider(argv: readonly string[]): EmailProviderName | undefined {
  const index = argv.indexOf('--provider');
  const inline = argv.find((argument) => argument.startsWith('--provider='));
  const value = inline ? inline.slice('--provider='.length) : index >= 0 ? argv[index + 1] : undefined;
  if (value === undefined) return undefined;
  const parsed = EmailProviderNameSchema.safeParse(value.trim().toLowerCase());
  if (!parsed.success) {
    console.error('--provider must be brevo, resend, gmail or mailpit.');
    console.error(USAGE);
    process.exit(2);
  }
  return parsed.data;
}

function parseRecipient(argv: readonly string[]): string {
  const index = argv.indexOf('--to');
  const inline = argv.find((argument) => argument.startsWith('--to='));
  const value = inline ? inline.slice('--to='.length) : index >= 0 ? argv[index + 1] : undefined;
  const parsed = z.email().safeParse(value?.trim());
  if (!parsed.success) throw new Error('Give the address to send the test to with --to.');
  return parsed.data;
}

let to: string;
try {
  to = parseRecipient(process.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  console.error(USAGE);
  process.exit(2);
}

const environment = loadEnvironment();
const order = emailProviderOrder(environment);
if (!order.length) {
  console.error('EMAIL_PROVIDER is "none", so LASUATOS sends no email. Set EMAIL_PROVIDER (for example brevo) first.');
  process.exit(2);
}

// Each provider in the failover order is tried on its own, so a broken backup
// is found now and not on the day Brevo runs out (ADR 029).
const only = parseProvider(process.argv.slice(2));
if (only && !order.includes(only)) {
  console.error(`${EMAIL_PROVIDER_LABELS[only]} is not in this setup's order (${order.join(' → ')}).`);
  process.exit(2);
}
const providers = only ? [only] : order;
console.log(`Email order: ${order.map((provider) => EMAIL_PROVIDER_LABELS[provider]).join(' → ')}`);

let failures = 0;
for (const provider of providers) {
  const transport = createEmailTransport(environment, globalThis.fetch, { only: provider });
  if (!transport) continue;
  const label = EMAIL_PROVIDER_LABELS[provider];
  const sender = provider === 'gmail' ? environment.GMAIL_USER ?? '(not set)' : environment.EMAIL_FROM_ADDRESS ?? '(not set)';
  console.log(`\n${label}: sending a test email from ${sender} to ${to} …`);
  try {
    await sendTestEmail(transport, to, label);
    console.log(`${label}: sent. The provider accepted the message.`);
    if (provider === 'brevo') {
      console.log('  This was sent from this computer. If it works here but not on the live site, turn off');
      console.log('  Brevo → Security → Authorised IPs blocking, because Vercel has no fixed IP address.');
    }
  } catch (error) {
    failures += 1;
    console.error(`${label}: not sent.`);
    console.error(`  ${emailFailureReason(error)}`);
  }
}

console.log(failures
  ? `\n${failures} of ${providers.length} not sent. Fix those before relying on them as a backup.`
  : '\nCheck that inbox, including the Spam folder, within a few minutes: one email per provider.');
if (failures) process.exitCode = 1;
