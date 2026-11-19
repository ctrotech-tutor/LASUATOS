import { createOpaqueToken, hashOpaqueToken, verifyPasswordOrDummy } from '@lasuatos/auth';
import { PASSKEY_LIMIT, PASSKEY_UNKNOWN_PROBLEM } from '@lasuatos/contracts';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { emailFailureReason, type EmailTransport, type SecurityNoticeKind } from '../email/transport.js';
import { coarseBrowser } from '../monitoring/alerts.js';
import type { AuthRepository, AuthenticatedAccount } from './repository.js';
import { CurrentPasswordRejectedError, SESSION_TTL_MILLISECONDS, SessionRequiredError, type IssuedAccountSession, type SecurityEventLogger } from './service.js';

/**
 * Passkeys for staff sign-in (ADR 037).
 *
 * A passkey is a key pair made by the person's phone, computer, password manager
 * or security key. LASUATOS keeps only the public half; signing in means the
 * device signs a one-time challenge after the person unlocks it with their
 * fingerprint, face or screen lock. There is nothing to type, so nothing to
 * phish: a fake LASUATOS site gets a signature for its own address, which is
 * worthless here.
 *
 * Staff only: students often sign in on borrowed phones, and a passkey made
 * there would be saved to the phone owner's password manager. The password
 * stays as a fallback, and signing in with it on an account that has a passkey
 * emails a notice, so a phished password does not go unnoticed.
 */

export const PASSKEY_CHALLENGE_TTL_MILLISECONDS = 5 * 60_000;

export interface PasskeyRecord {
  readonly id: string;
  readonly userId: string;
  readonly credentialId: string;
  readonly publicKey: Uint8Array;
  readonly signCount: number;
  readonly transports: readonly string[];
  readonly backedUp: boolean;
  readonly aaguid: string | null;
  readonly name: string;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

export type ChallengePurpose = 'register' | 'sign_in';

export interface PasskeyRepository {
  list(userId: string): Promise<PasskeyRecord[]>;
  saveChallenge(input: { readonly challenge: string; readonly purpose: ChallengePurpose; readonly userId: string | null; readonly expiresAt: Date }): Promise<string>;
  /** Deletes and returns an unexpired challenge, so each can be answered once. */
  takeChallenge(id: string, purpose: ChallengePurpose, now: Date): Promise<{ readonly challenge: string; readonly userId: string | null } | null>;
  /** `limit`: the account already has `maxPerAccount`; `duplicate`: this passkey is already registered. */
  add(input: Omit<PasskeyRecord, 'id' | 'createdAt' | 'lastUsedAt'> & { readonly now: Date; readonly maxPerAccount: number }): Promise<PasskeyRecord | 'limit' | 'duplicate'>;
  findByCredentialId(credentialId: string): Promise<PasskeyRecord | null>;
  /** Saves the new signature count, only if it still matches what was read (two sign-ins at once cannot both pass). */
  recordUse(input: { readonly id: string; readonly previousSignCount: number; readonly signCount: number; readonly backedUp: boolean; readonly now: Date }): Promise<boolean>;
  rename(input: { readonly userId: string; readonly id: string; readonly name: string }): Promise<PasskeyRecord | null>;
  remove(input: { readonly userId: string; readonly id: string }): Promise<PasskeyRecord | null>;
}

export interface RelyingParty {
  /** The site's host name (lasuatos.vercel.app). Passkeys are bound to it. */
  readonly id: string;
  readonly name: string;
  /** Every page origin passkeys may be used from: the app's own address and trusted ones on the same host. */
  readonly origins: readonly string[];
}

/** Works out the relying party from the app's address: passkeys only work on that host and its subdomains. */
export function relyingPartyFor(publicAppUrl: string, trustedOrigins: readonly string[]): RelyingParty {
  const id = new URL(publicAppUrl).hostname;
  const origins = new Set<string>();
  for (const value of [publicAppUrl, ...trustedOrigins]) {
    try {
      const url = new URL(value);
      if (url.hostname === id || url.hostname.endsWith(`.${id}`)) origins.add(url.origin);
    } catch {
      // Configuration validation reports malformed origins.
    }
  }
  return { id, name: 'LASUATOS', origins: [...origins] };
}

/** Passkey problems with a plain next step. */
export class PasskeyError extends Error {
  readonly exposeDetail = true;

  constructor(readonly statusCode: 400 | 401 | 403 | 404 | 409 | 410, message: string, readonly problemType?: string) {
    super(message);
    this.name = 'PasskeyError';
  }
}

const STAFF_ONLY = 'Passkeys are for staff accounts. Students sign in with their matric number and password, or with Google.';
const EXPIRED = 'That took too long, so the request expired. Try again.';
const NOT_RECOGNISED = 'This passkey is not registered with LASUATOS any more (it may have been removed). Sign in with your password, then add a new one in Account security.';

/**
 * Friendly names for the password managers people actually use, from the
 * AAGUID the passkey reports. Anything else is named after the browser.
 */
const KNOWN_AUTHENTICATORS: Readonly<Record<string, string>> = {
  'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4': 'Google Password Manager',
  'fbfc3007-154e-4ecc-8c0b-6e020557d7bd': 'iCloud Keychain',
  'dd4ec289-e01d-41c9-bb89-70fa845d4bf2': 'iCloud Keychain',
  '08987058-cadc-4b81-b6e1-30de50dcbe96': 'Windows Hello',
  '9ddd1817-af5a-4672-a2b9-3e3dd95000a9': 'Windows Hello',
  '6028b017-b1d4-4c02-b4b3-afcdafc96bb2': 'Windows Hello',
  '53414d53-554e-4700-0000-000000000000': 'Samsung Pass',
  'bada5566-a7aa-401f-bd96-45619a55120d': '1Password',
  'd548826e-79b4-db40-a3d8-11116f7e8349': 'Bitwarden',
  '531126d6-e717-415c-9320-3d9aa6981239': 'Dashlane',
};

const EMPTY_AAGUID = '00000000-0000-0000-0000-000000000000';

export function defaultPasskeyName(aaguid: string | null, userAgent: string | undefined): string {
  const known = aaguid ? KNOWN_AUTHENTICATORS[aaguid.toLowerCase()] : undefined;
  if (known) return known;
  return userAgent ? `Passkey on ${coarseBrowser(userAgent)}`.slice(0, 60) : 'Passkey';
}

/** The WebAuthn user handle as base64url, as the browser reports it and the Signal API takes it. */
export function userHandleText(userId: string): string {
  return Buffer.from(userHandle(userId)).toString('base64url');
}

/** The account's id as the WebAuthn user handle: random, so it says nothing about the person. */
function userHandle(userId: string): Uint8Array<ArrayBuffer> {
  const hex = userId.replace(/-/g, '');
  const bytes = new Uint8Array(new ArrayBuffer(16));
  for (let index = 0; index < 16; index += 1) bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  return bytes;
}

export interface PasskeyServiceOptions {
  readonly repository: PasskeyRepository;
  readonly auth: Pick<AuthRepository, 'findSession' | 'findSessionPassword' | 'createSession'>;
  readonly relyingParty: RelyingParty;
  readonly emailTransport?: EmailTransport | undefined;
  readonly logger?: SecurityEventLogger | undefined;
  readonly now?: () => Date;
}

export class PasskeyService {
  readonly #repository: PasskeyRepository;
  readonly #auth: PasskeyServiceOptions['auth'];
  readonly #relyingParty: RelyingParty;
  readonly #emailTransport: EmailTransport | undefined;
  readonly #logger: SecurityEventLogger | undefined;
  readonly #now: () => Date;

  constructor(options: PasskeyServiceOptions) {
    this.#repository = options.repository;
    this.#auth = options.auth;
    this.#relyingParty = options.relyingParty;
    this.#emailTransport = options.emailTransport;
    this.#logger = options.logger;
    this.#now = options.now ?? (() => new Date());
  }

  async #staff(sessionToken: string): Promise<Exclude<AuthenticatedAccount, { accountType: 'student' }>> {
    const account = await this.#auth.findSession(hashOpaqueToken(sessionToken), this.#now());
    if (!account) throw new SessionRequiredError();
    if (account.accountType === 'student') throw new PasskeyError(403, STAFF_ONLY);
    return account;
  }

  /** The site passkeys are made for, e.g. lasuatos.vercel.app. */
  get relyingPartyId(): string {
    return this.#relyingParty.id;
  }

  async list(sessionToken: string): Promise<{ readonly userHandle: string; readonly passkeys: PasskeyRecord[] }> {
    const account = await this.#staff(sessionToken);
    return { userHandle: userHandleText(account.id), passkeys: await this.#repository.list(account.id) };
  }

  /**
   * Starts adding a passkey. The password is asked for again: a session cookie
   * alone (a browser left signed in) must not be enough to give someone a
   * permanent way in.
   */
  async registrationOptions(sessionToken: string, currentPassword: string): Promise<{ readonly challengeId: string; readonly options: PublicKeyCredentialCreationOptionsJSON }> {
    const now = this.#now();
    const account = await this.#staff(sessionToken);
    const record = await this.#auth.findSessionPassword(hashOpaqueToken(sessionToken), now);
    const matches = await verifyPasswordOrDummy(currentPassword, record?.passwordHash ?? null);
    if (!record) throw new SessionRequiredError();
    if (!matches) throw new CurrentPasswordRejectedError();
    const existing = await this.#repository.list(account.id);
    if (existing.length >= PASSKEY_LIMIT) {
      throw new PasskeyError(409, `You already have ${PASSKEY_LIMIT} passkeys. Remove one you no longer use, then add this one.`);
    }
    const options = await generateRegistrationOptions({
      rpName: this.#relyingParty.name,
      rpID: this.#relyingParty.id,
      userName: account.email,
      userDisplayName: account.displayName,
      userID: userHandle(account.id),
      timeout: PASSKEY_CHALLENGE_TTL_MILLISECONDS,
      attestationType: 'none',
      // The same device or password manager twice is refused by the browser itself.
      excludeCredentials: existing.map((passkey) => ({ id: passkey.credentialId, transports: [...passkey.transports] })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
      // ES256 (phones, password managers, most security keys) and RS256 (Windows Hello).
      supportedAlgorithmIDs: [-7, -257],
    });
    const challengeId = await this.#repository.saveChallenge({
      challenge: options.challenge,
      purpose: 'register',
      userId: account.id,
      expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MILLISECONDS),
    });
    return { challengeId, options };
  }

  async register(sessionToken: string, input: {
    readonly challengeId: string;
    readonly credential: RegistrationResponseJSON;
    readonly name?: string | undefined;
    readonly userAgent?: string | undefined;
  }): Promise<PasskeyRecord> {
    const now = this.#now();
    const account = await this.#staff(sessionToken);
    const challenge = await this.#repository.takeChallenge(input.challengeId, 'register', now);
    if (!challenge || challenge.userId !== account.id) throw new PasskeyError(410, EXPIRED);
    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: input.credential,
        expectedChallenge: challenge.challenge,
        expectedOrigin: [...this.#relyingParty.origins],
        expectedRPID: this.#relyingParty.id,
        requireUserVerification: true,
        supportedAlgorithmIDs: [-7, -257],
      });
    } catch (error) {
      this.#logger?.warn({ reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }, 'Passkey registration refused');
      throw new PasskeyError(400, 'Your device’s answer could not be checked, so the passkey was not added. Try again; if it keeps failing, try another browser.');
    }
    if (!verification.verified) throw new PasskeyError(400, 'Your device’s answer could not be checked, so the passkey was not added. Try again.');
    const info = verification.registrationInfo;
    const aaguid = info.aaguid && info.aaguid !== EMPTY_AAGUID ? info.aaguid : null;
    const added = await this.#repository.add({
      userId: account.id,
      credentialId: info.credential.id,
      publicKey: info.credential.publicKey,
      signCount: info.credential.counter,
      transports: (input.credential.response.transports ?? info.credential.transports ?? []).slice(0, 8),
      backedUp: info.credentialBackedUp,
      aaguid,
      name: input.name?.trim() || defaultPasskeyName(aaguid, input.userAgent),
      now,
      maxPerAccount: PASSKEY_LIMIT,
    });
    if (added === 'duplicate') throw new PasskeyError(409, 'This passkey is already registered with LASUATOS.');
    if (added === 'limit') throw new PasskeyError(409, `You already have ${PASSKEY_LIMIT} passkeys. Remove one you no longer use, then add this one.`);
    await this.#notify('passkey_added', account, now, added.name);
    return added;
  }

  async rename(sessionToken: string, id: string, name: string): Promise<PasskeyRecord> {
    const account = await this.#staff(sessionToken);
    const renamed = await this.#repository.rename({ userId: account.id, id, name: name.trim() });
    if (!renamed) throw new PasskeyError(404, 'That passkey was not found. It may have been removed already.');
    return renamed;
  }

  async remove(sessionToken: string, id: string): Promise<void> {
    const now = this.#now();
    const account = await this.#staff(sessionToken);
    const removed = await this.#repository.remove({ userId: account.id, id });
    if (!removed) throw new PasskeyError(404, 'That passkey was not found. It may have been removed already.');
    await this.#notify('passkey_removed', account, now, removed.name);
  }

  /**
   * Starts a passkey sign-in. No email is asked for: the browser offers the
   * passkeys it has for this site, so the answer says whose account it is.
   */
  async signInOptions(): Promise<{ readonly challengeId: string; readonly options: PublicKeyCredentialRequestOptionsJSON }> {
    const now = this.#now();
    const options = await generateAuthenticationOptions({
      rpID: this.#relyingParty.id,
      timeout: PASSKEY_CHALLENGE_TTL_MILLISECONDS,
      userVerification: 'required',
    });
    const challengeId = await this.#repository.saveChallenge({
      challenge: options.challenge,
      purpose: 'sign_in',
      userId: null,
      expiresAt: new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MILLISECONDS),
    });
    return { challengeId, options };
  }

  async signIn(input: { readonly challengeId: string; readonly credential: AuthenticationResponseJSON }): Promise<IssuedAccountSession> {
    const now = this.#now();
    const challenge = await this.#repository.takeChallenge(input.challengeId, 'sign_in', now);
    if (!challenge) throw new PasskeyError(410, EXPIRED);
    const passkey = await this.#repository.findByCredentialId(input.credential.id);
    if (!passkey) throw new PasskeyError(401, NOT_RECOGNISED, PASSKEY_UNKNOWN_PROBLEM);
    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: input.credential,
        expectedChallenge: challenge.challenge,
        expectedOrigin: [...this.#relyingParty.origins],
        expectedRPID: this.#relyingParty.id,
        requireUserVerification: true,
        credential: { id: passkey.credentialId, publicKey: new Uint8Array(passkey.publicKey), counter: passkey.signCount, transports: [...passkey.transports] },
      });
    } catch (error) {
      // Includes a signature count that went backwards: a sign of a cloned security key.
      this.#logger?.warn({ passkeyId: passkey.id, reason: error instanceof Error ? error.message.slice(0, 200) : 'unknown' }, 'Passkey sign-in refused');
      throw new PasskeyError(401, 'Your passkey’s answer could not be checked. Try again, or sign in with your password.');
    }
    if (!verification.verified) throw new PasskeyError(401, 'Your passkey’s answer could not be checked. Try again, or sign in with your password.');
    const saved = await this.#repository.recordUse({
      id: passkey.id,
      previousSignCount: passkey.signCount,
      signCount: verification.authenticationInfo.newCounter,
      backedUp: verification.authenticationInfo.credentialBackedUp,
      now,
    });
    if (!saved) throw new PasskeyError(401, 'Your passkey was used twice at once. Try again.');
    const token = createOpaqueToken();
    // createSession only signs in an active account, so a suspended staff member's passkeys stop working too.
    const account = await this.#auth.createSession(passkey.userId, hashOpaqueToken(token), now, new Date(now.getTime() + SESSION_TTL_MILLISECONDS));
    if (!account) throw new PasskeyError(403, 'This account is not active. Ask your administrator for help.');
    if (account.accountType === 'student') throw new PasskeyError(403, STAFF_ONLY);
    return { token, account };
  }

  async #notify(kind: SecurityNoticeKind, account: { readonly email: string; readonly displayName: string }, occurredAt: Date, passkeyName: string): Promise<void> {
    if (!this.#emailTransport) return;
    try {
      await this.#emailTransport.sendSecurityNotice({ to: account.email, displayName: account.displayName, kind, occurredAt, passkeyName });
    } catch (error) {
      this.#logger?.warn({ kind, reason: emailFailureReason(error) }, 'Security notice email could not be delivered');
    }
  }
}
