import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  emailInCredential,
  finishGoogle,
  googleAuthUrl,
  googleErrorText,
  googleNonce,
  inAppBrowser,
  safeReturnPath,
  startGoogle,
  takeGoogleResult,
  usableConfig,
  type ReadyGoogleConfig,
} from './google-proof';

const CONFIG: ReadyGoogleConfig = {
  clientId: '1234-abc.apps.googleusercontent.com',
  redirectUri: 'https://lasuatos.vercel.app/auth/google',
  hostedDomain: 'st.lasu.edu.ng',
};

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

/** An unsigned token with these claims: only the address is read in the browser. */
function token(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part(claims)}.signature`;
}

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assign = vi.fn();
  vi.stubGlobal('window', { localStorage: memoryStorage(), location: { assign } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function startAndReturn(fragment: (state: string) => string, at = Date.now()) {
  await startGoogle(CONFIG, { purpose: 'open', returnTo: '/sign-up?next=%2Fcheck-in', context: { matricNumber: '250211184' } });
  const sent = new URL(String(assign.mock.calls[0]?.[0]));
  return { sent, finished: finishGoogle(fragment(sent.searchParams.get('state') ?? ''), at) };
}

describe('Continue with Google in the browser', () => {
  it('hashes the nonce with its step, the same as the server', async () => {
    const expected = createHash('sha256').update('reset:raw-nonce').digest('base64url');
    expect(await googleNonce('raw-nonce', 'reset')).toBe(expected);
    expect(await googleNonce('raw-nonce', 'open')).not.toBe(expected);
  });

  it('asks Google for the address only, limited to LASU accounts unless the email is personal', () => {
    const lasu = new URL(googleAuthUrl(CONFIG, { purpose: 'open', returnTo: '/sign-up', loginHint: 'ada@st.lasu.edu.ng' }, 'state1', 'hashed'));
    expect(lasu.origin + lasu.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(lasu.searchParams)).toEqual({
      client_id: CONFIG.clientId,
      redirect_uri: CONFIG.redirectUri,
      response_type: 'id_token',
      scope: 'openid email',
      nonce: 'hashed',
      state: 'state1',
      hd: 'st.lasu.edu.ng',
      login_hint: 'ada@st.lasu.edu.ng',
    });

    const personal = new URL(googleAuthUrl(CONFIG, { purpose: 'open', returnTo: '/sign-up', personal: true }, 's', 'n'));
    expect(personal.searchParams.has('hd')).toBe(false);
    expect(personal.searchParams.get('prompt')).toBe('select_account');
    // A personal address the server showed partly hidden is not passed on as a hint.
    const masked = new URL(googleAuthUrl(CONFIG, { purpose: 'reset', returnTo: '/sign-up', personal: true, loginHint: 'fa•••@gmail.com' }, 's', 'n'));
    expect(masked.searchParams.has('login_hint')).toBe(false);
  });

  it('shows the button only when set up for this address', () => {
    expect(usableConfig(CONFIG, 'https://lasuatos.vercel.app')).toEqual(CONFIG);
    // A preview deployment: Google would return to the live site, so no button.
    expect(usableConfig(CONFIG, 'https://lasuatos-git-branch.vercel.app')).toBeNull();
    expect(usableConfig({ ...CONFIG, clientId: null }, 'https://lasuatos.vercel.app')).toBeNull();
    expect(usableConfig(null, 'https://lasuatos.vercel.app')).toBeNull();
  });

  it('goes back only to a path on this site', () => {
    expect(safeReturnPath('/account/security#face')).toBe('/account/security#face');
    expect(safeReturnPath('//evil.example')).toBe('/');
    expect(safeReturnPath('/\\evil.example')).toBe('/');
    expect(safeReturnPath('https://evil.example')).toBe('/');
    expect(safeReturnPath(42)).toBe('/');
  });

  it('hands the proof, with the raw nonce, to the step that asked, once', async () => {
    const credential = token({ email: 'Ada@st.lasu.edu.ng' });
    const { sent, finished } = await startAndReturn((state) => `#state=${state}&id_token=${credential}`);
    expect(finished).toEqual({ returnTo: '/sign-up?next=%2Fcheck-in' });

    expect(takeGoogleResult(['email'])).toBeNull();
    const result = takeGoogleResult(['open', 'reset']);
    expect(result).toMatchObject({ kind: 'proof', purpose: 'open', email: 'ada@st.lasu.edu.ng', context: { matricNumber: '250211184' } });
    if (result?.kind !== 'proof') throw new Error('expected a proof');
    expect(result.proof.credential).toBe(credential);
    // Google saw only the digest of the nonce kept here.
    expect(sent.searchParams.get('nonce')).toBe(await googleNonce(result.proof.nonce, 'open'));
    expect(takeGoogleResult(['open'])).toBeNull();
  });

  it('refuses an answer for a sign-in this browser did not start', async () => {
    const { finished } = await startAndReturn(() => `#state=forged&id_token=${token({ email: 'x@st.lasu.edu.ng' })}`);
    expect(finished?.returnTo).toBe('/sign-up?next=%2Fcheck-in');
    expect(takeGoogleResult(['open'])).toMatchObject({ kind: 'error' });

    expect(finishGoogle('#state=anything&id_token=abc')).toBeNull();
  });

  it('says what to do when Google refuses or the student cancels', async () => {
    await startAndReturn((state) => `#state=${state}&error=access_denied`);
    expect(takeGoogleResult(['open'])).toMatchObject({ kind: 'error', message: googleErrorText('access_denied') });
    expect(googleErrorText('admin_policy_enforced')).toMatch(/LASU/);
  });

  it('drops a result left too long', async () => {
    const at = Date.now();
    await startAndReturn((state) => `#state=${state}&id_token=${token({ email: 'a@st.lasu.edu.ng' })}`, at);
    expect(takeGoogleResult(['open'], at + 15 * 60 * 1000)).toBeNull();
  });

  it('reads the address from the token, and nothing from junk', () => {
    expect(emailInCredential(token({ email: 'Bola@Gmail.com' }))).toBe('bola@gmail.com');
    expect(emailInCredential('not-a-token')).toBe('');
  });

  it('spots in-app browsers that Google blocks', () => {
    expect(inAppBrowser('Mozilla/5.0 (Linux; Android 13; wv) AppleWebKit/537.36 WhatsApp/2.24')).toBe(true);
    expect(inAppBrowser('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Instagram 300.0')).toBe(true);
    expect(inAppBrowser('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36')).toBe(false);
  });
});
