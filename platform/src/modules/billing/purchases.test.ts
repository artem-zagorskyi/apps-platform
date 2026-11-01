import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeStore } from '../../../test/fake-store.js';
import { linkFakeGoogleAccount, resetDatabase, seedApp, signUpViaApi } from '../../../test/helpers.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import type { AccountInfo } from '../identity/accounts.js';
import { eraseUser } from '../identity/deletion.js';
import { deliveries } from '../webhooks/schema.js';
import { uploadCatalog } from './catalog.js';
import { transferPurchasesOnMerge } from './lifecycle.js';
import { decideOwnership, maskEmail } from './ownership.js';
import { clearStoreProvidersForTests, registerStoreProvider } from './providers.js';
import { purchaseEvents, purchases } from './schema.js';
import { StoreError } from './types.js';

type Device = Awaited<ReturnType<typeof signUpViaApi>>;

const account = (overrides: Partial<AccountInfo>): AccountInfo => ({
  userId: 'owner',
  status: 'active',
  linked: false,
  email: null,
  ...overrides,
});

// After every group of this file: the groups share the pool
afterAll(async () => {
  await pool.end();
});

describe('decideOwnership', () => {
  it('follows the agreed rules', () => {
    expect(decideOwnership('me', false, null)).toEqual({ kind: 'assign' });
    expect(decideOwnership('me', false, account({ userId: 'me' }))).toEqual({ kind: 'keep' });
    expect(decideOwnership('me', true, account({ linked: false }))).toEqual({ kind: 'assign' });
    expect(decideOwnership('me', true, account({ linked: true, status: 'deleted' }))).toEqual({ kind: 'assign' });
    expect(decideOwnership('me', false, account({ linked: true, email: 'anna@gmail.com' }))).toEqual({
      kind: 'sign_in_required',
      ownerId: 'owner',
      maskedEmail: 'a***@gmail.com',
    });
    expect(decideOwnership('me', true, account({ linked: true }))).toEqual({ kind: 'other_account', ownerId: 'owner' });
  });

  it('masks emails', () => {
    expect(maskEmail('test@example.com')).toBe('t***@example.com');
    expect(maskEmail('broken')).toBeNull();
    expect(maskEmail(null)).toBeNull();
  });
});

describe('POST /v1/purchases', () => {
  let server: FastifyInstance;
  let appId: string;
  let store: FakeStore;

  beforeEach(async () => {
    await resetDatabase();
    appId = await seedApp();
    await uploadCatalog(appId, {
      format_version: 1,
      products: [{ store: 'google_play', product_id: 'premium', kind: 'subscription', entitlements: ['premium'] }],
    });
    store = new FakeStore();
    registerStoreProvider(store);
    server = await buildApp();
  });

  afterEach(async () => {
    clearStoreProvidersForTests();
    await server.close();
  });

  function send(device: Device, purchaseKey: string, productId = 'premium') {
    return server.inject({
      method: 'POST',
      url: '/v1/purchases',
      headers: { authorization: `Bearer ${device.accessToken}` },
      payload: { store: 'google_play', productId, purchaseKey },
    });
  }

  async function ownerOf(purchaseKey: string) {
    const [row] = await db.select().from(purchases).where(eq(purchases.purchaseKey, purchaseKey));
    return row?.userId;
  }

  async function entitlementNotices(userId: string) {
    const rows = await db.select().from(deliveries).where(eq(deliveries.type, 'entitlements.changed'));
    return rows.filter((row) => row.payload.userId === userId);
  }

  it('registers and confirms a new purchase of the current user', async () => {
    const buyer = await signUpViaApi(server, appId);
    const key = randomUUID();
    store.add({ purchaseKey: key, accountRef: buyer.userId });

    const res = await send(buyer, key);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'owned',
      maskedEmail: null,
      entitlements: [{ key: 'premium', productId: 'premium', state: 'active', willRenew: true }],
    });
    expect(store.acknowledged).toEqual([key]);
    expect(await ownerOf(key)).toBe(buyer.userId);

    const history = await db.select({ kind: purchaseEvents.kind }).from(purchaseEvents);
    expect(history.map((e) => e.kind).sort()).toEqual(['acknowledged', 'registered']);
    expect(await entitlementNotices(buyer.userId)).toHaveLength(1);
  });

  it('changes nothing when the same purchase comes again', async () => {
    const buyer = await signUpViaApi(server, appId);
    const key = randomUUID();
    store.add({ purchaseKey: key, accountRef: buyer.userId });
    await send(buyer, key);

    const again = await send(buyer, key);

    expect(again.json().status).toBe('owned');
    expect(store.acknowledged).toHaveLength(1);
    expect(await db.select().from(purchaseEvents)).toHaveLength(2);
    expect(await entitlementNotices(buyer.userId)).toHaveLength(1);
  });

  it('transfers a purchase of an anonymous user who cannot come back', async () => {
    const lost = await signUpViaApi(server, appId);
    const reinstalled = await signUpViaApi(server, appId);
    const key = randomUUID();
    store.add({ purchaseKey: key, accountRef: lost.userId });
    await send(lost, key);

    const res = await send(reinstalled, key);

    expect(res.json()).toMatchObject({ status: 'transferred', entitlements: [{ key: 'premium' }] });
    expect(await ownerOf(key)).toBe(reinstalled.userId);
    expect(await entitlementNotices(lost.userId)).toHaveLength(2);
    expect(await entitlementNotices(reinstalled.userId)).toHaveLength(1);
  });

  it('asks to sign in when the owner has a linked account', async () => {
    const owner = await signUpViaApi(server, appId);
    await linkFakeGoogleAccount(owner.userId, appId);
    const anonymous = await signUpViaApi(server, appId);
    const key = randomUUID();
    store.add({ purchaseKey: key, accountRef: owner.userId });

    const res = await send(anonymous, key);

    expect(res.json()).toEqual({ status: 'sign_in_required', maskedEmail: 't***@example.com', entitlements: [] });
    expect(await ownerOf(key)).toBe(owner.userId);
    // Confirmed anyway: otherwise the store would refund the owner
    expect(store.acknowledged).toEqual([key]);
  });

  it('refuses a purchase of another linked account', async () => {
    const owner = await signUpViaApi(server, appId);
    await linkFakeGoogleAccount(owner.userId, appId);
    const other = await signUpViaApi(server, appId);
    await linkFakeGoogleAccount(other.userId, appId);
    const key = randomUUID();
    store.add({ purchaseKey: key, accountRef: owner.userId });

    expect((await send(other, key)).json().status).toBe('owned_by_other_account');
    expect(await ownerOf(key)).toBe(owner.userId);
  });

  it('gives the purchase of a deleted account to the current user', async () => {
    const owner = await signUpViaApi(server, appId);
    await linkFakeGoogleAccount(owner.userId, appId);
    const key = randomUUID();
    store.add({ purchaseKey: key, accountRef: owner.userId });
    await send(owner, key);
    await server.inject({ method: 'DELETE', url: '/v1/me', headers: { authorization: `Bearer ${owner.accessToken}` } });
    await eraseUser(owner.userId, new Date());

    const newcomer = await signUpViaApi(server, appId);
    const res = await send(newcomer, key);

    expect(res.json()).toMatchObject({ status: 'owned', entitlements: [{ key: 'premium' }] });
    expect(await ownerOf(key)).toBe(newcomer.userId);
  });

  it('refuses unknown products and purchases the store does not know', async () => {
    const buyer = await signUpViaApi(server, appId);
    store.add({ purchaseKey: 'known' });

    expect((await send(buyer, 'known', 'gold')).json().error).toBe('unknown_product');
    expect((await send(buyer, 'unknown')).json().error).toBe('invalid_purchase');
  });

  it('answers 503 while the store is unavailable or not configured', async () => {
    const buyer = await signUpViaApi(server, appId);
    store.add({ purchaseKey: 'known' });
    store.failure = new StoreError('timeout', 'unavailable');

    expect((await send(buyer, 'known')).statusCode).toBe(503);

    clearStoreProvidersForTests();
    expect((await send(buyer, 'known')).json().error).toBe('store_unavailable');
  });
});

describe('lifecycle', () => {
  let server: FastifyInstance;
  let appId: string;
  let store: FakeStore;

  beforeEach(async () => {
    await resetDatabase();
    appId = await seedApp();
    await uploadCatalog(appId, {
      format_version: 1,
      products: [{ store: 'google_play', product_id: 'premium', kind: 'subscription', entitlements: ['premium'] }],
    });
    store = new FakeStore();
    registerStoreProvider(store);
    server = await buildApp();
  });

  afterEach(async () => {
    clearStoreProvidersForTests();
    await server.close();
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

  it('a merge moves purchases to the account', async () => {
    const anonymous = await signUpViaApi(server, appId);
    const account = await signUpViaApi(server, appId);
    const key = await buy(anonymous);

    await db.transaction((tx) => transferPurchasesOnMerge(tx, appId, anonymous.userId, account.userId, new Date()));

    const [row] = await db.select().from(purchases).where(eq(purchases.purchaseKey, key));
    expect(row?.userId).toBe(account.userId);
  });

  it('an account deletion keeps purchases without the person', async () => {
    const buyer = await signUpViaApi(server, appId);
    const key = await buy(buyer);
    await server.inject({ method: 'DELETE', url: '/v1/me', headers: { authorization: `Bearer ${buyer.accessToken}` } });

    await eraseUser(buyer.userId, new Date());

    const [row] = await db.select().from(purchases).where(eq(purchases.purchaseKey, key));
    expect(row).toMatchObject({ userId: null, storeAccountRef: null, storePayload: null, priceMicros: 4_990_000 });
    expect(row?.anonymizedAt).not.toBeNull();
    const history = await db.select().from(purchaseEvents).where(eq(purchaseEvents.purchaseId, row!.id));
    expect(history.every((e) => e.fromUserId === null && e.toUserId === null)).toBe(true);
    expect(history.map((e) => e.kind)).toContain('anonymized');
  });
});