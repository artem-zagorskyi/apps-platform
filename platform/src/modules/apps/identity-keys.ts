import { randomBytes } from 'node:crypto';
import { exportJWK, generateKeyPair, type JWK } from 'jose';

// A new Ed25519 key pair for an app backend's identity assertions.
// The platform stores only the public half; the private half goes to the
// app backend as PLATFORM_IDENTITY_KEY and is never stored here.
export async function generateIdentityKey(): Promise<{ kid: string; publicJwk: JWK; privateKeyEnv: string }> {
  const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true });
  const kid = `key-${new Date().toISOString().slice(0, 10)}-${randomBytes(3).toString('hex')}`;
  const publicJwk = { ...(await exportJWK(publicKey)), kid, alg: 'EdDSA' };
  const privateJwk = { ...(await exportJWK(privateKey)), kid, alg: 'EdDSA' };

  return {
    kid,
    publicJwk,
    privateKeyEnv: Buffer.from(JSON.stringify(privateJwk)).toString('base64url'),
  };
}