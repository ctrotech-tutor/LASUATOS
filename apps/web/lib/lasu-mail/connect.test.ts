import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  connect, connectedMailbox, currentToken, disconnect, finishMail, forgetMail, grantsMail, inDomains, mailAuthUrl, maySilentlyReconnect, problemFor,
  readyConfig, rememberMailbox, takeMailResult, type ReadyMailConfig,
} from './connect';

const CONFIG: ReadyMailConfig = {
  status: 'ready',
  mailbox: 'amina.bello@st.lasu.edu.ng',
  domains: ['st.lasu.edu.ng'],
  clientId: '1234-abc.apps.googleusercontent.com',
  redirectUri: 'https://lasuatos.vercel.app/auth/google',
  hostedDomain: 'st.lasu.edu.ng',
};
const OWNER = 'amina.bello@st.lasu.edu.ng';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}

let assign: ReturnType<typeof vi.fn>;
let local: ReturnType<typeof memoryStorage>;
let session: ReturnType<typeof memoryStorage>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assign = vi.fn();
  local = memoryStorage();
  session = memoryStorage();
  fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('window', { localStorage: local, sessionStorage: session, location: { assign }, dispatchEvent: vi.fn() });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function startAndReturn(fragment: (state: string) => string, options: { silent?: boolean; at?: number } = {}) {
  connect(CONFIG, { owner: OWNER, returnTo: '/mail?m=abc', silent: options.silent ?? false });
  const sent = new URL(String(assign.mock.calls.at(-1)?.[0]));
  return { sent, finished: finishMail(fragment(sent.searchParams.get('state') ?? ''), options.at ?? Date.now()) };
}

describe('connecting LASU mail', () => {
  it('asks Google for read-only mail on LASU’s Workspace, for this mailbox, as a token for the browser', () => {
    const url = new URL(mailAuthUrl(CONFIG, 'state1', false, CONFIG.mailbox));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: CONFIG.clientId,
      redirect_uri: CONFIG.redirectUri,
      response_type: 'token',
      scope: SCOPE,
      state: 'state1',
      login_hint: 'amina.bello@st.lasu.edu.ng',
      hd: 'st.lasu.edu.ng',
      include_granted_scopes: 'false',
    });
    const chooser = new URL(mailAuthUrl({ ...CONFIG, mailbox: null }, 's', false, null));
    expect(chooser.searchParams.get('prompt')).toBe('select_account');
    expect(chooser.searchParams.has('login_hint')).toBe(false);
    expect(new URL(mailAuthUrl(CONFIG, 's', true, 'x@st.lasu.edu.ng')).searchParams.get('prompt')).toBe('none');
  });

  it('only works on the address Google returns to', () => {
    expect(readyConfig(CONFIG, 'https://lasuatos.vercel.app')).toBe(CONFIG);
    expect(readyConfig(CONFIG, 'https://preview-123.vercel.app')).toBeNull();
    expect(readyConfig({ ...CONFIG, status: 'off' }, 'https://lasuatos.vercel.app')).toBeNull();
    expect(readyConfig(null, 'https://lasuatos.vercel.app')).toBeNull();
  });

  it('keeps the token in this tab only, for the account that connected it, and goes back where it was', () => {
    const at = Date.now();
    const { finished } = startAndReturn((state) => `#access_token=ya29.token&token_type=Bearer&expires_in=3599&scope=${encodeURIComponent(SCOPE)}&state=${state}`, { at });
    expect(finished).toEqual({ returnTo: '/mail?m=abc' });
    expect(currentToken(OWNER, at)).toMatchObject({ accessToken: 'ya29.token', owner: OWNER });
    expect([...local.values.keys()].some((key) => local.values.get(key)?.includes('ya29'))).toBe(false);
    expect(currentToken('someone@else.com', at)).toBeNull();
    // A minute early, so no request starts on a dying token.
    expect(currentToken(OWNER, at + 3540_000)).toBeNull();
  });

  it('ignores answers it did not start, and Continue with Google’s answers', () => {
    expect(finishMail('#access_token=x&state=nope')).toBeNull();
    connect(CONFIG, { owner: OWNER, returnTo: '/mail' });
    expect(finishMail('#id_token=abc&state=other')).toBeNull();
  });

  it('explains what went wrong, once', () => {
    startAndReturn((state) => `#error=access_denied&state=${state}`);
    expect(takeMailResult()?.problem).toBe('cancelled');
    expect(takeMailResult()).toBeNull();
    startAndReturn((state) => `#access_token=t&expires_in=3600&scope=openid&state=${state}`);
    expect(takeMailResult()?.problem).toBe('scope_unticked');
    expect(currentToken(OWNER)).toBeNull();
    startAndReturn((state) => `#access_token=t&scope=${encodeURIComponent(SCOPE)}&state=${state}`, { at: Date.now() + 11 * 60_000 });
    expect(takeMailResult()?.problem).toBe('expired');
  });

  it('names LASU’s block, and a quiet reconnect that needs the student', () => {
    expect(problemFor('admin_policy_enforced', false)).toBe('not_allowed_by_lasu');
    expect(problemFor('org_internal', false)).toBe('not_allowed_by_lasu');
    expect(problemFor('interaction_required', true)).toBe('needs_sign_in');
    expect(problemFor('server_error', true)).toBe('needs_sign_in');
    expect(problemFor('server_error', false)).toBe('failed');
    expect(grantsMail(`openid ${SCOPE}`)).toBe(true);
    expect(grantsMail('https://www.googleapis.com/auth/gmail.metadata')).toBe(false);
  });

  it('reconnects quietly only to a mailbox connected here before, and not twice in a row', () => {
    connect(CONFIG, { owner: OWNER, returnTo: '/mail', silent: true });
    expect(new URL(String(assign.mock.calls[0]?.[0])).searchParams.get('prompt')).not.toBe('none');
    rememberMailbox(OWNER, 'Amina.Bello@st.lasu.edu.ng');
    expect(connectedMailbox(OWNER)).toBe('amina.bello@st.lasu.edu.ng');
    expect(connectedMailbox('other@gmail.com')).toBeNull();
    expect(maySilentlyReconnect()).toBe(true);
    connect(CONFIG, { owner: OWNER, returnTo: '/mail', silent: true });
    expect(new URL(String(assign.mock.calls[1]?.[0])).searchParams.get('prompt')).toBe('none');
    expect(maySilentlyReconnect()).toBe(false);
    expect(maySilentlyReconnect(Date.now() + 3 * 60_000)).toBe(true);
  });

  it('accepts only LASU mailboxes', () => {
    expect(inDomains('ada@st.lasu.edu.ng', CONFIG.domains)).toBe(true);
    expect(inDomains('ada@gmail.com', CONFIG.domains)).toBe(false);
    expect(inDomains('ada@evil.st.lasu.edu.ng', CONFIG.domains)).toBe(false);
  });

  it('disconnecting forgets everything here and takes the permission back at Google', async () => {
    startAndReturn((state) => `#access_token=ya29.secret&expires_in=3600&scope=${encodeURIComponent(SCOPE)}&state=${state}`);
    rememberMailbox(OWNER, OWNER);
    await disconnect();
    expect(currentToken(OWNER)).toBeNull();
    expect(connectedMailbox(OWNER)).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith('https://oauth2.googleapis.com/revoke', expect.objectContaining({ method: 'POST', body: 'token=ya29.secret' }));
  });

  it('signing out leaves nothing of the mailbox on the device', () => {
    startAndReturn((state) => `#access_token=ya29.secret&expires_in=3600&scope=${encodeURIComponent(SCOPE)}&state=${state}`);
    rememberMailbox(OWNER, OWNER);
    forgetMail();
    expect(currentToken(OWNER)).toBeNull();
    expect(connectedMailbox(OWNER)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
