import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminRequests, createTestAdmin } from '../../../test/admin.js';
import { buildAdminApp } from '../../admin-app.js';
import { pool } from '../../core/db.js';

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

type Entry = { id: string; action: string };

describe('audit log', () => {
  it('lists entries newest first, filtered, searched and in pages', async () => {
    const admin = await createTestAdmin();
    const token = await signIn(admin);
    const app = await createApp(token);
    await authed('PATCH', `/apps/${app.slug}`, token, { name: 'Renamed' });
    await authed('PATCH', `/apps/${app.slug}`, token, { status: 'disabled', reason: 'Testing_the 100% log' });

    const first = (await authed('GET', `/audit-log?app=${app.slug}&limit=2`, token)).json();
    expect(first).toMatchObject({ total: 3, page: 1, limit: 2 });
    expect(first.entries.map((e: Entry) => e.action)).toEqual(['app.update', 'app.update']);
    expect(first.entries[0]).toMatchObject({
      reason: 'Testing_the 100% log',
      admin: { email: admin.email },
      app: { slug: app.slug, name: 'Renamed', status: 'disabled' },
    });

    const second = (await authed('GET', `/audit-log?app=${app.slug}&limit=2&page=2`, token)).json();
    expect(second.entries.map((e: Entry) => e.action)).toEqual(['app.create']);

    // % and _ are searched as typed
    const found = (await authed('GET', `/audit-log?app=${app.slug}&q=${encodeURIComponent('_the 100%')}`, token)).json();
    expect(found.total).toBe(1);
    expect((await authed('GET', `/audit-log?app=${app.slug}&q=nothing-like-this`, token)).json().total).toBe(0);

    const created = (await authed('GET', `/audit-log?app=${app.slug}&action=app.create&period=7d`, token)).json();
    expect(created.total).toBe(1);

    const platform = (await authed('GET', '/audit-log?app=_platform&period=all', token)).json();
    expect(platform.entries.every((e: { app: unknown }) => e.app === null)).toBe(true);

    const filters = (await authed('GET', '/audit-log/filters', token)).json();
    expect(filters.actions).toContain('app.create');
    expect(filters.apps).toContainEqual({ slug: app.slug, name: 'Renamed', status: 'disabled' });

    expect((await authed('GET', '/audit-log?period=1y', token)).statusCode).toBe(400);
  });

  it('lists admins with their roles and state', async () => {
    const owner = await createTestAdmin();
    const token = await signIn(owner);
    const app = await createApp(token);
    const product = await createTestAdmin({ role: 'product', appId: app.id });

    const { admins } = (await authed('GET', '/admins', token)).json();
    expect(admins.find((a: { email: string }) => a.email === owner.email)).toMatchObject({
      status: 'active',
      roles: [{ role: 'owner', app: null }],
      activeSessions: 1,
    });
    expect(admins.find((a: { email: string }) => a.email === product.email)).toMatchObject({
      roles: [{ role: 'product', app: { slug: app.slug } }],
      activeSessions: 0,
    });
    expect(JSON.stringify(admins)).not.toMatch(/passwordHash|totpSecret/);
  });

  it('is for owners of every app only', async () => {
    const owner = await signIn(await createTestAdmin());
    const app = await createApp(owner);
    const product = await signIn(await createTestAdmin({ role: 'product', appId: app.id }));

    for (const path of ['/audit-log', '/audit-log/filters', '/admins']) {
      expect((await authed('GET', path, product)).statusCode).toBe(403);
    }
    expect((await authed('GET', '/audit-log?app=no-such-app', owner)).json()).toMatchObject({ entries: [], total: 0 });
  });
});
