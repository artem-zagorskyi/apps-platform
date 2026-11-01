import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakeStore } from '../../../test/fake-store.js';
import { resetDatabase, seedApp, signUpViaApi } from '../../../test/helpers.js';
import { queuedJobs } from '../../../test/jobs.js';
import { buildApp } from '../../app.js';
import { config } from '../../core/config.js';
import { db, pool } from '../../core/db.js';
import { uploadCatalog } from './catalog.js';
import { processPlayNotification, setPubSubKeysForTests } from './google-notifications.js';
import { clearStoreProvidersForTests, registerStoreProvider } from './providers.js';
import { purchaseEvents, purchases, storeNotifications } from './schema.js';
import { reconcileVoided, refreshOverdue } from './sync.js';

type Device = Awaited<ReturnType<typeof signUpViaApi>>;
type PrivateKey = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

const DAY_MS = 24 * 60 * 60 * 1000;

let googleKey: PrivateKey;
let server: FastifyInstance;
let appId: string;
let store: FakeStore;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  googleKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'google-1', alg: 'RS256' };
  setPubSubKeysForTests(createLocalJWKSet({ keys: [jwk] }));
});

beforeEach(async () => {
  await resetDatabase();
  // Not tied to an app, so resetDatabase leaves these rows
  await db.delete(storeNotifications);
  appId = await seedApp();
  await uploadCatalog(appId, {
    format_version: 1,
    products: [{ store: 'google_play', product_id: 'premium', kind: 'subscription', entitlements: ['premium'] }],
  });
  store = new FakeStore();
  registerStoreProvider(store);
  queuedJobs.length = 0;
  server = await buildApp();
});

afterEach(async () => {
  clearStoreProvidersForTests();
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

// The OIDC token Pub/Sub attaches to a push
function pushToken(overrides: { audience?: string; email?: string } = {}) {
  return new SignJWT({ email: overrides.email ?? config.GOOGLE_PUBSUB_SERVICE_ACCOUNT, email_verified: true })
    .setProtectedHeader({ alg: 'RS256', kid: 'google-1' })
    .setIssuer('https://accounts.google.com')
    .setAudience(overrides.audience ?? config.GOOGLE_PUBSUB_AUDIENCE ?? '')
    .setIssuedAt()
    .setExpirationTime('1h')
    .sign(googleKey);
}

async function push(notification: unknown, options: { messageId?: string; token?: string } = {}) {
  return server.inject({
    method: 'POST',
    url: '/v1/billing/google/notifications',
    headers: { authorization: `Bearer ${options.token ?? (await pushToken())}` },
    payload: {
      message: {
        data: Buffer.from(JSON.stringify(notification)).toString('base64'),
        messageId: options.messageId ?? randomUUID(),
      },
      subscription: 'projects/test/subscriptions/play',
    },
  });
}

const subscriptionChanged = (purchaseToken: string) => ({
  packageName: 'com.example.test',
  subscriptionNotification: { notificationType: 2, purchaseToken, subscriptionId: 'premium' },
});

async function buy(device: Device): Promise<string> {
  const key = randomUUID();
  store.add({ purchaseKey: key, accountRef: device.userId });
  await server.inject({
    method: 'POST',
    url: '/v1/purchases',
    headers: { authorization: `Bearer ${device.accessToken}` },
    payload: { store: 'google_play', productId: 'premium', purchaseKey: key },
  });
  return key;
}

// What the job does with the latest stored notification
async function processLatest(): Promise<string> {
  const job = queuedJobs.at(-1);
  return processPlayNotification(job?.data.notificationId as string);
}

async function purchaseRow(key: string) {
  const [row] = await db.select().from(purchases).where(eq(purchases.purchaseKey, key));
  return row;
}

describe('POST /v1/billing/google/notifications', () => {
  it('stores a message once and queues its processing', async () => {
    const messageId = randomUUID();

    expect((await push(subscriptionChanged('t'), { messageId })).statusCode).toBe(204);
    expect((await push(subscriptionChanged('t'), { messageId })).statusCode).toBe(204);

    expect(await db.select().from(storeNotifications)).toHaveLength(1);
    expect(queuedJobs.filter((job) => job.name === 'billing-process-notification')).toHaveLength(1);
  });

  it('refuses pushes not from our subscription', async () => {
    const noToken = await server.inject({
      method: 'POST',
      url: '/v1/billing/google/notifications',
      payload: { message: { messageId: 'm' } },
    });

    expect(noToken.statusCode).toBe(401);
    expect((await push({}, { token: await pushToken({ audience: 'https://elsewhere.test' }) })).statusCode).toBe(401);
    expect((await push({}, { token: await pushToken({ email: 'attacker@evil.test' }) })).statusCode).toBe(401);
    expect(await db.select().from(storeNotifications)).toHaveLength(0);
  });
});

describe('processing', () => {
  it('takes the new state from the store, whatever the notification says', async () => {
    const buyer = await signUpViaApi(server, appId);
    const key = await buy(buyer);
    const renewedUntil = new Date(Date.now() + 60 * DAY_MS);
    store.add({ purchaseKey: key, accountRef: buyer.userId, expiresAt: renewedUntil, acknowledged: true });

    await push(subscriptionChanged(key));
    expect(await processLatest()).toBe('saved');

    expect((await purchaseRow(key))?.expiresAt).toEqual(renewedUntil);
    const kinds = (await db.select({ kind: purchaseEvents.kind }).from(purchaseEvents)).map((e) => e.kind);
    expect(kinds).toContain('renewed');
  });

  it('marks a refund and keeps it', async () => {
    const buyer = await signUpViaApi(server, appId);
    const key = await buy(buyer);

    await push({ packageName: 'com.example.test', voidedPurchaseNotification: { purchaseToken: key, productType: 1 } });
    await processLatest();
    expect((await purchaseRow(key))?.state).toBe('refunded');

    // Google later reports the revoked purchase as expired
    store.add({ purchaseKey: key, accountRef: buyer.userId, state: 'expired', acknowledged: true });
    await push(subscriptionChanged(key));
    await processLatest();
    expect((await purchaseRow(key))?.state).toBe('refunded');

    const entitlements = await server.inject({
      method: 'GET',
      url: '/v1/billing/entitlements',
      headers: { authorization: `Bearer ${buyer.accessToken}` },
    });
    expect(entitlements.json().entitlements).toEqual([]);
  });

  it('records a purchase the app never sent, for its owner', async () => {
    const buyer = await signUpViaApi(server, appId);
    const key = randomUUID();
    store.add({ purchaseKey: key, accountRef: buyer.userId });

    await push(subscriptionChanged(key));
    await processLatest();

    expect((await purchaseRow(key))?.userId).toBe(buyer.userId);
    // Confirmed, or Google would refund it after three days
    expect(store.acknowledged).toContain(key);
  });

  it('ignores other apps and test notifications', async () => {
    await push({ packageName: 'com.someone.else', subscriptionNotification: { notificationType: 2, purchaseToken: 't', subscriptionId: 'premium' } });
    expect(await processLatest()).toBe('ignored');

    await push({ packageName: 'com.example.test', testNotification: { version: '1.0' } });
    expect(await processLatest()).toBe('ignored');

    const rows = await db.select().from(storeNotifications);
    expect(rows.every((row) => row.processedAt !== null)).toBe(true);
    expect(rows.map((row) => row.error)).toContain('unknown_package');
  });
});

describe('scheduled checks', () => {
  it('refreshes purchases whose period ended without a notification', async () => {
    const buyer = await signUpViaApi(server, appId);
    const key = await buy(buyer);
    const longAgo = new Date(Date.now() - 2 * DAY_MS);
    await db.update(purchases).set({ expiresAt: longAgo, lastVerifiedAt: longAgo }).where(eq(purchases.purchaseKey, key));
    store.add({ purchaseKey: key, accountRef: buyer.userId, state: 'expired', expiresAt: longAgo, acknowledged: true });

    expect(await refreshOverdue(new Date())).toBe(1);
    expect((await purchaseRow(key))?.state).toBe('expired');
  });

  it('reconciles refunds the store reports', async () => {
    const buyer = await signUpViaApi(server, appId);
    const key = await buy(buyer);
    store.voided.push({ purchaseKey: key, voidedAt: new Date() });

    expect(await reconcileVoided(new Date())).toBe(1);
    expect((await purchaseRow(key))?.state).toBe('refunded');
    expect(await reconcileVoided(new Date())).toBe(0);
  });
});