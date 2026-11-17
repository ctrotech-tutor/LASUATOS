import type { LasuMailConfig } from '@lasuatos/contracts';
import type { AuthenticatedAccount } from '../auth/repository.js';

/**
 * LASU mail (ADR 030). The server only decides who may see the feature and hands
 * the browser what it needs to ask Google; the mailbox itself goes from Google
 * straight to the student's browser and never passes through, or is stored by,
 * LASUATOS.
 */

export interface LasuMailSettings {
  readonly mode: 'off' | 'pilot' | 'on';
  /** Lower-case account emails that see it in `pilot`. */
  readonly pilot: readonly string[];
  /** Lower-case domains whose mailboxes are on Google Workspace. */
  readonly domains: readonly string[];
  readonly google?: { readonly clientId: string; readonly redirectUri: string } | undefined;
}

export function lasuMailConfig(account: Pick<AuthenticatedAccount, 'email'> & { readonly emailVerified?: boolean }, settings: LasuMailSettings): LasuMailConfig {
  const email = account.email.trim().toLowerCase();
  const domain = email.slice(email.lastIndexOf('@') + 1);
  const closed = (status: LasuMailConfig['status']): LasuMailConfig => ({ status, email, clientId: null, redirectUri: null, hostedDomain: null });
  if (!settings.google) return closed('no_google');
  if (settings.mode === 'off' || (settings.mode === 'pilot' && !settings.pilot.includes(email))) return closed('off');
  // Only a confirmed address: the account's owner proved the mailbox is theirs.
  if (!settings.domains.includes(domain) || account.emailVerified === false) return closed('not_lasu');
  return { status: 'ready', email, clientId: settings.google.clientId, redirectUri: settings.google.redirectUri, hostedDomain: domain };
}
