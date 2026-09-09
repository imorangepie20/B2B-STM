import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';

const N = 16384;
import * as argon2 from 'argon2';

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, { type: argon2.argon2id });
}
const r = 8;
const p = 1;
const dummySalt = Buffer.alloc(16, 7);

async function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, 64, { N, r, p, maxmem: 32 * 1024 * 1024 }, (error, derived) => error ? reject(error) : resolve(derived));
  });
}

export async function verifyPassword(password: string, encoded: string | null): Promise<boolean> {
  if (encoded?.startsWith('$argon2id$')) {
    try { return await argon2.verify(encoded, password); } catch { return false; }
  }
  const parts = encoded?.split('$') ?? [];
  if (parts.length !== 6 || parts[0] !== 'scrypt' || Number(parts[1]) !== N || Number(parts[2]) !== r || Number(parts[3]) !== p) {
    await derive(password, dummySalt);
    return false;
  }
  const expected = Buffer.from(parts[5], 'base64url');
  if (expected.length !== 64) {
    await derive(password, dummySalt);
    return false;
  }
  try {
    const actual = await derive(password, Buffer.from(parts[4], 'base64url'));
    return timingSafeEqual(actual, expected);
  } catch {
    await derive(password, dummySalt);
    return false;
  }
}

export function createSessionToken(): string { return randomBytes(32).toString('hex'); }
