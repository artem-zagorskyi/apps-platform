import { createHmac } from 'node:crypto';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, jwtVerify } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  bearerToken,
  createTokenVerifier,
  PlatformTokenError,
  verifyWebhook,
  WebhookSignatureError,
  createIdentityAssertion,
} from '../src/index.js';

const APP_ID = '0190a000-0000-7000-8000-00000000a000';

type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

let platformKey: PrivateKey;
let otherKey: PrivateKey;
let verifyToken: ReturnType<typeof createTokenVerifier>;

beforeAll(async () => {
  const platform = await generateKeyPair('EdDSA');
  const other = await generateKeyPair('EdDSA');
  platformKey = platform.privateKey;
  otherKey = other.privateKey;

  const jwk = { ...(await exportJWK(platform.publicKey)), kid: 'k1', alg: 'EdDSA' };
  verifyToken = createTokenVerifier({
    platformUrl: 'http://platform.test',
    appId: APP_ID,
    keys: createLocalJWKSet({ keys: [jwk] }),
  });
});

// Signs a token the way the platform does
function token(options: { audience?: string; expiresAt?: number; claims?: Record<string, unknown>; key?: PrivateKey } = {}) {
  return new SignJWT({ ins: 'install-1', plt: 'android', ...options.claims })
    .setProtectedHeader({ alg: 'EdDSA', kid: 'k1' })
    .setSubject('user-1')
    .setAudience(options.audience ?? APP_ID)
    .setIssuer('apps-platform')
    .setIssuedAt()
    .setExpirationTime(options.expiresAt ?? '15m')
    .sign(options.key ?? platformKey);
}

async function refusal(promise: Promise<unknown>): Promise<string> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(PlatformTokenError);
  return (err as PlatformTokenError).reason;
}

describe('createTokenVerifier', () => {
  it('returns the user of a valid token', async () => {
    expect(await verifyToken(await token())).toEqual({
      userId: 'user-1',
      installationId: 'install-1',
      platform: 'android',
    });
  });

  it('refuses tokens of another app, expired tokens and other keys', async () => {
    expect(await refusal(verifyToken(await token({ audience: 'other-app' })))).toBe('ERR_JWT_CLAIM_VALIDATION_FAILED');
    expect(await refusal(verifyToken(await token({ expiresAt: Math.floor(Date.now() / 1000) - 60 })))).toBe(
      'ERR_JWT_EXPIRED',
    );
    expect(await refusal(verifyToken(await token({ key: otherKey })))).toBe('ERR_JWS_SIGNATURE_VERIFICATION_FAILED');
    expect(await refusal(verifyToken('not a token'))).toMatch(/^ERR_/);
  });

  it('refuses tokens without the platform claims', async () => {
    expect(await refusal(verifyToken(await token({ claims: { plt: 'web' } })))).toBe('malformed_claims');
  });
});

describe('bearerToken', () => {
  it('reads the token from the header', () => {
    expect(bearerToken('Bearer abc.def')).toBe('abc.def');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
});

describe('verifyWebhook', () => {
  const secret = 'whsec_test';
  const body = JSON.stringify({
    id: 'delivery-1',
    type: 'user.deleted',
    appId: APP_ID,
    createdAt: '2026-10-31T12:00:00.000Z',
    data: { userId: 'user-1', mergedUserIds: [], deletedAt: '2026-10-31T12:00:00.000Z' },
  });

  // Same scheme as the platform's signWebhook
  function sign(payload: string, timestamp = Math.floor(Date.now() / 1000)): string {
    return `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;
  }

  it('accepts a signed notification as a string or a buffer', () => {
    const signature = sign(body);

    expect(verifyWebhook(body, signature, secret)).toMatchObject({ id: 'delivery-1', type: 'user.deleted' });
    expect(verifyWebhook(Buffer.from(body), signature, secret).type).toBe('user.deleted');
  });

  it('refuses a changed body, another secret, an old or a missing signature', () => {
    const signature = sign(body);

    expect(() => verifyWebhook(body.replace('user-1', 'user-2'), signature, secret)).toThrow(WebhookSignatureError);
    expect(() => verifyWebhook(body, signature, 'whsec_other')).toThrow('does not match');
    expect(() => verifyWebhook(body, sign(body, Math.floor(Date.now() / 1000) - 600), secret)).toThrow('too old');
    expect(() => verifyWebhook(body, undefined, secret)).toThrow('Missing');
    expect(() => verifyWebhook(body, 'v1=abc', secret)).toThrow('Missing');
  });
});

describe('createIdentityAssertion', () => {
  it('signs an assertion the platform can verify', async () => {
    const { publicKey, privateKey } = await generateKeyPair('EdDSA', { extractable: true });
    const privateJwk = { ...(await exportJWK(privateKey)), kid: 'backend-1', alg: 'EdDSA' };
    const printed = Buffer.from(JSON.stringify(privateJwk)).toString('base64url');

    const assertion = await createIdentityAssertion({
      privateKey: printed,
      appId: APP_ID,
      subject: 'account-42',
      nonce: 'nonce-1',
      email: 'person@example.com',
    });

    const { payload, protectedHeader } = await jwtVerify(assertion, publicKey, {
      issuer: APP_ID,
      audience: 'apps-platform',
    });
    expect(protectedHeader).toMatchObject({ alg: 'EdDSA', kid: 'backend-1' });
    expect(payload).toMatchObject({ sub: 'account-42', nonce: 'nonce-1', email: 'person@example.com' });
    expect((payload.exp ?? 0) - (payload.iat ?? 0)).toBe(600);
  });
});