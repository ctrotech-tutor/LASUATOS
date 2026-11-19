import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';
import { isoCBOR } from '@simplewebauthn/server/helpers';

/**
 * A software passkey for tests: it does what a phone or password manager does
 * (makes a P-256 key pair, signs challenges after "unlocking"), so the tests
 * run the server's real WebAuthn checks rather than a stand-in.
 */

const b64url = (bytes: Uint8Array | Buffer): string => Buffer.from(bytes).toString('base64url');
const sha256 = (data: Uint8Array | string): Buffer => createHash('sha256').update(data).digest();

const GOOGLE_PASSWORD_MANAGER = 'ea9b8d66-4d01-1d21-3ce4-b6b48cb575d4';

interface CreationOptions {
  readonly challenge: string;
  readonly rp: { readonly id?: string | undefined };
  readonly user: { readonly id: string };
}

interface RequestOptions {
  readonly challenge: string;
  readonly rpId?: string | undefined;
}

export class SoftwarePasskey {
  readonly credentialId = randomBytes(32);
  readonly #privateKey: KeyObject;
  readonly #cosePublicKey: Uint8Array;
  readonly #aaguid: Buffer;
  readonly #synced: boolean;
  #counter: number;
  #userHandle: string | undefined;

  constructor(options: { readonly aaguid?: string; readonly counter?: number; readonly synced?: boolean } = {}) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.#privateKey = privateKey;
    const jwk = publicKey.export({ format: 'jwk' });
    this.#cosePublicKey = isoCBOR.encode(new Map<number, number | Uint8Array>([
      [1, 2], // kty: EC2
      [3, -7], // alg: ES256
      [-1, 1], // crv: P-256
      [-2, Buffer.from(jwk.x!, 'base64url')],
      [-3, Buffer.from(jwk.y!, 'base64url')],
    ]));
    this.#aaguid = Buffer.from((options.aaguid ?? GOOGLE_PASSWORD_MANAGER).replace(/-/g, ''), 'hex');
    // Synced passkeys always report a signature count of 0; security keys count up.
    this.#counter = options.counter ?? 0;
    this.#synced = options.synced ?? true;
  }

  get id(): string {
    return b64url(this.credentialId);
  }

  /** Pretends to be a cloned security key whose count fell behind. */
  rewindCounter(to: number): void {
    this.#counter = to;
  }

  #authenticatorData(rpId: string, attested: boolean, userVerified: boolean): Buffer {
    if (this.#counter > 0) this.#counter += 1;
    // UP, UV, and for synced passkeys BE (backup eligible) and BS (backed up); AT when attested.
    const flags = 0x01 | (userVerified ? 0x04 : 0) | (this.#synced ? 0x08 | 0x10 : 0) | (attested ? 0x40 : 0);
    const counter = Buffer.alloc(4);
    counter.writeUInt32BE(this.#counter);
    const parts = [sha256(rpId), Buffer.from([flags]), counter];
    if (attested) {
      const length = Buffer.alloc(2);
      length.writeUInt16BE(this.credentialId.length);
      parts.push(this.#aaguid, length, this.credentialId, Buffer.from(this.#cosePublicKey));
    }
    return Buffer.concat(parts);
  }

  /** What `navigator.credentials.create()` returns, as @simplewebauthn/browser sends it. */
  register(options: CreationOptions, origin: string, choices: { readonly rpId?: string; readonly userVerified?: boolean } = {}) {
    this.#userHandle = options.user.id;
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge, origin, crossOrigin: false }));
    const authData = this.#authenticatorData(choices.rpId ?? options.rp.id ?? new URL(origin).hostname, true, choices.userVerified ?? true);
    const attestationObject = isoCBOR.encode(new Map<string, string | Uint8Array | Map<string, never>>([
      ['fmt', 'none'],
      ['attStmt', new Map()],
      ['authData', authData],
    ]));
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      authenticatorAttachment: 'platform' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        attestationObject: b64url(attestationObject),
        transports: ['internal', 'hybrid'],
      },
    };
  }

  /** What `navigator.credentials.get()` returns. */
  authenticate(options: RequestOptions, origin: string, choices: { readonly rpId?: string; readonly userVerified?: boolean } = {}) {
    const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: options.challenge, origin, crossOrigin: false }));
    const authData = this.#authenticatorData(choices.rpId ?? options.rpId ?? new URL(origin).hostname, false, choices.userVerified ?? true);
    const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), this.#privateKey);
    return {
      id: this.id,
      rawId: this.id,
      type: 'public-key' as const,
      authenticatorAttachment: 'platform' as const,
      clientExtensionResults: {},
      response: {
        clientDataJSON: b64url(clientDataJSON),
        authenticatorData: b64url(authData),
        signature: b64url(signature),
        ...(this.#userHandle ? { userHandle: this.#userHandle } : {}),
      },
    };
  }
}
