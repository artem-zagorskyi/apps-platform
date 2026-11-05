import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes } from 'node:crypto';

// Argon2id (the library default) with the OWASP minimum parameters:
// 19 MiB of memory, 2 passes, 1 lane. About 50 ms per check.
const ARGON2_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

export const MIN_PASSWORD_LENGTH = 12;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

// Hash checked when the email is unknown: the login then takes as long as
// one with a wrong password, so timing does not reveal which emails exist
let dummyHash: Promise<string> | undefined;

export async function verifyPassword(stored: string | null, password: string): Promise<boolean> {
  if (stored === null) {
    dummyHash ??= hash(randomBytes(16).toString('hex'), ARGON2_OPTIONS);
    await verify(await dummyHash, password);
    return false;
  }
  return verify(stored, password);
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// Session token: 256 random bits. Only its SHA-256 is stored, so a database
// dump holds no usable sessions. A slow hash is not needed for random tokens.
export function generateSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: sha256(token) };
}

// Recovery codes: 16 characters from a 32-letter alphabet without 0/O/1/I,
// i.e. 80 random bits each. Too many to brute-force from a dump of the
// hashes, so plain SHA-256 is enough here as well.
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
export const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    // 256 is a multiple of 32, so "byte & 31" picks letters without bias
    const chars = [...randomBytes(16)].map((byte) => RECOVERY_ALPHABET[byte & 31]).join('');
    return chars.match(/.{4}/g)!.join('-'); // XXXX-XXXX-XXXX-XXXX
  });
}

// Accepts the code in any case, with or without dashes and spaces
export function hashRecoveryCode(input: string): string {
  return sha256(input.toUpperCase().replace(/[^0-9A-Z]/g, ''));
}