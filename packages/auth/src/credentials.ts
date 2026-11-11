import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

const SCRYPT_COST = 32_768;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 32;
const SCRYPT_MAX_MEMORY = 64 * 1024 * 1024;
const DUMMY_PASSWORD = 'lasuatos-dummy-account-password';
const DUMMY_SALT = Buffer.from('lasuatos-auth-dummy-salt', 'utf8');

function derivePasswordKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(
      password,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_COST,
        r: SCRYPT_BLOCK_SIZE,
        p: SCRYPT_PARALLELIZATION,
        maxmem: SCRYPT_MAX_MEMORY,
      },
      (error, key) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(key);
      },
    );
  });
}

const dummyKey = scryptSync(DUMMY_PASSWORD, DUMMY_SALT, SCRYPT_KEY_LENGTH, {
  N: SCRYPT_COST,
  r: SCRYPT_BLOCK_SIZE,
  p: SCRYPT_PARALLELIZATION,
  maxmem: SCRYPT_MAX_MEMORY,
});
const DUMMY_PASSWORD_HASH = [
  'scrypt',
  SCRYPT_COST,
  SCRYPT_BLOCK_SIZE,
  SCRYPT_PARALLELIZATION,
  DUMMY_SALT.toString('base64url'),
  dummyKey.toString('base64url'),
].join('$');

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashOpaqueToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derivePasswordKey(password, salt);
  return [
    'scrypt',
    SCRYPT_COST,
    SCRYPT_BLOCK_SIZE,
    SCRYPT_PARALLELIZATION,
    salt.toString('base64url'),
    key.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, cost, blockSize, parallelization, encodedSalt, encodedKey, extra] =
    encodedHash.split('$');
  if (
    extra !== undefined ||
    algorithm !== 'scrypt' ||
    cost !== String(SCRYPT_COST) ||
    blockSize !== String(SCRYPT_BLOCK_SIZE) ||
    parallelization !== String(SCRYPT_PARALLELIZATION) ||
    !encodedSalt ||
    !encodedKey
  ) {
    return false;
  }

  let salt: Buffer;
  let expectedKey: Buffer;
  try {
    salt = Buffer.from(encodedSalt, 'base64url');
    expectedKey = Buffer.from(encodedKey, 'base64url');
  } catch {
    return false;
  }
  if (salt.length !== 16 || expectedKey.length !== SCRYPT_KEY_LENGTH) return false;

  const actualKey = await derivePasswordKey(password, salt);
  return timingSafeEqual(actualKey, expectedKey);
}

export async function verifyPasswordOrDummy(
  password: string,
  encodedHash: string | null,
): Promise<boolean> {
  const valid = await verifyPassword(password, encodedHash ?? DUMMY_PASSWORD_HASH);
  return Boolean(encodedHash) && valid;
}
