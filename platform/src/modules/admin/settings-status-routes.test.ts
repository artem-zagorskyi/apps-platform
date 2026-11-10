import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminRequests, createTestAdmin } from '../../../test/admin.js';
import { buildAdminApp } from '../../admin-app.js';
import { db, pool } from '../../core/db.js';
import { products } from '../billing/schema.js';

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

async function createApp(token: string) {
  const slug = `app-${randomUUID().slice(0, 8)}`;
  const res = await authed('POST', '/apps', token, { slug, name: 'Test app' });
  expect(res.statusCode).toBe(201);
  return res.json().app as { id: string; slug: string };
}

const statusesOf = (tabs: Record<string, { status: string }>) =>
  Object.fromEntries(Object.entries(tabs).map(([tab, state]) => [tab, state.status]));

describe('settings status', () => {
  it('starts with what is needed before release and follows changes', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/settings-status`;

    expect(statusesOf((await authed('GET', url, token)).json().tabs)).toEqual({
      general: 'configured',
      platforms: 'not_configured',
      'sign-in': 'optional',
      consents: 'not_configured',
      events: 'not_configured',
      config: 'optional',
      subscriptions: 'optional',
      webhooks: 'optional',
    });

    await authed('PUT', `/apps/${app.slug}/platforms/android`, token, { bundleId: `com.test.${app.slug.slice(4)}` });
    await authed('PUT', `/apps/${app.slug}/consent-policy`, token, { mode: 'optional', repromptAfterDays: 180 });
    await authed('PATCH', `/apps/${app.slug}`, token, { status: 'disabled', reason: 'Test' });

    const tabs = statusesOf((await authed('GET', url, token)).json().tabs);
    expect(tabs).toMatchObject({ general: 'error', platforms: 'configured', consents: 'configured' });
  });

  it('marks consent_or_pay without an entitlement on sale', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const [product] = await db
      .insert(products)
      .values({
        appId: app.id,
        store: 'google_play',
        productId: 'premium_monthly',
        kind: 'subscription',
        entitlements: ['ad_free'],
      })
      .returning({ id: products.id });
    await authed('PUT', `/apps/${app.slug}/consent-policy`, token, {
      mode: 'consent_or_pay',
      repromptAfterDays: 180,
      payEntitlement: 'ad_free',
    });

    const url = `/apps/${app.slug}/settings-status`;
    expect((await authed('GET', url, token)).json().tabs.subscriptions.status).toBe('configured');

    await authed('POST', `/apps/${app.slug}/catalog`, token, { catalog: { format_version: 1, products: [] } });
    const tabs = (await authed('GET', url, token)).json().tabs;
    expect(tabs.consents.status).toBe('error');
    expect(tabs.subscriptions.status).toBe('optional');
    expect(product).toBeDefined();
  });

  it('lists visible apps with their settings for Overview', async () => {
    const owner = await signIn(await createTestAdmin());
    const mine = await createApp(owner);
    const other = await createApp(owner);
    const product = await signIn(await createTestAdmin({ role: 'product', appId: mine.id }));

    const overview = (await authed('GET', '/overview', product)).json();
    expect(overview.apps.map((app: { slug: string }) => app.slug)).toEqual([mine.slug]);
    expect(overview.apps[0].tabs.platforms.status).toBe('not_configured');

    const all = (await authed('GET', '/overview', owner)).json();
    expect(all.apps.map((app: { slug: string }) => app.slug)).toEqual(expect.arrayContaining([mine.slug, other.slug]));
  });
});