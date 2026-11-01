import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { exportJWK, generateKeyPair, type JWK, SignJWT } from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp, signUpViaApi } from '../../../test/helpers.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { addIdentityKey, revokeIdentityKey } from '../apps/service.js';
import { authIdentities } from './schema.js';

type Device = Awaited<ReturnType<typeof signUpViaApi>>;
type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

let backendKey: PrivateKey;
let attackerKey: PrivateKey;
let publicJwk: JWK;
let server: FastifyInstance;
let appId: string;

beforeAll(async () => {
  const backend = await generateKeyPair('EdDSA', { extractable: true });
  backendKey = backend.privateKey;
  attackerKey = (await generateKeyPair('EdDSA')).privateKey;
  publicJwk = { ...(await exportJWK(backend.publicKey)), kid: 'backend-1', alg: 'EdDSA' };
});

beforeEach(async () => {
  await resetDatabase();
  appId = await seedApp();
  await addIdentityKey(appId, 'backend-1', publicJwk);
  server = await buildApp();
});

afterEach(async () => {
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

const auth = (device: Device) => ({ authorization: `Bearer ${device.accessToken}` });

async function nonceFor(device: Device): Promise<string> {
  const res = await server.inject({ method: 'POST', url: '/v1/auth/nonce', headers: auth(device) });
  return res.json().nonce;
}

interface AssertionOptions {
  subject?: string;
  nonce?: string;
  issuer?: string;
  audience?: string;
  kid?: string;
  key?: PrivateKey;
  issuedAt?: number;
}

// What an app backend returns after its own login check
async function assertion(device: Device, options: AssertionOptions = {}): Promise<string> {
  return new SignJWT({ nonce: options.nonce ?? (await nonceFor(device)), email: 'person@example.com' })
    .setProtectedHeader({ alg: 'EdDSA', kid: options.kid ?? 'backend-1' })
    .setIssuer(options.issuer ?? appId)
    .setAudience(options.audience ?? 'apps-platform')
    .setSubject(options.subject ?? 'account-42')
    .setIssuedAt(options.issuedAt)
    .setExpirationTime('10m')
    .sign(options.key ?? backendKey);
}

function postExternal(device: Device, token: string, mergeStrategy?: string) {
  return server.inject({
    method: 'POST',
    url: '/v1/auth/external',
    headers: auth(device),
    payload: { assertion: token, ...(mergeStrategy && { mergeStrategy }) },
  });
}

describe('POST /v1/auth/external', () => {
  it("links an account of the app's own system", async () => {
    const device = await signUpViaApi(server, appId);

    const res = await postExternal(device, await assertion(device));

    expect(res.json()).toEqual({ result: 'linked', userId: device.userId, tokens: null });
    const [link] = await db.select().from(authIdentities).where(eq(authIdentities.userId, device.userId));
    expect(link).toMatchObject({ provider: 'external', providerSubject: 'account-42', email: 'person@example.com' });

    const me = await server.inject({ method: 'GET', url: '/v1/me', headers: auth(device) });
    expect(me.json().providers).toEqual([{ provider: 'external', email: 'person@example.com' }]);
  });

  it('signs a second device into the account through a merge', async () => {
    const owner = await signUpViaApi(server, appId);
    await postExternal(owner, await assertion(owner));
    const device = await signUpViaApi(server, appId);
    const token = await assertion(device);

    expect((await postExternal(device, token)).json().error).toBe('account_exists');
    const merged = await postExternal(device, token, 'keep_target');

    expect(merged.json()).toMatchObject({ result: 'signed_in', userId: owner.userId });
  });

  it('refuses assertions that are not valid for this app and device', async () => {
    const device = await signUpViaApi(server, appId);
    const otherDevice = await signUpViaApi(server, appId);
    const longAgo = Math.floor(Date.now() / 1000) - 11 * 60;

    const refused = [
      await assertion(device, { kid: 'unknown' }),
      await assertion(device, { key: attackerKey }),
      await assertion(device, { issuer: '0190a000-0000-7000-8000-00000000ffff' }),
      await assertion(device, { audience: 'someone-else' }),
      await assertion(device, { issuedAt: longAgo }),
      // A nonce issued to another device
      await assertion(device, { nonce: await nonceFor(otherDevice) }),
      'not a token',
    ];

    for (const token of refused) {
      const res = await postExternal(device, token);
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toBe('invalid_provider_token');
    }
  });

  it('refuses a used assertion and a revoked key', async () => {
    const device = await signUpViaApi(server, appId);
    const token = await assertion(device);
    await postExternal(device, token);

    expect((await postExternal(device, token)).statusCode).toBe(401);

    await revokeIdentityKey(appId, 'backend-1');
    const fresh = await signUpViaApi(server, appId);
    expect((await postExternal(fresh, await assertion(fresh))).statusCode).toBe(401);
  });
});