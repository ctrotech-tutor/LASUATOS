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

/**
 * Who sees LASU mail, and what the browser needs to ask Google for it. Google's
 * own sign-in proves the mailbox belongs to whoever opens it, so the account's
 * email does not have to be the LASU address: a student registered with a
 * personal email picks their LASU account on Google's page instead.
 */
export function lasuMailConfig(account: Pick<AuthenticatedAccount, 'email'>, settings: LasuMailSettings): LasuMailConfig {
  const email = account.email.trim().toLowerCase();
  const domain = email.slice(email.lastIndexOf('@') + 1);
  const closed = (status: LasuMailConfig['status']): LasuMailConfig => ({ status, mailbox: null, domains: [], clientId: null, redirectUri: null, hostedDomain: null });
  if (!settings.google) return closed('no_google');
  if (settings.mode === 'off' || settings.domains.length === 0) return closed('off');
  if (settings.mode === 'pilot' && !settings.pilot.includes(email)) return closed('off');
  const own = settings.domains.includes(domain);
  return {
    status: 'ready',
    mailbox: own ? email : null,
    domains: [...settings.domains],
    clientId: settings.google.clientId,
    redirectUri: settings.google.redirectUri,
    hostedDomain: own ? domain : settings.domains[0]!,
  };
}
