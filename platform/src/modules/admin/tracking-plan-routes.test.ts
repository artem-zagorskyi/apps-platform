import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminRequests, createTestAdmin } from '../../../test/admin.js';
import { buildAdminApp } from '../../admin-app.js';
import { db, pool } from '../../core/db.js';
import type { TrackingPlan } from '../events/plan.js';
import { auditLog } from './schema.js';

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

const v1: TrackingPlan = {
  format_version: 1,
  events: {
    lesson_completed: {
      category: 'analytics',
      description: 'The person finished a lesson',
      properties: {
        mistakes: { type: 'integer', required: true, min: 0 },
        note: { type: 'string', required: false, max_length: 64 },
      },
    },
  },
};

// A new event, a deprecated property and a shorter string limit
const v2: TrackingPlan = {
  format_version: 1,
  events: {
    lesson_completed: {
      category: 'analytics',
      description: 'The person finished a lesson',
      properties: {
        mistakes: { type: 'integer', required: true, min: 0, deprecated: true },
        note: { type: 'string', required: false, max_length: 32 },
      },
    },
    lesson_started: { category: 'analytics', description: 'The person opened a lesson', properties: {} },
  },
};

async function createApp(token: string) {
  const slug = `app-${randomUUID().slice(0, 8)}`;
  const res = await authed('POST', '/apps', token, { slug, name: 'Test app' });
  expect(res.statusCode).toBe(201);
  return res.json().app as { id: string; slug: string };
}

describe('tracking plan settings', () => {
  it('checks a plan without storing it and uploads numbered versions', async () => {
    const admin = await createTestAdmin();
    const token = await signIn(admin);
    const app = await createApp(token);
    const url = `/apps/${app.slug}/tracking-plan`;

    const empty = (await authed('GET', url, token)).json();
    expect(empty).toMatchObject({ current: null, history: [] });
    expect(Object.keys(empty.platform.events)).toContain('app_opened');

    expect((await authed('POST', `${url}/check`, token, { plan: v1 })).json()).toMatchObject({
      status: 'ok',
      currentVersion: null,
      nextVersion: 1,
      errors: [],
      summary: 'First version · 1 event',
    });
    expect((await authed('GET', url, token)).json().current).toBeNull();

    const first = await authed('POST', url, token, { plan: v1 });
    expect(first.statusCode).toBe(201);
    expect(first.json()).toMatchObject({ status: 'created', version: 1 });

    const check = (await authed('POST', `${url}/check`, token, { plan: v2 })).json();
    expect(check).toMatchObject({ status: 'ok', currentVersion: 1, nextVersion: 2 });
    expect(check.changes).toContainEqual({ kind: 'added', target: 'lesson_started', detail: 'analytics, 0 properties' });
    expect(check.changes).toContainEqual({ kind: 'deprecated', target: 'lesson_completed.mistakes' });
    expect(check.warnings).toEqual([expect.objectContaining({ target: 'lesson_completed.note' })]);

    expect((await authed('POST', url, token, { plan: v2 })).statusCode).toBe(201);

    const same = await authed('POST', url, token, { plan: v2 });
    expect(same.statusCode).toBe(200);
    expect(same.json()).toMatchObject({ status: 'unchanged', version: 2 });

    const overview = (await authed('GET', url, token)).json();
    expect(overview.current).toMatchObject({ version: 2, uploadedBy: admin.email });
    expect(overview.history.map((version: { version: number; summary: string }) => [version.version, version.summary])).toEqual([
      [2, '1 event added · 1 deprecated · 1 other change'],
      [1, 'First version · 1 event'],
    ]);

    const entries = await db
      .select({ action: auditLog.action })
      .from(auditLog)
      .where(eq(auditLog.appId, app.id))
      .orderBy(asc(auditLog.id));
    expect(entries.map((entry) => entry.action)).toEqual(['app.create', 'tracking_plan.upload', 'tracking_plan.upload']);
  });

  it('reports invalid and breaking plans and refuses to upload them', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/tracking-plan`;

    const badName = { format_version: 1, events: { LessonDone: { category: 'analytics', description: 'x', properties: {} } } };
    expect((await authed('POST', `${url}/check`, token, { plan: badName })).json()).toMatchObject({
      status: 'invalid',
      errors: [{ target: 'LessonDone', message: 'name must be snake_case' }],
    });

    const clash = { format_version: 1, events: { app_opened: { category: 'analytics', description: 'x', properties: {} } } };
    expect((await authed('POST', url, token, { plan: clash })).json().error).toBe('invalid_tracking_plan');

    await authed('POST', url, token, { plan: v1 });
    const removed = { format_version: 1, events: {} };
    expect((await authed('POST', `${url}/check`, token, { plan: removed })).json()).toMatchObject({
      status: 'invalid',
      nextVersion: null,
      errors: [{ target: 'lesson_completed', message: 'removed; mark it deprecated instead' }],
    });
    const refused = await authed('POST', url, token, { plan: removed });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('incompatible_tracking_plan');
  });

  it('lets product upload plans', async () => {
    const owner = await signIn(await createTestAdmin());
    const app = await createApp(owner);
    const product = await signIn(await createTestAdmin({ role: 'product', appId: app.id }));

    expect((await authed('POST', `/apps/${app.slug}/tracking-plan`, product, { plan: v1 })).statusCode).toBe(201);
  });
});