import { LasuMailConfigSchema } from '@lasuatos/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { buildServer } from '../server.js';
import { lasuMailConfig, type LasuMailSettings } from './config.js';

const google = { clientId: '1-abc.apps.googleusercontent.com', redirectUri: 'https://lasuatos.example/auth/google' };
const on: LasuMailSettings = { mode: 'on', pilot: [], domains: ['st.lasu.edu.ng'], google };
const student = { email: 'Amina.Bello@st.lasu.edu.ng' };

describe('who may open their LASU inbox', () => {
  it('is ready for a LASU student mailbox when switched on, with only that address', () => {
    expect(lasuMailConfig(student, on)).toEqual({
      status: 'ready', email: 'amina.bello@st.lasu.edu.ng', clientId: google.clientId, redirectUri: google.redirectUri, hostedDomain: 'st.lasu.edu.ng',
    });
  });

  it('stays closed when off, without Google, or for a mailbox not on LASU’s Google', () => {
    expect(lasuMailConfig(student, { ...on, mode: 'off' }).status).toBe('off');
    expect(lasuMailConfig(student, { ...on, google: undefined }).status).toBe('no_google');
    expect(lasuMailConfig({ email: 'amina@gmail.com' }, on).status).toBe('not_lasu');
    expect(lasuMailConfig({ email: 'lecturer@lasu.edu.ng' }, on).status).toBe('not_lasu');
    expect(lasuMailConfig({ email: 'lecturer@lasu.edu.ng' }, { ...on, domains: ['st.lasu.edu.ng', 'lasu.edu.ng'] }).status).toBe('ready');
    expect(lasuMailConfig({ email: 'x@evil-st.lasu.edu.ng.example' }, on).status).toBe('not_lasu');
    const closed = lasuMailConfig(student, { ...on, mode: 'off' });
    expect(closed).toMatchObject({ clientId: null, redirectUri: null, hostedDomain: null });
  });

  it('in pilot, opens only for the listed addresses and looks switched off to everyone else', () => {
    const pilot: LasuMailSettings = { ...on, mode: 'pilot', pilot: ['amina.bello@st.lasu.edu.ng'] };
    expect(lasuMailConfig(student, pilot).status).toBe('ready');
    expect(lasuMailConfig({ email: 'tunde@st.lasu.edu.ng' }, pilot).status).toBe('off');
  });
});

describe('GET /api/v1/mail/config', () => {
  const servers: ReturnType<typeof buildServer>[] = [];
  afterEach(async () => { await Promise.all(servers.splice(0).map((server) => server.close())); });

  it('needs a session and never caches the answer', async () => {
    const account = { accountType: 'student' as const, id: '3c4ad7b8-377d-4ea9-a7bf-f7db874f388c', email: 'amina.bello@st.lasu.edu.ng', displayName: 'Amina', matricNumber: '250211184', matricNumberVerified: true, sessionExpiresAt: new Date('2027-01-01T00:00:00Z') };
    const auth = { getSession: async (token: string) => (token === 'a'.repeat(43) ? account : null) };
    const server = buildServer({ logger: false, auth: auth as never, lasuMail: on });
    servers.push(server);
    expect((await server.inject({ method: 'GET', url: '/api/v1/mail/config' })).statusCode).toBe(401);
    const response = await server.inject({ method: 'GET', url: '/api/v1/mail/config', headers: { cookie: `lasuatos_session=${'a'.repeat(43)}` } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(LasuMailConfigSchema.parse(response.json()).status).toBe('ready');
  });
});
