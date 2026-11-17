import { generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import type { GoogleProofPurpose } from '@lasuatos/contracts';
import { createGoogleIdTokenVerifier, googleNonceFor } from '../auth/google-id-token.js';

/**
 * Stands in for Google in end-to-end tests: a key pair made here plays
 * Google's signing key, served to the real verifier as Google's published
 * keys, so "Continue with Google" is tested through the real checks.
 */

export const FAKE_GOOGLE_CLIENT_ID = '123456789012-e2etestclient.apps.googleusercontent.com';

export function fakeGoogle(now: () => Date) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'e2e-google', alg: 'RS256', use: 'sig' };
  const fetcher = (async () => new Response(JSON.stringify({ keys: [jwk] }), {
    status: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=21600' },
  })) as typeof fetch;
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');

  return {
    signIn: {
      clientId: FAKE_GOOGLE_CLIENT_ID,
      redirectUri: 'https://lasuatos.e2e.invalid/auth/google',
      verifier: createGoogleIdTokenVerifier({ clientId: FAKE_GOOGLE_CLIENT_ID, fetch: fetcher, now }),
    },
    /**
     * What the browser would send after the student picks `email` on Google's
     * page: `hd` is LASU's Workspace for a LASU address unless `personal`.
     */
    proof(email: string, purpose: GoogleProofPurpose, options: { personal?: boolean; verified?: boolean; noncePurpose?: GoogleProofPurpose } = {}) {
      const nonce = randomBytes(32).toString('base64url');
      const seconds = Math.floor(now().getTime() / 1000);
      const workspace = !options.personal && email.endsWith('@st.lasu.edu.ng');
      const claims = {
        iss: 'https://accounts.google.com',
        aud: FAKE_GOOGLE_CLIENT_ID,
        sub: `sub-${email}`,
        email,
        email_verified: options.verified ?? true,
        ...(workspace ? { hd: 'st.lasu.edu.ng' } : {}),
        iat: seconds - 5,
        exp: seconds + 3595,
        nonce: googleNonceFor(nonce, options.noncePurpose ?? purpose),
      };
      const head = part({ alg: 'RS256', kid: 'e2e-google', typ: 'JWT' });
      const body = part(claims);
      const signature = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url');
      return { credential: `${head}.${body}.${signature}`, nonce };
    },
  };
}
