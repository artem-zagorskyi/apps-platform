import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FAKE_GOOGLE_CLIENT_ID,
  installFakeGoogle,
  signFakeGoogleToken,
} from '../../../test/fake-google.js';
import { resetDatabase, seedApp, signUpViaApi } from '../../../test/helpers.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { oauthClients } from '../apps/schema.js';
import { authIdentities, installations, userMerges, users } from './schema.js';

type Device = Awaited<ReturnType<typeof signUpViaApi>>;

let server: FastifyInstance;
let appId: string;

beforeAll(() => {
  installFakeGoogle();
});

beforeEach(async () => {
  await resetDatabase();
  appId = await seedApp();
  await db.insert(oauthClients).values({
    appId,
    platform: 'android',
    provider: 'google',
    clientId: FAKE_GOOGLE_CLIENT_ID,
  });
  server = await buildApp();
});

afterEach(async () => {
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

async function newNonce(device: Device): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/v1/auth/nonce',
    headers: { authorization: `Bearer ${device.accessToken}` },
  });
  return res.json().nonce;
}

// What the Google sheet would return on this device for this account
async function googleToken(device: Device, subject: string): Promise<string> {
  return signFakeGoogleToken({ subject, nonce: await newNonce(device) });
}

function postGoogle(device: Device, idToken: string, mergeStrategy?: string) {
  return server.inject({
    method: 'POST',
    url: '/v1/auth/google',
    headers: { authorization: `Bearer ${device.accessToken}` },
    payload: { idToken, ...(mergeStrategy && { mergeStrategy }) },
  });
}

function refresh(refreshToken: string) {
  return server.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: { refreshToken },
  });
}

// A device whose user has linked the Google account `subject`
async function deviceWithGoogle(subject: string): Promise<Device> {
  const device = await signUpViaApi(server, appId);
  const res = await postGoogle(device, await googleToken(device, subject));
  expect(res.json().result).toBe('linked');
  return device;
}

describe('POST /v1/auth/google', () => {
  it('links a new Google account to the current user', async () => {
    const device = await signUpViaApi(server, appId);

    const res = await postGoogle(device, await googleToken(device, 'g-1'));

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: 'linked', userId: device.userId, tokens: null });

    const [link] = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, device.userId));
    expect(link).toMatchObject({
      provider: 'google',
      providerSubject: 'g-1',
      email: 'player@gmail.com',
      emailVerified: true,
    });
  });

  it('reports an account already linked to the current user', async () => {
    const device = await deviceWithGoogle('g-1');

    const res = await postGoogle(device, await googleToken(device, 'g-1'));

    expect(res.json().result).toBe('already_linked');
  });

    it('keeps the stored email when the provider omits it', async () => {
    const device = await deviceWithGoogle('g-1');
    const idToken = await signFakeGoogleToken({
      subject: 'g-1',
      nonce: await newNonce(device),
      claims: { email: undefined, email_verified: undefined },
    });

    await postGoogle(device, idToken);

    const [link] = await db
      .select()
      .from(authIdentities)
      .where(eq(authIdentities.userId, device.userId));
    expect(link?.email).toBe('player@gmail.com');
    expect(link?.emailVerified).toBe(true);
  });

  it('rejects a nonce that was not issued to this device', async () => {
    const device = await signUpViaApi(server, appId);
    const idToken = await signFakeGoogleToken({ subject: 'g-1', nonce: randomUUID() });

    const res = await postGoogle(device, idToken);

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_provider_token');
  });

  it('rejects a token that was already used', async () => {
    const device = await signUpViaApi(server, appId);
    const idToken = await googleToken(device, 'g-1');
    await postGoogle(device, idToken);

    const res = await postGoogle(device, idToken);

    expect(res.statusCode).toBe(401);
  });

  it('rejects a token issued for another app', async () => {
    const device = await signUpViaApi(server, appId);
    const idToken = await signFakeGoogleToken({
      subject: 'g-1',
      nonce: await newNonce(device),
      audience: 'other.apps.googleusercontent.com',
    });

    expect((await postGoogle(device, idToken)).statusCode).toBe(401);
  });

  it('refuses a second account of the same provider', async () => {
    const device = await deviceWithGoogle('g-1');

    const res = await postGoogle(device, await googleToken(device, 'g-2'));

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('provider_already_linked');
  });
});

describe('POST /v1/auth/google on a second device', () => {
  it('reports a conflict and changes nothing', async () => {
    await deviceWithGoogle('g-1');
    const second = await signUpViaApi(server, appId);

    const res = await postGoogle(second, await googleToken(second, 'g-1'));

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('account_exists');

    const [user] = await db.select().from(users).where(eq(users.id, second.userId));
    expect(user?.status).toBe('active');
  });

  it('merges into the existing account when retried with a strategy', async () => {
    const first = await deviceWithGoogle('g-1');
    const second = await signUpViaApi(server, appId);

    // The refused attempt did not consume the nonce, so the same token works for the retry
    const idToken = await googleToken(second, 'g-1');
    expect((await postGoogle(second, idToken)).statusCode).toBe(409);

    const res = await postGoogle(second, idToken, 'keep_target');

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.result).toBe('signed_in');
    expect(body.userId).toBe(first.userId);

    const [source] = await db.select().from(users).where(eq(users.id, second.userId));
    expect(source).toMatchObject({ status: 'merged', mergedInto: first.userId });

    const [installation] = await db
      .select()
      .from(installations)
      .where(eq(installations.id, second.installationId));
    expect(installation?.userId).toBe(first.userId);

    const [merge] = await db
      .select()
      .from(userMerges)
      .where(eq(userMerges.sourceUserId, second.userId));
    expect(merge).toMatchObject({
      targetUserId: first.userId,
      strategy: 'keep_target',
    });

    // The anonymous session is gone; the new tokens belong to the existing account
    expect((await refresh(second.refreshToken)).statusCode).toBe(401);
    const me = await server.inject({
      method: 'GET',
      url: '/v1/me',
      headers: { authorization: `Bearer ${body.tokens.accessToken}` },
    });
    expect(me.json()).toMatchObject({
      userId: first.userId,
      installationId: second.installationId,
    });
  });

  it('refuses to merge a user who already has a linked account', async () => {
    await deviceWithGoogle('g-1');
    const second = await deviceWithGoogle('g-2');

    const res = await postGoogle(second, await googleToken(second, 'g-1'), 'keep_target');

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('already_signed_in');
  });
});