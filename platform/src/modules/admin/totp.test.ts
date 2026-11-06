import { describe, expect, it } from 'vitest';
import { hotp, totpUri, verifyTotp } from './totp.js';

// RFC 6238, appendix B: the SHA-1 seed and its expected 8-digit codes
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');
const RFC_VECTORS: [number, string][] = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

describe('hotp', () => {
  it.each(RFC_VECTORS)('matches RFC 6238 at T=%i', (time, expected) => {
    expect(hotp(RFC_SECRET, Math.floor(time / 30), 8)).toBe(expected);
  });
});

describe('verifyTotp', () => {
  const now = 1_700_000_000_000;
  const step = Math.floor(now / 30_000);
  const codeAt = (offset: number) => hotp(RFC_SECRET, step + offset);

  it('accepts the previous, current and next step and returns the matched step', () => {
    for (const offset of [-1, 0, 1]) {
      expect(verifyTotp(RFC_SECRET, codeAt(offset), null, now)).toBe(step + offset);
    }
  });

  it('rejects codes two steps away', () => {
    expect(verifyTotp(RFC_SECRET, codeAt(-2), null, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, codeAt(2), null, now)).toBeNull();
  });

  it('rejects steps not newer than the last accepted one', () => {
    expect(verifyTotp(RFC_SECRET, codeAt(0), step, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, codeAt(-1), step, now)).toBeNull();
    expect(verifyTotp(RFC_SECRET, codeAt(1), step, now)).toBe(step + 1);
  });

  it('rejects anything but six digits', () => {
    for (const code of ['', '12345', '1234567', 'abcdef', ' 12345']) {
      expect(verifyTotp(RFC_SECRET, code, null, now)).toBeNull();
    }
  });
});

describe('totpUri', () => {
  it('encodes the secret in base32 for authenticator apps', () => {
    // RFC 4648 test vector: "foobar" -> MZXW6YTBOI
    const uri = totpUri(Buffer.from('foobar'), 'owner@example.test');

    expect(uri.startsWith('otpauth://totp/')).toBe(true);
    expect(uri).toContain('secret=MZXW6YTBOI');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});