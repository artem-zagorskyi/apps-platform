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
  it('lists entries newest first, filtered and in pages', async () => {
    const admin = await createTestAdmin();
    const token = await signIn(admin);
    const app = await createApp(token);
    await authed('PATCH', `/apps/${app.slug}`, token, { name: 'Renamed' });
    await authed('PATCH', `/apps/${app.slug}`, token, { status: 'disabled', reason: 'Testing the log' });

    const first = (await authed('GET', `/audit-log?app=${app.slug}&limit=2`, token)).json();
    expect(first.entries.map((e: Entry) => e.action)).toEqual(['app.update', 'app.update']);
    expect(first.entries[0]).toMatchObject({
      reason: 'Testing the log',
      admin: { email: admin.email },
      app: { slug: app.slug, name: 'Renamed' },
    });
    expect(first.nextBefore).toBe(first.entries[1].id);

    const second = (await authed('GET', `/audit-log?app=${app.slug}&limit=2&before=${first.nextBefore}`, token)).json();
    expect(second.entries.map((e: Entry) => e.action)).toEqual(['app.create']);
    expect(second.nextBefore).toBeNull();

    const created = (await authed('GET', `/audit-log?app=${app.slug}&action=app.create`, token)).json();
    expect(created.entries).toHaveLength(1);

    const future = (await authed('GET', `/audit-log?app=${app.slug}&from=2999-01-01`, token)).json();
    expect(future.entries).toEqual([]);

    const filters = (await authed('GET', '/audit-log/filters', token)).json();
    expect(filters.actions).toContain('app.create');
    expect(filters.apps).toContainEqual({ slug: app.slug, name: 'Renamed' });
  });

  it('is for owners of every app only', async () => {
    const owner = await signIn(await createTestAdmin());
    const app = await createApp(owner);
    const product = await signIn(await createTestAdmin({ role: 'product', appId: app.id }));

    expect((await authed('GET', '/audit-log', product)).statusCode).toBe(403);
    expect((await authed('GET', '/audit-log/filters', product)).statusCode).toBe(403);
    expect((await authed('GET', '/audit-log?app=no-such-app', owner)).json()).toEqual({
      entries: [],
      nextBefore: null,
    });
  });
});