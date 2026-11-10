import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminRequests, createTestAdmin } from '../../../test/admin.js';
import { buildAdminApp } from '../../admin-app.js';
import { pool } from '../../core/db.js';
import { getActiveConfig } from '../config/versions-service.js';

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
  parameters: {
    daily_goal: { type: 'integer', default: 15, min: 5, max: 120 },
    banner: { type: 'string', default: '', max_length: 20 },
  },
};

const doc = (parameters: object) => ({ format_version: 1, parameters });

async function createApp(token: string) {
  const slug = `app-${randomUUID().slice(0, 8)}`;
  const res = await authed('POST', '/apps', token, { slug, name: 'Config test' });
  expect(res.statusCode).toBe(201);
  expect((await authed('POST', `/apps/${slug}/config-schema`, token, { schema: SCHEMA })).statusCode).toBe(201);
  return res.json().app as { id: string; slug: string };
}

describe('config draft', () => {
  it('collects edits, checks them and publishes them as the next version', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/config`;

    const empty = (await authed('GET', url, token)).json();
    expect(empty).toMatchObject({ live: null, draft: null });
    expect(empty.conditionFields.rules.map((f: { key: string }) => f.key)).toContain('countries');
    expect(empty.schema.parameters.daily_goal.type).toBe('integer');

    // First draft, then a value that does not fit
    const first = await authed('PUT', `${url}/draft`, token, { baseVersion: null, document: doc({ daily_goal: { value: 20 } }) });
    expect(first.statusCode).toBe(200);
    expect(first.json().draft).toMatchObject({
      baseVersion: null,
      stale: false,
      errors: [],
      changes: [{ path: 'parameters.daily_goal.value', kind: 'added', after: 20 }],
    });

    const tooLong = await authed('PUT', `${url}/draft`, token, {
      baseVersion: null,
      document: doc({ daily_goal: { value: 20 }, banner: { value: 'x'.repeat(30) } }),
    });
    expect(tooLong.json().draft.errors).toEqual(['parameters.banner.value: too_long']);
    expect((await authed('POST', `${url}/publish`, token, { comment: 'Too long' })).statusCode).toBe(400);

    // Another admin's draft is not overwritten by a stale editor
    const seen = tooLong.json().draft.updatedAt as string;
    const fixed = await authed('PUT', `${url}/draft`, token, {
      baseVersion: null,
      expectedUpdatedAt: seen,
      document: doc({ daily_goal: { value: 20 }, banner: { value: 'Go Premium' } }),
    });
    expect(fixed.json().draft.errors).toEqual([]);
    const stale = await authed('PUT', `${url}/draft`, token, { baseVersion: null, expectedUpdatedAt: seen, document: doc({}) });
    expect(stale.json().error).toBe('draft_changed');

    expect((await authed('POST', `${url}/publish`, token, {})).statusCode).toBe(400);
    const published = await authed('POST', `${url}/publish`, token, { comment: 'First values' });
    expect(published.json()).toEqual({ status: 'created', version: 1 });

    const after = (await authed('GET', url, token)).json();
    expect(after).toMatchObject({ live: { version: 1, comment: 'First values' }, draft: null });
    expect((await getActiveConfig(app.id))?.document.parameters).toEqual({
      daily_goal: { value: 20 },
      banner: { value: 'Go Premium' },
    });
  });

  it('refuses a draft older than the live version until it is rebased', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/config`;

    await authed('PUT', `${url}/draft`, token, { baseVersion: null, document: doc({ daily_goal: { value: 20 } }) });
    await authed('POST', `${url}/publish`, token, { comment: 'v1' });

    // A draft on v1, then v2 is published with another holdout
    await authed('PUT', `${url}/draft`, token, { baseVersion: 1, document: doc({ daily_goal: { value: 25 } }) });
    expect((await authed('PUT', `/apps/${app.slug}/holdout`, token, { percent: 5 })).json()).toMatchObject({ version: 2 });

    const behind = (await authed('GET', url, token)).json();
    expect(behind.draft.stale).toBe(true);
    expect((await authed('POST', `${url}/publish`, token, { comment: 'Too late' })).json().error).toBe('stale_draft');

    const rebased = (await authed('POST', `${url}/draft/rebase`, token)).json();
    expect(rebased.conflicts).toEqual([]);
    expect(rebased.draft).toMatchObject({ baseVersion: 2, stale: false });
    expect(rebased.draft.document.holdout.percent).toBe(5);
    expect(rebased.draft.document.parameters.daily_goal).toEqual({ value: 25 });

    expect((await authed('POST', `${url}/publish`, token, { comment: 'Goal 25' })).json()).toEqual({ status: 'created', version: 3 });
  });

  it('lists, compares and restores versions', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/config`;

    for (const [value, base] of [[20, null], [30, 1]] as const) {
      await authed('PUT', `${url}/draft`, token, { baseVersion: base, document: doc({ daily_goal: { value } }) });
      await authed('POST', `${url}/publish`, token, { comment: `Goal ${value}` });
    }

    const { versions } = (await authed('GET', `${url}/versions`, token)).json();
    expect(versions).toMatchObject([
      { version: 2, comment: 'Goal 30', changes: 1 },
      { version: 1, comment: 'Goal 20', changes: 1 },
    ]);
    expect((await authed('GET', `${url}/compare?from=1&to=2`, token)).json().changes).toEqual([
      { path: 'parameters.daily_goal.value', kind: 'changed', before: 20, after: 30 },
    ]);
    expect((await authed('GET', `${url}/versions/1`, token)).json().document.parameters.daily_goal).toEqual({ value: 20 });

    const restored = (await authed('POST', `${url}/versions/1/restore`, token, {})).json();
    expect(restored.draft).toMatchObject({ baseVersion: 2, changes: [{ path: 'parameters.daily_goal.value', before: 30, after: 20 }] });
    expect((await authed('POST', `${url}/versions/1/restore`, token, {})).json().error).toBe('draft_exists');

    expect((await authed('DELETE', `${url}/draft`, token)).statusCode).toBe(204);
    expect((await authed('GET', url, token)).json().draft).toBeNull();
  });

  it('lets viewers read the config but not change it', async () => {
    const owner = await signIn(await createTestAdmin());
    const app = await createApp(owner);
    const viewer = await signIn(await createTestAdmin({ role: 'viewer', appId: app.id }));
    const url = `/apps/${app.slug}/config`;

    expect((await authed('GET', url, viewer)).statusCode).toBe(200);
    expect((await authed('PUT', `${url}/draft`, viewer, { baseVersion: null, document: doc({}) })).statusCode).toBe(403);
  });
});
