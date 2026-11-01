import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp, signUpViaApi } from '../../../test/helpers.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { uploadCatalog } from './catalog.js';
import { computeEntitlements, grantsAccess, type PurchaseWithEntitlements } from './entitlements.js';
import { purchases } from './schema.js';
import type { PurchaseState } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date('2026-11-01T12:00:00.000Z');
const inDays = (days: number) => new Date(now.getTime() + days * DAY_MS);

function purchase(overrides: Partial<PurchaseWithEntitlements> = {}): PurchaseWithEntitlements {
  return {
    store: 'google_play',
    productId: 'premium',
    state: 'active',
    expiresAt: inDays(30),
    autoRenewing: true,
    entitlements: ['premium'],
    ...overrides,
  };
}

describe('grantsAccess', () => {
  it.each<[PurchaseState, Date | null, boolean]>([
    ['active', inDays(1), true],
    ['active', inDays(-1), false],
    ['canceled', inDays(1), true],
    ['canceled', inDays(-1), false],
    ['grace_period', inDays(-1), true],
    ['pending', inDays(30), false],
    ['on_hold', inDays(30), false],
    ['paused', inDays(30), false],
    ['expired', inDays(30), false],
    ['refunded', inDays(30), false],
  ])('%s until %s grants access: %s', (state, expiresAt, expected) => {
    expect(grantsAccess({ state, expiresAt }, now)).toBe(expected);
  });
});

describe('computeEntitlements', () => {
  it('takes the purchase that lasts longest for each entitlement', () => {
    const result = computeEntitlements(
      [
        purchase({ productId: 'premium_monthly', expiresAt: inDays(10) }),
        purchase({ productId: 'premium_yearly', expiresAt: inDays(300), entitlements: ['premium', 'no_ads'] }),
        purchase({ productId: 'old', state: 'expired', expiresAt: inDays(-5) }),
      ],
      now,
    );

    expect(result.map((e) => [e.key, e.productId])).toEqual([
      ['no_ads', 'premium_yearly'],
      ['premium', 'premium_yearly'],
    ]);
  });

  it('reports whether the access renews', () => {
    const [renewing] = computeEntitlements([purchase()], now);
    const [ending] = computeEntitlements([purchase({ state: 'canceled', autoRenewing: false })], now);

    expect(renewing?.willRenew).toBe(true);
    expect(ending?.willRenew).toBe(false);
  });
});

describe('GET /v1/billing/entitlements', () => {
  let server: FastifyInstance;
  let appId: string;

  beforeEach(async () => {
    await resetDatabase();
    appId = await seedApp();
    await uploadCatalog(appId, {
      format_version: 1,
      products: [{ store: 'google_play', product_id: 'premium', kind: 'subscription', entitlements: ['premium'] }],
    });
    server = await buildApp();
  });

  afterEach(async () => {
    await server.close();
  });

  afterAll(async () => {
    await pool.end();
  });

  async function insertPurchase(userId: string, overrides: Partial<typeof purchases.$inferInsert> = {}) {
    await db.insert(purchases).values({
      appId,
      userId,
      store: 'google_play',
      purchaseKey: randomUUID(),
      productId: 'premium',
      state: 'active',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * DAY_MS),
      autoRenewing: true,
      ...overrides,
    });
  }

  function getEntitlements(accessToken: string) {
    return server.inject({
      method: 'GET',
      url: '/v1/billing/entitlements',
      headers: { authorization: `Bearer ${accessToken}` },
    });
  }

  it("returns the user's entitlements only", async () => {
    const buyer = await signUpViaApi(server, appId);
    const other = await signUpViaApi(server, appId);
    await insertPurchase(buyer.userId);
    await insertPurchase(other.userId, { state: 'expired', expiresAt: new Date(Date.now() - DAY_MS) });

    const mine = await getEntitlements(buyer.accessToken);
    const theirs = await getEntitlements(other.accessToken);

    expect(mine.statusCode).toBe(200);
    expect(mine.json().entitlements).toEqual([
      expect.objectContaining({ key: 'premium', productId: 'premium', state: 'active', willRenew: true }),
    ]);
    expect(theirs.json().entitlements).toEqual([]);
  });

  it('grants nothing for products missing from the catalog', async () => {
    const buyer = await signUpViaApi(server, appId);
    await insertPurchase(buyer.userId, { productId: 'unknown_product' });

    expect((await getEntitlements(buyer.accessToken)).json().entitlements).toEqual([]);
  });
});