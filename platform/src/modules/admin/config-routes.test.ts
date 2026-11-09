import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminRequests, createTestAdmin } from '../../../test/admin.js';
import { buildAdminApp } from '../../admin-app.js';
import { db, pool } from '../../core/db.js';
import { publishConfig } from '../config/versions-service.js';
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

const schemaV1 = {
  format_version: 1,
  parameters: {
    daily_goal: { type: 'integer', default: 3, min: 1, max: 10 },
    theme: { type: 'enum', default: 'light', values: ['light', 'dark'] },
  },
};

function withLimits(max: number, themes: string[]) {
  return {
    format_version: 1,
    parameters: {
      daily_goal: { type: 'integer', default: 3, min: 1, max },
      theme: { type: 'enum', default: 'light', values: themes },
    },
  };
}

async function createApp(token: string) {
  const slug = `app-${randomUUID().slice(0, 8)}`;
  const res = await authed('POST', '/apps', token, { slug, name: 'Test app' });
  expect(res.statusCode).toBe(201);
  return res.json().app as { id: string; slug: string };
}

async function auditActions(appId: string) {
  const entries = await db
    .select({ action: auditLog.action })
    .from(auditLog)
    .where(eq(auditLog.appId, appId))
    .orderBy(asc(auditLog.id));
  return entries.map((entry) => entry.action);
}

describe('config settings', () => {
  it('uploads parameter schemas the published config still fits', async () => {
    const admin = await createTestAdmin();
    const token = await signIn(admin);
    const app = await createApp(token);
    const url = `/apps/${app.slug}/config-schema`;

    expect((await authed('GET', url, token)).json()).toMatchObject({
      current: null,
      history: [],
      holdout: { percent: 0, configVersion: null, runningExperiments: [] },
    });

    expect((await authed('POST', `${url}/check`, token, { schema: schemaV1 })).json()).toMatchObject({
      status: 'ok',
      nextVersion: 1,
      summary: 'First version · 2 parameters',
    });
    expect((await authed('POST', url, token, { schema: schemaV1 })).statusCode).toBe(201);

    await publishConfig(app.id, { format_version: 1, parameters: { daily_goal: { value: 8 } } });

    // The server value 8 would no longer fit
    const narrowed = withLimits(5, ['light', 'dark']);
    expect((await authed('POST', `${url}/check`, token, { schema: narrowed })).json()).toMatchObject({
      status: 'invalid',
      errors: [{ target: 'daily_goal.value', message: 'above_max (in published config v1)' }],
    });
    const refused = await authed('POST', url, token, { schema: narrowed });
    expect(refused.statusCode).toBe(409);
    expect(refused.json().error).toBe('incompatible_parameter_schema');

    // Widening is allowed with warnings
    const widened = withLimits(20, ['light', 'dark', 'sepia']);
    const check = (await authed('POST', `${url}/check`, token, { schema: widened })).json();
    expect(check).toMatchObject({ status: 'ok', nextVersion: 2 });
    expect(check.warnings.map((warning: { target: string }) => warning.target)).toEqual(['daily_goal', 'theme']);
    expect((await authed('POST', url, token, { schema: widened })).json()).toMatchObject({
      status: 'created',
      version: 2,
    });

    const overview = (await authed('GET', url, token)).json();
    expect(overview.current).toMatchObject({ version: 2, uploadedBy: admin.email });
    expect(overview.history.map((version: { version: number; summary: string }) => [version.version, version.summary])).toEqual([
      [2, '2 other changes'],
      [1, 'First version · 2 parameters'],
    ]);
    expect(await auditActions(app.id)).toEqual(['app.create', 'parameter_schema.upload', 'parameter_schema.upload']);
  });

  it('changes the holdout only while no experiment runs', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/holdout`;

    expect((await authed('PUT', url, token, { percent: 5 })).json()).toEqual({ status: 'created', version: 1 });
    expect((await authed('PUT', url, token, { percent: 60 })).statusCode).toBe(400);
    expect((await authed('GET', `/apps/${app.slug}/config-schema`, token)).json().holdout).toEqual({
      percent: 5,
      configVersion: 1,
      runningExperiments: [],
    });

    await authed('POST', `/apps/${app.slug}/config-schema`, token, { schema: schemaV1 });
    await publishConfig(app.id, {
      format_version: 1,
      holdout: { percent: 5 },
      experiments: {
        theme_test: {
          description: 'Dark theme by default',
          status: 'running',
          layer: 'default',
          traffic: { from: 0, to: 50 },
          variants: {
            light: { weight: 50, values: { theme: 'light' } },
            dark: { weight: 50, values: { theme: 'dark' } },
          },
        },
      },
    });

    expect((await authed('GET', `/apps/${app.slug}/config-schema`, token)).json().holdout.runningExperiments).toEqual([
      'theme_test',
    ]);
    const locked = await authed('PUT', url, token, { percent: 10 });
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error).toBe('invalid_config_change');

    expect(await auditActions(app.id)).toEqual(['app.create', 'config.set_holdout', 'parameter_schema.upload']);
  });

  it('lets product upload schemas and set the holdout', async () => {
    const owner = await signIn(await createTestAdmin());
    const app = await createApp(owner);
    const product = await signIn(await createTestAdmin({ role: 'product', appId: app.id }));

    expect((await authed('POST', `/apps/${app.slug}/config-schema`, product, { schema: schemaV1 })).statusCode).toBe(201);
    expect((await authed('PUT', `/apps/${app.slug}/holdout`, product, { percent: 2.5 })).statusCode).toBe(200);
  });
});