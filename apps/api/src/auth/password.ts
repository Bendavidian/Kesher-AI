import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// scrypt from node:crypto: no native dependency, so it builds the same on macOS and Windows.
// The stored format carries its parameters: scrypt$N$r$p$salt$hash, base64url parts.
const PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 64;
const SALT_BYTES = 16;

function derive(password: string, salt: Buffer, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_LENGTH, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, PARAMS);
  const { N, r, p } = PARAMS;
  return ['scrypt', N, r, p, salt.toString('base64url'), key.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash, ...rest] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash || rest.length > 0) return false;
  const options = { N: Number(n), r: Number(r), p: Number(p) };
  if (!Object.values(options).every(Number.isSafeInteger)) return false;

  const expected = Buffer.from(hash, 'base64url');
  if (expected.length !== KEY_LENGTH) return false;
  try {
    const actual = await derive(password, Buffer.from(salt, 'base64url'), options);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
