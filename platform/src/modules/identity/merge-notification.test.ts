import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { FAKE_GOOGLE_CLIENT_ID, installFakeGoogle, signFakeGoogleToken } from '../../../test/fake-google.js';
import { resetDatabase, seedApp, signUpViaApi } from '../../../test/helpers.js';
import { queuedJobs } from '../../../test/jobs.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { oauthClients } from '../apps/schema.js';
import { deliveries } from '../webhooks/schema.js';

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
  queuedJobs.length = 0;
  server = await buildApp();
});

afterEach(async () => {
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

async function googleToken(device: Device, subject: string): Promise<string> {
  const res = await server.inject({
    method: 'POST',
    url: '/v1/auth/nonce',
    headers: { authorization: `Bearer ${device.accessToken}` },
  });
  return signFakeGoogleToken({ subject, nonce: res.json().nonce });
}

function postGoogle(device: Device, idToken: string, mergeStrategy?: string) {
  return server.inject({
    method: 'POST',
    url: '/v1/auth/google',
    headers: { authorization: `Bearer ${device.accessToken}` },
    payload: { idToken, ...(mergeStrategy && { mergeStrategy }) },
  });
}

it('a merge notifies the app backend', async () => {
  const owner = await signUpViaApi(server, appId);
  expect((await postGoogle(owner, await googleToken(owner, 'g-1'))).json().result).toBe('linked');

  const device = await signUpViaApi(server, appId);
  const idToken = await googleToken(device, 'g-1');
  expect((await postGoogle(device, idToken)).statusCode).toBe(409);
  expect((await postGoogle(device, idToken, 'keep_source')).json().result).toBe('signed_in');

  const [delivery] = await db.select().from(deliveries).where(eq(deliveries.appId, appId));
  expect(delivery).toMatchObject({
    type: 'user.merged',
    payload: { sourceUserId: device.userId, targetUserId: owner.userId, strategy: 'keep_source' },
  });
  expect(queuedJobs).toContainEqual({ name: 'webhooks-deliver', data: { deliveryId: delivery?.id } });
});

it('linking a new account sends nothing', async () => {
  const device = await signUpViaApi(server, appId);

  await postGoogle(device, await googleToken(device, 'g-1'));

  expect(await db.select().from(deliveries).where(eq(deliveries.appId, appId))).toEqual([]);
});