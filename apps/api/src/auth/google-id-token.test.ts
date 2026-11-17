import { generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createGoogleIdTokenVerifier, googleNonceFor, GoogleProofError, type GoogleProofFailure } from './google-id-token.js';

/**
 * Google's ID tokens are checked with Node's crypto alone. These tests sign
 * tokens with keys made here and serve them as "Google's keys", so every
 * rule is exercised without the network.
 */

const CLIENT_ID = '123456789012-abcdefghijklmnop.apps.googleusercontent.com';
const NOW = new Date('2026-11-10T09:00:00Z');
const seconds = Math.floor(NOW.getTime() / 1000);

function keyPair(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' } };
}

const googleKey = keyPair('google-1');
const otherKey = keyPair('google-2');

const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

function signToken(claims: Record<string, unknown>, key: { kid: string; privateKey: KeyObject } = googleKey, header: Record<string, unknown> = {}): string {
  const head = part({ alg: 'RS256', kid: key.kid, typ: 'JWT', ...header });
  const body = part(claims);
  const signature = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key.privateKey).toString('base64url');
  return `${head}.${body}.${signature}`;
}

const rawNonce = randomBytes(32).toString('base64url');

function claims(extra: Record<string, unknown> = {}) {
  return {
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '110248495921238986420',
    email: 'Ada.Obi@st.lasu.edu.ng',
    email_verified: true,
    hd: 'st.lasu.edu.ng',
    iat: seconds - 30,
    exp: seconds + 3570,
    nonce: googleNonceFor(rawNonce, 'open'),
    ...extra,
  };
}

function setup(options: { keys?: unknown[]; failing?: boolean; maxAge?: number } = {}) {
  let calls = 0;
  let clock = NOW;
  const fetcher = (async () => {
    calls += 1;
    if (options.failing) return new Response('down', { status: 503 });
    return new Response(JSON.stringify({ keys: options.keys ?? [googleKey.jwk] }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${options.maxAge ?? 21600}, must-revalidate` },
    });
  }) as typeof fetch;
  const verifier = createGoogleIdTokenVerifier({ clientId: CLIENT_ID, fetch: fetcher, now: () => clock });
  return {
    verifier,
    calls: () => calls,
    advance: (ms: number) => { clock = new Date(clock.getTime() + ms); },
  };
}

async function refusal(promise: Promise<unknown>): Promise<GoogleProofFailure> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GoogleProofError) return error.reason;
    throw error;
  }
  throw new Error('expected a refusal');
}

describe('Google ID tokens', () => {
  it('accepts a fresh token signed by Google for this app and purpose', async () => {
    const { verifier, calls } = setup();
    await expect(verifier.verify(signToken(claims()), rawNonce, 'open')).resolves.toEqual({
      email: 'ada.obi@st.lasu.edu.ng',
      hostedDomain: 'st.lasu.edu.ng',
      subject: '110248495921238986420',
    });
    // Google's keys are cached for as long as Google says.
    await verifier.verify(signToken(claims()), rawNonce, 'open');
    expect(calls()).toBe(1);
  });

  it('reads a personal Google account as having no hosted domain', async () => {
    const { verifier } = setup();
    const token = signToken(claims({ email: 'kunle@gmail.com', hd: undefined, iss: 'accounts.google.com' }));
    await expect(verifier.verify(token, rawNonce, 'open')).resolves.toMatchObject({ email: 'kunle@gmail.com', hostedDomain: null });
  });

  it('refuses tokens not signed by Google', async () => {
    const { verifier } = setup();
    // Signed by a key Google never published under that id.
    expect(await refusal(verifier.verify(signToken(claims(), { kid: 'google-1', privateKey: otherKey.privateKey }), rawNonce, 'open'))).toBe('signature');
    // A changed payload breaks the signature.
    const [head, , signature] = signToken(claims()).split('.');
    const forged = `${head}.${part(claims({ email: 'someone.else@st.lasu.edu.ng' }))}.${signature}`;
    expect(await refusal(verifier.verify(forged, rawNonce, 'open'))).toBe('signature');
    // "none" and HMAC tricks are refused before any key is used.
    expect(await refusal(verifier.verify(signToken(claims(), googleKey, { alg: 'none' }), rawNonce, 'open'))).toBe('malformed');
    expect(await refusal(verifier.verify(signToken(claims(), googleKey, { alg: 'HS256' }), rawNonce, 'open'))).toBe('malformed');
    expect(await refusal(verifier.verify('not.a.token!', rawNonce, 'open'))).toBe('malformed');
  });

  it('refuses another issuer or another app', async () => {
    const { verifier } = setup();
    expect(await refusal(verifier.verify(signToken(claims({ iss: 'https://evil.example' })), rawNonce, 'open'))).toBe('issuer');
    expect(await refusal(verifier.verify(signToken(claims({ aud: '999-other.apps.googleusercontent.com' })), rawNonce, 'open'))).toBe('audience');
  });

  it('refuses expired, old and future tokens', async () => {
    const { verifier } = setup();
    expect(await refusal(verifier.verify(signToken(claims({ exp: seconds - 120 })), rawNonce, 'open'))).toBe('expired');
    // Google's tokens last an hour; this app accepts one signed in the last 15 minutes.
    expect(await refusal(verifier.verify(signToken(claims({ iat: seconds - 16 * 60 })), rawNonce, 'open'))).toBe('stale');
    expect(await refusal(verifier.verify(signToken(claims({ iat: seconds + 300 })), rawNonce, 'open'))).toBe('stale');
    // A minute of clock difference is allowed.
    await expect(verifier.verify(signToken(claims({ iat: seconds + 45 })), rawNonce, 'open')).resolves.toBeTruthy();
  });

  it('binds the token to the browser that started it and to one purpose', async () => {
    const { verifier } = setup();
    const token = signToken(claims());
    expect(await refusal(verifier.verify(token, randomBytes(32).toString('base64url'), 'open'))).toBe('nonce');
    expect(await refusal(verifier.verify(token, rawNonce, 'reset'))).toBe('nonce');
    expect(await refusal(verifier.verify(signToken(claims({ nonce: undefined })), rawNonce, 'open'))).toBe('nonce');
  });

  it('needs an address Google has verified', async () => {
    const { verifier } = setup();
    expect(await refusal(verifier.verify(signToken(claims({ email_verified: false })), rawNonce, 'open'))).toBe('unverified_email');
    expect(await refusal(verifier.verify(signToken(claims({ email: undefined })), rawNonce, 'open'))).toBe('unverified_email');
  });

  it('fetches new keys when Google rotates them, at most once a minute for an unknown key', async () => {
    const rotating = setup({ keys: [googleKey.jwk] });
    await rotating.verifier.verify(signToken(claims()), rawNonce, 'open');
    // A token with a key id nobody published: one refetch, then no more within the minute.
    expect(await refusal(rotating.verifier.verify(signToken(claims(), { kid: 'made-up', privateKey: otherKey.privateKey }), rawNonce, 'open'))).toBe('signature');
    expect(rotating.calls()).toBe(1);
    rotating.advance(61_000);
    expect(await refusal(rotating.verifier.verify(signToken(claims({ iat: seconds + 30 }), { kid: 'made-up', privateKey: otherKey.privateKey }), rawNonce, 'open'))).toBe('signature');
    expect(rotating.calls()).toBe(2);

    // Keys past their max-age are fetched again.
    const expiring = setup({ maxAge: 60 });
    await expiring.verifier.verify(signToken(claims()), rawNonce, 'open');
    expiring.advance(61_000);
    await expiring.verifier.verify(signToken(claims({ iat: seconds + 30 })), rawNonce, 'open');
    expect(expiring.calls()).toBe(2);
  });

  it('says so when Google cannot be reached', async () => {
    const { verifier } = setup({ failing: true });
    expect(await refusal(verifier.verify(signToken(claims()), rawNonce, 'open'))).toBe('keys_unavailable');
  });

  it('makes the nonce the same way the browser does', () => {
    // base64url(SHA-256("open:" + raw)), 43 characters, no padding.
    expect(googleNonceFor('A'.repeat(43), 'open')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(googleNonceFor('A'.repeat(43), 'open')).not.toBe(googleNonceFor('A'.repeat(43), 'reset'));
  });
});
