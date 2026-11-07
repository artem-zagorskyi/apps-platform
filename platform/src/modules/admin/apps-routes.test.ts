import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminRequests, createTestAdmin } from '../../../test/admin.js';
import { buildAdminApp } from '../../admin-app.js';
import { db, pool } from '../../core/db.js';
import { auditLog } from './schema.js';

let server: FastifyInstance;
const { signIn, authed } = adminRequests(() => server);

beforeEach(async () => {
  // Only Date is faked, so TOTP codes are predictable
  vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
  server = await buildAdminApp();
});

afterEach(async () => {
  await server.close();
  vi.useRealTimers();
});

afterAll(async () => {
  await pool.end();
});

function uniqueSlug(): string {
  return `app-${randomUUID().slice(0, 8)}`;
}

async function createApp(token: string, slug = uniqueSlug()) {
  const res = await authed('POST', '/apps', token, { slug, name: 'Test app' });
  expect(res.statusCode).toBe(201);
  return res.json().app as { id: string; slug: string; name: string; status: string };
}

function auditOf(appId: string) {
  return db
    .select({ action: auditLog.action, reason: auditLog.reason, before: auditLog.before, after: auditLog.after })
    .from(auditLog)
    .where(eq(auditLog.appId, appId))
    .orderBy(asc(auditLog.id));
}

describe('creating apps', () => {
  it('creates an app and records it in the audit log', async () => {
    const token = await signIn(await createTestAdmin());
    const created = await createApp(token);

    const res = await authed('GET', `/apps/${created.slug}`, token);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      app: { slug: created.slug, name: 'Test app', status: 'active' },
      platforms: [],
    });
    expect(await auditOf(created.id)).toEqual([
      expect.objectContaining({ action: 'app.create', after: { slug: created.slug, name: 'Test app' } }),
    ]);
  });

  it('rejects a reserved, malformed or taken slug', async () => {
    const token = await signIn(await createTestAdmin());
    const taken = await createApp(token);

    for (const slug of ['all', 'Upper-case', 'ab', '1starts-with-digit', 'ends-with-dash-']) {
      const res = await authed('POST', '/apps', token, { slug, name: 'X' });
      expect(res.statusCode, slug).toBe(400);
    }

    const duplicate = await authed('POST', '/apps', token, { slug: taken.slug, name: 'X' });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error).toBe('slug_taken');
  });

  it('lets only owners of every app create apps', async () => {
    const owner = await signIn(await createTestAdmin());
    const existing = await createApp(owner);
    const ownerOfOne = await signIn(await createTestAdmin({ role: 'owner', appId: existing.id }));
    const product = await signIn(await createTestAdmin({ role: 'product', appId: null }));

    for (const token of [ownerOfOne, product]) {
      const res = await authed('POST', '/apps', token, { slug: uniqueSlug(), name: 'X' });
      expect(res.statusCode).toBe(403);
    }
  });
});

describe('updating apps', () => {
  it('renames, disables only with a reason and records before and after', async () => {
    const token = await signIn(await createTestAdmin());
    const created = await createApp(token);
    const url = `/apps/${created.slug}`;

    expect((await authed('PATCH', url, token, { name: 'Renamed' })).json().app.name).toBe('Renamed');
    expect((await authed('PATCH', url, token, { status: 'disabled' })).statusCode).toBe(400);
    const disabled = await authed('PATCH', url, token, { status: 'disabled', reason: 'Replaced by v2' });
    expect(disabled.json().app.status).toBe('disabled');

    const entries = await auditOf(created.id);
    expect(entries.slice(1)).toEqual([
      expect.objectContaining({
        action: 'app.update',
        before: { name: 'Test app', status: 'active' },
        after: { name: 'Renamed', status: 'active' },
      }),
      expect.objectContaining({
        action: 'app.update',
        reason: 'Replaced by v2',
        before: { name: 'Renamed', status: 'active' },
        after: { name: 'Renamed', status: 'disabled' },
      }),
    ]);
  });

  it('hides apps without a role and refuses changes without an editing role', async () => {
    const owner = await signIn(await createTestAdmin());
    const mine = await createApp(owner);
    const other = await createApp(owner);
    const product = await signIn(await createTestAdmin({ role: 'product', appId: mine.id }));

    expect((await authed('GET', `/apps/${mine.slug}`, product)).statusCode).toBe(200);
    expect((await authed('GET', `/apps/${other.slug}`, product)).statusCode).toBe(404);
    expect((await authed('PATCH', `/apps/${mine.slug}`, product, { name: 'Nope' })).statusCode).toBe(403);
  });
});

describe('app platforms', () => {
  it('adds and changes the package name, recording real changes only', async () => {
    const token = await signIn(await createTestAdmin());
    const created = await createApp(token);
    const url = `/apps/${created.slug}/platforms/android`;
    const base = `com.example.${created.slug.replaceAll('-', '_')}`;

    expect((await authed('PUT', url, token, { bundleId: `${base}.first` })).statusCode).toBe(200);
    expect((await authed('PUT', url, token, { bundleId: `${base}.second` })).statusCode).toBe(200);
    // The same value again changes nothing
    expect((await authed('PUT', url, token, { bundleId: `${base}.second` })).statusCode).toBe(200);

    const res = await authed('GET', `/apps/${created.slug}`, token);
    expect(res.json().platforms).toEqual([
      expect.objectContaining({ platform: 'android', bundleId: `${base}.second` }),
    ]);
    expect((await auditOf(created.id)).map((entry) => entry.action)).toEqual([
      'app.create',
      'app.platform.add',
      'app.platform.update',
    ]);
  });

  it('rejects malformed ids and ids of another app', async () => {
    const token = await signIn(await createTestAdmin());
    const first = await createApp(token);
    const second = await createApp(token);
    const bundleId = `com.example.${first.slug.replaceAll('-', '_')}`;

    for (const malformed of ['example', 'com..example', '1com.example', 'com.exa mple']) {
      const res = await authed('PUT', `/apps/${first.slug}/platforms/android`, token, { bundleId: malformed });
      expect(res.statusCode, malformed).toBe(400);
    }

    expect((await authed('PUT', `/apps/${first.slug}/platforms/android`, token, { bundleId })).statusCode).toBe(200);
    const conflict = await authed('PUT', `/apps/${second.slug}/platforms/android`, token, { bundleId });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toBe('bundle_id_taken');

    // The same id on the other platform is a different identity
    expect((await authed('PUT', `/apps/${first.slug}/platforms/ios`, token, { bundleId })).statusCode).toBe(200);
  });
});