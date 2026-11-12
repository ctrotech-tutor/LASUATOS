import { z } from 'zod';
import { loadEnvironment } from '../env.js';
import { createEmailTransport, emailFailureReason, sendTestEmail } from './transport.js';

const USAGE = 'Usage: pnpm prod:email:test --to you@example.com   (or pnpm email:test --to … for the local .env)';

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
const provider = environment.EMAIL_PROVIDER;
const transport = createEmailTransport(environment);
if (!transport) {
  console.error('EMAIL_PROVIDER is "none", so LASUATOS sends no email. Set EMAIL_PROVIDER (for example brevo) first.');
  process.exit(2);
}

const sender = environment.EMAIL_FROM_ADDRESS ?? environment.GMAIL_USER ?? '(not set)';
console.log(`Sending a test email with ${provider} from ${sender} to ${to} …`);

try {
  await sendTestEmail(transport, to, provider);
  console.log('Sent: the provider accepted the message.');
  console.log('Check that inbox, including the Spam folder, within a few minutes.');
  if (provider === 'brevo') {
    console.log('This was sent from this computer. If it works here but not on the live site, turn off');
    console.log('Brevo → Security → Authorised IPs blocking, because Vercel has no fixed IP address.');
  }
} catch (error) {
  console.error('Not sent.');
  console.error(emailFailureReason(error));
  process.exitCode = 1;
}
