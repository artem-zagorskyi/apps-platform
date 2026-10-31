import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret } from './crypto.js';

describe('secret encryption', () => {
  it('round-trips and never repeats a ciphertext', () => {
    const first = encryptSecret('whsec_abc');
    const second = encryptSecret('whsec_abc');

    expect(first).toMatch(/^v1\./);
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe('whsec_abc');
    expect(decryptSecret(second)).toBe('whsec_abc');
  });

  it('refuses a changed value', () => {
    const [version, iv, tag, data] = encryptSecret('whsec_abc').split('.');
    const changed = [version, iv, tag, `A${data?.slice(1)}`].join('.');

    expect(() => decryptSecret(changed)).toThrow();
    expect(() => decryptSecret('plain text')).toThrow('Unknown secret format');
  });
});