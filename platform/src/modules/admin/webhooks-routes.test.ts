import { randomUUID } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { adminRequests, createTestAdmin } from '../../../test/admin.js';
import { buildAdminApp } from '../../admin-app.js';
import { db, pool } from '../../core/db.js';
import { deliveries } from '../webhooks/schema.js';
import { signWebhook } from '../webhooks/service.js';
import { auditLog } from './schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

let server: FastifyInstance;
const { signIn, authed } = adminRequests(() => server);

// A stand-in app backend that records what it receives
let receiver: Server;
let received: { headers: IncomingHttpHeaders; body: string }[] = [];
let respondWith = 204;

beforeAll(async () => {
  receiver = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      received.push({ headers: req.headers, body });
      res.statusCode = respondWith;
      res.end();
    });
  });
  await new Promise<void>((resolve) => receiver.listen(0, '127.0.0.1', resolve));
});

beforeEach(async () => {
  server = await buildAdminApp();
  received = [];
  respondWith = 204;
});

afterEach(async () => {
  await server.close();
});

afterAll(async () => {
  await new Promise((resolve) => receiver.close(resolve));
  await pool.end();
});

function receiverUrl() {
  return `http://127.0.0.1:${(receiver.address() as AddressInfo).port}/hooks`;
}

async function createApp(token: string) {
  const slug = `app-${randomUUID().slice(0, 8)}`;
  const res = await authed('POST', '/apps', token, { slug, name: 'Test app' });
  expect(res.statusCode).toBe(201);
  return res.json().app as { id: string; slug: string };
}

describe('webhook settings', () => {
  it('keeps the secret when the URL changes and issues new ones on request', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/webhook`;

    expect((await authed('GET', url, token)).json()).toMatchObject({
      endpoint: null,
      stats: { delivered7d: 0, notDelivered7d: 0, successRate7d: null, waitingForUrl: 0 },
      recent: [],
    });

    const created = await authed('PUT', url, token, { url: 'https://backend.example/hooks' });
    expect(created.headers['cache-control']).toBe('no-store');
    const { secret } = created.json();
    expect(secret).toMatch(/^whsec_/);

    const changed = await authed('PUT', url, token, { url: 'https://backend.example/v2/hooks' });
    expect(changed.json().secret).toBeNull();

    const rotated = (await authed('POST', `${url}/rotate-secret`, token)).json().secret;
    expect(rotated).toMatch(/^whsec_/);
    expect(rotated).not.toBe(secret);

    expect((await authed('GET', url, token)).json().endpoint).toMatchObject({
      url: 'https://backend.example/v2/hooks',
    });
    expect((await authed('PUT', url, token, { url: 'not a url' })).json().error).toBe('invalid_webhook_url');

    expect((await authed('DELETE', url, token, {})).statusCode).toBe(400);
    expect((await authed('DELETE', url, token, { reason: 'Backend retired' })).statusCode).toBe(204);
    expect((await authed('DELETE', url, token, { reason: 'Again' })).json().error).toBe('no_endpoint');

    const entries = await db
      .select({ action: auditLog.action, reason: auditLog.reason, before: auditLog.before, after: auditLog.after })
      .from(auditLog)
      .where(eq(auditLog.appId, app.id))
      .orderBy(asc(auditLog.id));
    expect(entries.map((entry) => entry.action)).toEqual([
      'app.create',
      'webhook.create',
      'webhook.update_url',
      'webhook.rotate_secret',
      'webhook.remove',
    ]);
    // Secrets never reach the audit log
    expect(JSON.stringify(entries)).not.toContain(secret);
    expect(JSON.stringify(entries)).not.toContain(rotated);
  });

  it('counts deliveries and queues the waiting ones again once a URL is set', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/webhook`;

    await db.insert(deliveries).values([
      { appId: app.id, type: 'user.merged', payload: {}, deliveredAt: new Date(), attempts: 1, lastStatus: 200 },
      { appId: app.id, type: 'user.deleted', payload: {}, lastError: 'no_endpoint' },
      // Too old to be sent once a URL appears
      { appId: app.id, type: 'user.deleted', payload: {}, lastError: 'no_endpoint', createdAt: new Date(Date.now() - 8 * DAY_MS) },
    ]);

    const overview = (await authed('GET', url, token)).json();
    expect(overview.stats).toEqual({ delivered7d: 1, notDelivered7d: 0, successRate7d: 1, waitingForUrl: 1 });
    expect(overview.recent.map((delivery: { status: string }) => delivery.status).sort()).toEqual([
      'delivered',
      'no_endpoint',
      'no_endpoint',
    ]);

    const created = await authed('PUT', url, token, { url: 'https://backend.example/hooks' });
    expect(created.json().requeued).toBe(1);
  });

  it('sends a signed test notification without storing it', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/webhook`;

    expect((await authed('POST', `${url}/test`, token)).json().error).toBe('no_endpoint');

    const { secret } = (await authed('PUT', url, token, { url: receiverUrl() })).json();
    const ok = (await authed('POST', `${url}/test`, token)).json();
    expect(ok).toMatchObject({ ok: true, httpStatus: 204, error: null });

    const last = received.at(-1)!;
    expect(JSON.parse(last.body)).toMatchObject({ type: 'test', appId: app.id });
    const signature = String(last.headers['x-platform-signature']);
    const timestamp = Number(/t=(\d+)/.exec(signature)?.[1]);
    expect(signature).toBe(signWebhook(secret, timestamp, last.body));

    respondWith = 500;
    expect((await authed('POST', `${url}/test`, token)).json()).toMatchObject({
      ok: false,
      httpStatus: 500,
      error: 'HTTP 500',
    });

    expect(await db.$count(deliveries, eq(deliveries.appId, app.id))).toBe(0);
  });

  it('lets product read the webhook but not change it', async () => {
    const owner = await signIn(await createTestAdmin());
    const app = await createApp(owner);
    const product = await signIn(await createTestAdmin({ role: 'product', appId: app.id }));
    const url = `/apps/${app.slug}/webhook`;

    expect((await authed('GET', url, product)).statusCode).toBe(200);
    expect((await authed('PUT', url, product, { url: 'https://backend.example/hooks' })).statusCode).toBe(403);
  });
});