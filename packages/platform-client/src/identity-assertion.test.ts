import { decodeJwt, exportJWK, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import { createIdentityAssertion } from './index.js';

async function testKey() {
  const { privateKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  return { ...(await exportJWK(privateKey)), kid: 'test-key', alg: 'EdDSA' };
}

const base = { appId: 'app-1', nonce: 'nonce-1' };

describe('createIdentityAssertion', () => {
  it('signs a real account id', async () => {
    const token = await createIdentityAssertion({ ...base, privateKey: await testKey(), subject: 'acc_123' });

    expect(decodeJwt(token)).toMatchObject({ sub: 'acc_123', iss: 'app-1', nonce: 'nonce-1' });
  });

  it.each(['undefined', 'null', '"undefined"', '   '])('refuses to sign %j', async (subject) => {
    const signing = createIdentityAssertion({ ...base, privateKey: await testKey(), subject });

    await expect(signing).rejects.toThrow('not an account id');
  });
});