import { createHash, createPublicKey, verify as verifySignature, type JsonWebKey, type KeyObject } from 'node:crypto';
import { GOOGLE_PROOF_MAX_AGE_SECONDS, type GoogleProofPurpose } from '@lasuatos/contracts';

/**
 * Checks a Google ID token: the signed statement Google returns after a
 * student picks their account on Google's own page (OpenID Connect, implicit
 * flow, scope `openid email`). Only basic sign-in information is asked for, so
 * no Gmail access exists and Google's restricted-scope review does not apply.
 *
 * Checked, in order: the shape, Google's RS256 signature (keys from
 * GOOGLE_CERTS_URL, cached as long as Google says), the issuer, the audience
 * (our client ID), expiry, freshness (signed in the last 15 minutes), the
 * nonce (bound to one purpose and to the browser that started it), and that
 * Google has verified the address. No library: Node's crypto does it all.
 */

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
/** Clock difference allowed between Google and this server. */
const SKEW_SECONDS = 60;
/** Fallback key lifetime when Google's answer has no max-age. */
const DEFAULT_KEY_SECONDS = 60 * 60;
/** An unknown key id refetches at most this often (a forged kid cannot hammer Google). */
const REFETCH_SECONDS = 60;

export type GoogleProofFailure =
  | 'malformed'
  | 'keys_unavailable'
  | 'signature'
  | 'issuer'
  | 'audience'
  | 'expired'
  | 'stale'
  | 'nonce'
  | 'unverified_email';

export class GoogleProofError extends Error {
  constructor(readonly reason: GoogleProofFailure, message: string) {
    super(message);
    this.name = 'GoogleProofError';
  }
}

export interface GoogleIdentity {
  /** Lower case. */
  readonly email: string;
  /** The Google Workspace domain (`hd`), e.g. st.lasu.edu.ng; null for a personal Google account. */
  readonly hostedDomain: string | null;
  /** Google's stable account id. */
  readonly subject: string;
}

export interface GoogleIdTokenVerifier {
  verify(credential: string, nonce: string, purpose: GoogleProofPurpose): Promise<GoogleIdentity>;
}

const base64url = (value: Buffer) => value.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

/**
 * What the browser sends Google as `nonce`: the digest of the purpose and its
 * raw nonce. The web computes the same (lib/google-proof.ts).
 */
export function googleNonceFor(rawNonce: string, purpose: GoogleProofPurpose): string {
  return base64url(createHash('sha256').update(`${purpose}:${rawNonce}`).digest());
}

function decodePart(part: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // Reported below.
  }
  throw new GoogleProofError('malformed', 'Google’s answer could not be read.');
}

type GoogleKey = JsonWebKey & { kid?: string; alg?: string; use?: string };

export function createGoogleIdTokenVerifier(options: {
  readonly clientId: string;
  readonly fetch?: typeof fetch;
  readonly now?: () => Date;
  readonly certsUrl?: string;
}): GoogleIdTokenVerifier {
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const certsUrl = options.certsUrl ?? GOOGLE_CERTS_URL;
  let keys = new Map<string, KeyObject>();
  let keysUntil = 0;
  let fetchedAt = 0;
  let pending: Promise<void> | null = null;

  async function refresh(): Promise<void> {
    const response = await fetcher(certsUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(5_000) });
    if (!response.ok) throw new Error(`Google keys answered ${response.status}`);
    const body = (await response.json()) as { keys?: GoogleKey[] };
    const next = new Map<string, KeyObject>();
    for (const key of body.keys ?? []) {
      if (!key.kid || key.kty !== 'RSA' || (key.alg && key.alg !== 'RS256')) continue;
      next.set(key.kid, createPublicKey({ key, format: 'jwk' }));
    }
    if (next.size === 0) throw new Error('Google keys were empty');
    const maxAge = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')?.[1];
    const fetched = now().getTime();
    keys = next;
    fetchedAt = fetched;
    keysUntil = fetched + (maxAge ? Number(maxAge) : DEFAULT_KEY_SECONDS) * 1000;
  }

  async function keyFor(kid: string): Promise<KeyObject> {
    const at = now().getTime();
    const stale = at >= keysUntil;
    const unknown = !keys.has(kid) && at - fetchedAt >= REFETCH_SECONDS * 1000;
    if (stale || unknown) {
      pending ??= refresh().finally(() => { pending = null; });
      try {
        await pending;
      } catch {
        // Keys we already hold still work if Google is briefly unreachable.
        if (!keys.has(kid)) throw new GoogleProofError('keys_unavailable', 'Google could not be reached to check the sign-in. Try again in a minute.');
      }
    }
    const key = keys.get(kid);
    if (!key) throw new GoogleProofError('signature', 'Google’s answer was not signed by Google.');
    return key;
  }

  return {
    async verify(credential, nonce, purpose) {
      const parts = credential.split('.');
      if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) {
        throw new GoogleProofError('malformed', 'Google’s answer could not be read.');
      }
      const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
      const header = decodePart(headerPart);
      if (header.alg !== 'RS256' || typeof header.kid !== 'string') throw new GoogleProofError('malformed', 'Google’s answer could not be read.');
      const payload = decodePart(payloadPart);

      const key = await keyFor(header.kid);
      const signed = verifySignature('RSA-SHA256', Buffer.from(`${headerPart}.${payloadPart}`), key, Buffer.from(signaturePart, 'base64url'));
      if (!signed) throw new GoogleProofError('signature', 'Google’s answer was not signed by Google.');

      if (typeof payload.iss !== 'string' || !ISSUERS.has(payload.iss)) throw new GoogleProofError('issuer', 'Google’s answer was not from Google.');
      const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
      if (!audience.includes(options.clientId)) throw new GoogleProofError('audience', 'That Google sign-in was for another app.');

      const seconds = Math.floor(now().getTime() / 1000);
      const exp = typeof payload.exp === 'number' ? payload.exp : 0;
      const iat = typeof payload.iat === 'number' ? payload.iat : 0;
      if (exp + SKEW_SECONDS <= seconds) throw new GoogleProofError('expired', 'That Google sign-in has expired. Sign in with Google again.');
      if (iat - SKEW_SECONDS > seconds || seconds - iat > GOOGLE_PROOF_MAX_AGE_SECONDS) {
        throw new GoogleProofError('stale', 'That Google sign-in is too old. Sign in with Google again.');
      }
      if (payload.nonce !== googleNonceFor(nonce, purpose)) {
        throw new GoogleProofError('nonce', 'That Google sign-in was started for something else, or on another device. Sign in with Google again.');
      }

      const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
      if (!email || payload.email_verified !== true) {
        throw new GoogleProofError('unverified_email', 'Google has not confirmed the email on that account.');
      }
      const subject = typeof payload.sub === 'string' ? payload.sub : '';
      if (!subject) throw new GoogleProofError('malformed', 'Google’s answer could not be read.');
      const hostedDomain = typeof payload.hd === 'string' && payload.hd ? payload.hd.toLowerCase() : null;
      return { email, hostedDomain, subject };
    },
  };
}
