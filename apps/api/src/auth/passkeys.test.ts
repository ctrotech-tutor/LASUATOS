import { describe, expect, it } from 'vitest';
import { defaultPasskeyName, relyingPartyFor } from './passkeys.js';

describe('passkey relying party', () => {
  it('binds passkeys to the app’s host, and accepts only trusted origins on that host', () => {
    expect(relyingPartyFor('https://lasuatos.vercel.app', ['https://lasuatos-git-main.vercel.app', 'https://www.lasuatos.vercel.app', 'not a url']))
      .toEqual({ id: 'lasuatos.vercel.app', name: 'LASUATOS', origins: ['https://lasuatos.vercel.app', 'https://www.lasuatos.vercel.app'] });
  });

  it('works for local development', () => {
    expect(relyingPartyFor('http://localhost:3000', [])).toEqual({ id: 'localhost', name: 'LASUATOS', origins: ['http://localhost:3000'] });
  });
});

describe('default passkey names', () => {
  it('names the password managers people use', () => {
    expect(defaultPasskeyName('EA9B8D66-4D01-1D21-3CE4-B6B48CB575D4', undefined)).toBe('Google Password Manager');
    expect(defaultPasskeyName('fbfc3007-154e-4ecc-8c0b-6e020557d7bd', undefined)).toBe('iCloud Keychain');
  });

  it('falls back to the browser, coarsely, and never to anything identifying', () => {
    const android = 'Mozilla/5.0 (Linux; Android 14; SM-A546E Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.6778.81 Mobile Safari/537.36';
    expect(defaultPasskeyName(null, android)).toBe('Passkey on Chrome 131 on Android 14');
    expect(defaultPasskeyName('11111111-2222-3333-4444-555555555555', undefined)).toBe('Passkey');
  });
});
