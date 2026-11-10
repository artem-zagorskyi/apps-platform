import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminRequests, createTestAdmin } from '../../../test/admin.js';
import { buildAdminApp } from '../../admin-app.js';
import { db, pool } from '../../core/db.js';
import { purchaseEvents, purchases } from '../billing/schema.js';
import { presence } from '../events/schema.js';
import { activityDays, installations, users } from '../identity/schema.js';

const NOW = new Date('2026-11-10T12:00:00Z');
const at = (iso: string) => new Date(iso);

let server: FastifyInstance;
const { signIn, authed } = adminRequests(() => server);

beforeEach(async () => {
  // Only Date is faked: TOTP codes and "today" are predictable
  vi.useFakeTimers({ toFake: ['Date'], now: NOW });
  server = await buildAdminApp();
});

afterEach(async () => {
  await server.close();
  vi.useRealTimers();
});

afterAll(async () => {
  await pool.end();
});

async function createApp(token: string) {
  const slug = `app-${randomUUID().slice(0, 8)}`;
  const res = await authed('POST', '/apps', token, { slug, name: 'Overview test' });
  expect(res.statusCode).toBe(201);
  const app = res.json().app as { id: string; slug: string };
  await authed('PUT', `/apps/${slug}/platforms/android`, token, { bundleId: `com.test.app${slug.slice(4)}` });
  return app;
}

async function install(appId: string, createdAt: Date, activeDays: string[]) {
  const [user] = await db.insert(users).values({ appId }).returning({ id: users.id });
  const id = randomUUID();
  await db.insert(installations).values({
    id,
    appId,
    userId: user!.id,
    platform: 'android',
    appVersion: '1.0.0',
    appBuild: '1',
    osVersion: '15',
    createdAt,
  });
  for (const day of activeDays) {
    await db.insert(activityDays).values({ appId, day, installationId: id, platform: 'android' });
  }
  return { id, userId: user!.id };
}

describe('overview', () => {
  it('counts installs, active users, retention, store numbers and live users', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);

    // A: installed 1 Nov, back on day 7. B: 5 Nov, back on day 1. C: 5 Nov, never back. D: an hour ago.
    const a = await install(app.id, at('2026-11-01T09:00:00Z'), ['2026-11-01', '2026-11-08']);
    await install(app.id, at('2026-11-05T09:00:00Z'), ['2026-11-05', '2026-11-06']);
    await install(app.id, at('2026-11-05T10:00:00Z'), ['2026-11-05']);
    await install(app.id, at('2026-11-10T11:00:00Z'), []);

    const [purchase] = await db
      .insert(purchases)
      .values({
        appId: app.id,
        userId: a.userId,
        store: 'google_play',
        purchaseKey: randomUUID(),
        productId: 'premium_monthly',
        state: 'active',
        startedAt: at('2026-11-09T12:00:00Z'),
        expiresAt: at('2026-12-09T12:00:00Z'),
        autoRenewing: true,
        priceMicros: 4_990_000,
        currency: 'EUR',
      })
      .returning({ id: purchases.id });
    await db.insert(purchaseEvents).values({
      appId: app.id,
      purchaseId: purchase!.id,
      kind: 'registered',
      source: 'client',
      occurredAt: at('2026-11-09T12:00:00Z'),
    });
    await db.insert(presence).values({
      installationId: a.id,
      appId: app.id,
      platform: 'android',
      country: 'DE',
      city: 'Fulda',
      lat: 50.55,
      lon: 9.68,
      lastSeenAt: at('2026-11-10T11:55:00Z'),
    });

    const res = await authed('GET', `/overview?app=${app.slug}`, token);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const { metrics, attention } = body.apps[0];

    expect(metrics.installs24h).toMatchObject({ value: 1 });
    expect(metrics.installs7d).toMatchObject({ value: 3 });
    expect(metrics.wau).toMatchObject({ value: 3 });
    expect(metrics.mau).toMatchObject({ value: 3 });
    expect(metrics.dau.spark).toHaveLength(14);
    expect(metrics.retentionD1).toMatchObject({ value: 0.5, cohort: 2 });
    expect(metrics.retentionD7).toMatchObject({ value: 1, cohort: 1 });
    expect(metrics.subscribers).toMatchObject({ value: 1 });
    expect(metrics.revenue7d).toEqual([{ currency: 'EUR', value: 4.99, previous: 0 }]);

    expect(attention).toContainEqual({ kind: 'setup_incomplete', severity: 'warning', tabs: ['consents', 'events'] });
    expect(body.live).toMatchObject({ total: 1, points: [{ city: 'Fulda', count: 1, appSlug: app.slug }] });
    expect(body.recentChanges.map((entry: { action: string }) => entry.action)).toContain('app.create');
  });

  it('gives every app the admin can see, and recent changes to owners only', async () => {
    const owner = await signIn(await createTestAdmin());
    const mine = await createApp(owner);
    await createApp(owner);
    const product = await signIn(await createTestAdmin({ role: 'product', appId: mine.id }));

    const all = (await authed('GET', '/overview', product)).json();
    expect(all.apps.map((app: { slug: string }) => app.slug)).toEqual([mine.slug]);
    expect(all.recentChanges).toBeNull();

    expect((await authed('GET', '/overview?app=no-such-app', product)).statusCode).toBe(404);
  });
});
