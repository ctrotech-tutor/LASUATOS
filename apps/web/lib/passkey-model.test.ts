import { describe, expect, it } from 'vitest';
import { ceremonyFailure, passkeyLine } from './passkey-model';

const domError = (name: string) => Object.assign(new Error('x'), { name });
const webAuthnError = (name: string, code: string) => Object.assign(new Error('x'), { name, code });

describe('passkey prompt failures', () => {
  it('treats closing the prompt, a timeout and no passkey here as cancelled', () => {
    expect(ceremonyFailure(domError('NotAllowedError'), 'sign_in')).toEqual({ kind: 'cancelled' });
    expect(ceremonyFailure(webAuthnError('AbortError', 'ERROR_CEREMONY_ABORTED'), 'add')).toEqual({ kind: 'cancelled' });
  });

  it('says what to do when the device already has one, or cannot check it is you', () => {
    expect(ceremonyFailure(webAuthnError('InvalidStateError', 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'), 'add')).toMatchObject({ message: expect.stringContaining('already has a passkey') });
    expect(ceremonyFailure(webAuthnError('ConstraintError', 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT'), 'add')).toMatchObject({ message: expect.stringContaining('PIN or fingerprint') });
    expect(ceremonyFailure(webAuthnError('SecurityError', 'ERROR_INVALID_RP_ID'), 'sign_in')).toMatchObject({ message: expect.stringContaining('LASUATOS address') });
  });

  it('falls back to plain words, with the password as the way out when signing in', () => {
    expect(ceremonyFailure(new Error('boom'), 'sign_in')).toMatchObject({ kind: 'failed', message: expect.stringContaining('sign in with your password') });
    expect(ceremonyFailure('weird', 'add')).toMatchObject({ kind: 'failed', message: expect.stringContaining('another browser') });
  });
});

describe('passkey lines', () => {
  const ago = (iso: string) => `ago(${iso.slice(0, 10)})`;
  const added = (iso: string) => `on(${iso.slice(0, 10)})`;
  it('says where it lives and when it was last used', () => {
    expect(passkeyLine({ synced: true, lastUsedAt: '2026-11-08T10:00:00.000Z', createdAt: '2026-11-01T10:00:00.000Z' }, ago, added)).toBe('Synced · last used ago(2026-11-08)');
    expect(passkeyLine({ synced: false, lastUsedAt: null, createdAt: '2026-11-01T10:00:00.000Z' }, ago, added)).toBe('This device only · added on(2026-11-01), not used yet');
  });
});
