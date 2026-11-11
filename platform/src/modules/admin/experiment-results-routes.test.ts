import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminRequests, createTestAdmin } from '../../../test/admin.js';
import { buildAdminApp } from '../../admin-app.js';
import { db, pool } from '../../core/db.js';
import { sql } from 'drizzle-orm';

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

const SCHEMA = {
  format_version: 1,
  parameters: { paywall: { type: 'string', default: 'a', max_length: 20 } },
};

const DOCUMENT = {
  format_version: 1,
  layers: ['main'],
  experiments: {
    paywall_test: {
      description: 'Trial first',
      status: 'running',
      layer: 'main',
      traffic: { from: 0, to: 100 },
      primary_metric: 'purchase',
      guardrail_metrics: [{ metric: 'retention:d1' }],
      variants: { control: { weight: 50, values: { paywall: 'a' } }, trial: { weight: 50, values: { paywall: 'b' } } },
    },
  },
};

async function startExperiment(token: string) {
  const slug = `app-${randomUUID().slice(0, 8)}`;
  const res = await authed('POST', '/apps', token, { slug, name: 'Results test' });
  expect(res.statusCode).toBe(201);
  expect((await authed('POST', `/apps/${slug}/config-schema`, token, { schema: SCHEMA })).statusCode).toBe(201);
  await authed('PUT', `/apps/${slug}/config/draft`, token, { baseVersion: null, document: DOCUMENT });
  expect((await authed('POST', `/apps/${slug}/config/publish`, token, { comment: 'Start' })).json()).toMatchObject({ version: 1 });
  const live = (await authed('GET', `/apps/${slug}/config`, token)).json().live;
  return { app: res.json().app as { id: string; slug: string }, startedAt: new Date(live.document.experiments.paywall_test.started_at) };
}

async function track(appId: string, userId: string, name: string, at: Date, properties: object = {}) {
  await db.execute(sql`
    insert into events.events (
      event_id, app_id, user_id, installation_id, seq, name, category,
      occurred_at, client_occurred_at, received_at,
      platform, app_version, app_build, os_version, country, properties, valid
    ) values (
      ${randomUUID()}, ${appId}, ${userId}, ${randomUUID()}, 1, ${name}, 'analytics',
      ${at}, ${at}, ${at},
      'android', '1.0.0', '1', '15', 'DE', ${JSON.stringify(properties)}::jsonb, true
    )
  `);
}

describe('experiment results', () => {
  it('shows exposures and conversions of a running experiment and lists it in the summary', async () => {
    const token = await signIn(await createTestAdmin());
    const { app, startedAt } = await startExperiment(token);
    const after = (ms: number) => new Date(startedAt.getTime() + ms);

    for (let i = 0; i < 10; i++) {
      for (const variant of ['control', 'trial']) {
        const userId = randomUUID();
        await track(app.id, userId, 'experiment_exposed', after(1), { experiment: 'paywall_test', variant });
        if (i < (variant === 'trial' ? 6 : 2)) await track(app.id, userId, 'purchase', after(2));
      }
    }

    const results = (await authed('GET', `/apps/${app.slug}/config/experiments/paywall_test/results`, token)).json();
    expect(results.variants.map((v: { variant: string; users: number; conversions: number }) => [v.variant, v.users, v.conversions])).toEqual([
      ['control', 10, 2],
      ['trial', 10, 6],
    ]);
    expect(results.metrics.map((m: { metric: string; role: string }) => [m.metric, m.role])).toEqual([
      ['purchase', 'primary'],
      ['retention:d1', 'guardrail'],
    ]);
    expect(results.cuts.platform[0]).toMatchObject({ value: 'android' });
    expect(results.exposures.variants.trial.at(-1)).toBe(10);

    const { experiments } = (await authed('GET', `/apps/${app.slug}/config/experiments/summary`, token)).json();
    expect(experiments).toMatchObject([{ key: 'paywall_test', status: 'running', users: 20, leader: { variant: 'trial' } }]);

    expect((await authed('GET', `/apps/${app.slug}/config/experiments/nope/results`, token)).statusCode).toBe(404);
  });

  it('lets viewers read results, and an app without config has no experiments', async () => {
    const owner = await signIn(await createTestAdmin());
    const slug = `app-${randomUUID().slice(0, 8)}`;
    const res = await authed('POST', '/apps', owner, { slug, name: 'Empty' });
    const viewer = await signIn(await createTestAdmin({ role: 'viewer', appId: res.json().app.id }));
    const summary = await authed('GET', `/apps/${slug}/config/experiments/summary`, viewer);
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toEqual({ experiments: [] });
  });
});
