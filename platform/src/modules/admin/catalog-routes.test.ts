import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminRequests, createTestAdmin } from '../../../test/admin.js';
import { buildAdminApp } from '../../admin-app.js';
import { db, pool } from '../../core/db.js';
import { purchases } from '../billing/schema.js';
import { auditLog } from './schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let server: FastifyInstance;
const { signIn, authed } = adminRequests(() => server);

beforeEach(async () => {
  server = await buildAdminApp();
});

afterEach(async () => {
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

function product(productId: string, entitlements: string[]) {
  return { store: 'google_play', product_id: productId, kind: 'subscription', entitlements };
}

const catalogV1 = {
  format_version: 1,
  products: [product('premium_monthly', ['premium', 'ad_free']), product('premium_yearly', ['premium', 'ad_free'])],
};

// premium_monthly stops giving ad_free; premium_yearly leaves the catalog
const catalogV2 = { format_version: 1, products: [product('premium_monthly', ['premium'])] };

async function createApp(token: string) {
  const slug = `app-${randomUUID().slice(0, 8)}`;
  const res = await authed('POST', '/apps', token, { slug, name: 'Test app' });
  expect(res.statusCode).toBe(201);
  return res.json().app as { id: string; slug: string };
}

describe('catalog settings', () => {
  it('checks a catalog, uploads versions and warns about lost access', async () => {
    const admin = await createTestAdmin();
    const token = await signIn(admin);
    const app = await createApp(token);
    const url = `/apps/${app.slug}/catalog`;

    expect((await authed('GET', url, token)).json()).toEqual({
      currentVersion: null,
      products: [],
      entitlements: [],
      history: [],
    });

    expect((await authed('POST', `${url}/check`, token, { catalog: catalogV1 })).json()).toMatchObject({
      status: 'ok',
      nextVersion: 1,
      summary: 'First catalog · 2 products',
    });
    const first = await authed('POST', url, token, { catalog: catalogV1 });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ status: 'created', version: 1, added: 2 });

    // Someone with access through premium_monthly
    await db.insert(purchases).values({
      appId: app.id,
      store: 'google_play',
      purchaseKey: randomUUID(),
      productId: 'premium_monthly',
      state: 'active',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + DAY_MS),
      autoRenewing: true,
    });

    const check = (await authed('POST', `${url}/check`, token, { catalog: catalogV2 })).json();
    expect(check).toMatchObject({ status: 'ok', nextVersion: 2, summary: '1 updated · 1 archived' });
    expect(check.warnings).toEqual([
      expect.objectContaining({
        target: 'google_play:premium_monthly',
        message: expect.stringContaining('1 purchase with access loses ad_free'),
      }),
    ]);
    expect(check.changes).toContainEqual(expect.objectContaining({ kind: 'archived', target: 'google_play:premium_yearly' }));

    expect((await authed('POST', url, token, { catalog: catalogV2 })).statusCode).toBe(201);
    const same = await authed('POST', url, token, { catalog: catalogV2 });
    expect(same.statusCode).toBe(200);
    expect(same.json()).toMatchObject({ status: 'unchanged', version: 2 });

    const overview = (await authed('GET', url, token)).json();
    expect(overview.currentVersion).toBe(2);
    expect(overview.products).toMatchObject([
      { productId: 'premium_monthly', entitlements: ['premium'], archivedAt: null, withAccess: 1 },
      { productId: 'premium_yearly', withAccess: 0 },
    ]);
    expect(overview.products[1].archivedAt).not.toBeNull();
    expect(overview.history).toMatchObject([
      { version: 2, uploadedBy: admin.email, summary: '1 updated · 1 archived' },
      { version: 1, summary: 'First catalog · 2 products' },
    ]);

    const entries = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.appId, app.id))
      .orderBy(asc(auditLog.id));
    expect(entries.map((entry) => entry.action)).toEqual(['app.create', 'catalog.upload', 'catalog.upload']);
  });

  it('reports a product listed twice and refuses to upload it', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const twice = { format_version: 1, products: [product('premium', ['premium']), product('premium', ['ad_free'])] };

    expect((await authed('POST', `/apps/${app.slug}/catalog/check`, token, { catalog: twice })).json()).toMatchObject({
      status: 'invalid',
      errors: [{ target: 'google_play:premium', message: 'listed twice' }],
    });
    expect((await authed('POST', `/apps/${app.slug}/catalog`, token, { catalog: twice })).json().error).toBe(
      'invalid_catalog',
    );
  });

  it('lets product upload the catalog', async () => {
    const owner = await signIn(await createTestAdmin());
    const app = await createApp(owner);
    const product_ = await signIn(await createTestAdmin({ role: 'product', appId: app.id }));

    expect((await authed('POST', `/apps/${app.slug}/catalog`, product_, { catalog: catalogV1 })).statusCode).toBe(201);
  });
});