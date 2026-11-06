import { describe, expect, it } from 'vitest';
import {
  generateRecoveryCodes,
  generateSessionToken,
  hashPassword,
  hashRecoveryCode,
  sha256,
  verifyPassword,
} from './credentials.js';

describe('passwords', () => {
  it('hashes with Argon2id and verifies only the right password', async () => {
    const hash = await hashPassword('correct horse battery');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'wrong horse battery')).toBe(false);
  });

  it('never accepts a password for an unknown admin', async () => {
    expect(await verifyPassword(null, 'anything')).toBe(false);
  });
});

describe('recovery codes', () => {
  it('generates ten distinct codes without look-alike characters', () => {
    const codes = generateRecoveryCodes();

    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) {
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]{4}(-[2-9A-HJ-NP-Z]{4}){3}$/);
    }
  });

  it('hashes a code the same regardless of case, dashes and spaces', () => {
    const [code] = generateRecoveryCodes(1);

    expect(hashRecoveryCode(code!.toLowerCase().replaceAll('-', ' '))).toBe(hashRecoveryCode(code!));
  });
});

describe('session tokens', () => {
  it('has 256 random bits and is stored only as its hash', () => {
    const { token, tokenHash } = generateSessionToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tokenHash).toBe(sha256(token));
    expect(generateSessionToken().token).not.toBe(token);
  });
});