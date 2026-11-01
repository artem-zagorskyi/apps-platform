import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp } from '../../../test/helpers.js';
import { db, pool } from '../../core/db.js';
import { uploadCatalog } from './catalog.js';
import { products } from './schema.js';

let appId: string;

beforeEach(async () => {
  await resetDatabase();
  appId = await seedApp();
});

afterAll(async () => {
  await pool.end();
});

const product = (productId: string, entitlements = ['premium']) => ({
  store: 'google_play' as const,
  product_id: productId,
  kind: 'subscription' as const,
  entitlements,
});

const catalog = (...items: ReturnType<typeof product>[]) => ({ format_version: 1, products: items });

async function stored() {
  const rows = await db.select().from(products).where(eq(products.appId, appId));
  return Object.fromEntries(rows.map((p) => [p.productId, { entitlements: p.entitlements, archived: p.archivedAt !== null }]));
}

describe('uploadCatalog', () => {
  it('adds, updates and leaves unchanged', async () => {
    expect(await uploadCatalog(appId, catalog(product('monthly'), product('yearly')))).toEqual({
      added: 2,
      updated: 0,
      archived: 0,
      unchanged: 0,
    });

    const second = await uploadCatalog(appId, catalog(product('monthly'), product('yearly', ['premium', 'no_ads'])));

    expect(second).toEqual({ added: 0, updated: 1, archived: 0, unchanged: 1 });
    expect((await stored()).yearly).toEqual({ entitlements: ['no_ads', 'premium'], archived: false });
  });

  it('archives products missing from the file and brings them back', async () => {
    await uploadCatalog(appId, catalog(product('monthly'), product('yearly')));

    expect((await uploadCatalog(appId, catalog(product('monthly')))).archived).toBe(1);
    expect((await stored()).yearly?.archived).toBe(true);

    expect((await uploadCatalog(appId, catalog(product('monthly'), product('yearly')))).updated).toBe(1);
    expect((await stored()).yearly?.archived).toBe(false);
  });

  it.each([
    ['an unknown store', { format_version: 1, products: [{ ...product('a'), store: 'steam' }] }],
    ['an invalid product id', catalog(product('has space'))],
    ['an entitlement that is not snake_case', catalog(product('a', ['Premium']))],
    ['no entitlements', catalog(product('a', []))],
    ['a product listed twice', catalog(product('a'), product('a'))],
    ['an unknown key', { format_version: 1, products: [{ ...product('a'), price: 5 }] }],
  ])('refuses %s', async (_, json) => {
    await expect(uploadCatalog(appId, json)).rejects.toMatchObject({ statusCode: 400, code: 'invalid_catalog' });
  });
});