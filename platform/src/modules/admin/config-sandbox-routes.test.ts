import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { adminRequests, createTestAdmin } from '../../../test/admin.js';
import { buildAdminApp } from '../../admin-app.js';
import { db, pool } from '../../core/db.js';
import { activityDays, authIdentities, consents, installations, users } from '../identity/schema.js';

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
  parameters: { daily_goal: { type: 'integer', default: 15, min: 5, max: 120 } },
};

// Goal 20; 25 with a linked account; 30 in Austria
const DOCUMENT = {
  format_version: 1,
  parameters: {
    daily_goal: {
      value: 20,
      rules: [
        { when: { linked: true }, value: 25 },
        { when: { countries: ['AT'] }, value: 30 },
      ],
    },
  },
};

async function createApp(token: string) {
  const slug = `app-${randomUUID().slice(0, 8)}`;
  const res = await authed('POST', '/apps', token, { slug, name: 'Sandbox test' });
  expect(res.statusCode).toBe(201);
  await authed('PUT', `/apps/${slug}/platforms/android`, token, { bundleId: `com.test.app${slug.slice(4)}` });
  expect((await authed('POST', `/apps/${slug}/config-schema`, token, { schema: SCHEMA })).statusCode).toBe(201);
  await authed('PUT', `/apps/${slug}/config/draft`, token, { baseVersion: null, document: DOCUMENT });
  expect((await authed('POST', `/apps/${slug}/config/publish`, token, { comment: 'Goals' })).json()).toMatchObject({ version: 1 });
  return res.json().app as { id: string; slug: string };
}

async function createUser(appId: string, country: string | null) {
  const [user] = await db.insert(users).values({ appId }).returning({ id: users.id });
  const installationId = randomUUID();
  await db.insert(installations).values({
    id: installationId,
    appId,
    userId: user!.id,
    platform: 'android',
    appVersion: '1.4.0',
    appBuild: '14',
    osVersion: '15',
    country,
  });
  return { userId: user!.id, installationId };
}

const goal = (body: { explanation: { parameters: { name: string; value: unknown; source: object }[] } }) =>
  body.explanation.parameters.find((p) => p.name === 'daily_goal');

describe('config sandbox', () => {
  it('explains the config of a real user from their installation', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/config/sandbox`;
    const { userId, installationId } = await createUser(app.id, 'AT');

    const austria = (await authed('POST', url, token, { config: 'live', user: { kind: 'id', userId } })).json();
    expect(austria).toMatchObject({
      config: { kind: 'live', version: 1 },
      user: { id: userId, mergedFrom: null, linked: [], installationId },
      context: { platform: 'android', appVersion: '1.4.0', country: 'AT', linked: false },
    });
    expect(goal(austria)).toMatchObject({ value: 30, source: { kind: 'rule', index: 1 } });

    await db.insert(authIdentities).values({ appId: app.id, userId, provider: 'google', providerSubject: `sub-${userId}` });
    const linked = (await authed('POST', url, token, { config: 'live', user: { kind: 'id', userId } })).json();
    expect(linked.user.linked).toEqual(['google']);
    expect(goal(linked)).toMatchObject({ value: 25, source: { kind: 'rule', index: 0 } });

    const unknown = await authed('POST', url, token, { config: 'live', user: { kind: 'id', userId: randomUUID() } });
    expect(unknown.json().error).toBe('user_not_found');
  });

  it('explains a described user against the draft', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/config/sandbox`;
    const user = { kind: 'manual', platform: 'android', appVersion: '1.4.0', country: 'DE', linked: false };

    expect((await authed('POST', url, token, { config: 'draft', user })).json().error).toBe('no_draft');

    const draft = { ...DOCUMENT, parameters: { daily_goal: { ...DOCUMENT.parameters.daily_goal, value: 40 } } };
    await authed('PUT', `/apps/${app.slug}/config/draft`, token, { baseVersion: 1, document: draft });

    const live = (await authed('POST', url, token, { config: 'live', user })).json();
    const drafted = (await authed('POST', url, token, { config: 'draft', user })).json();
    expect(live.user).toBeNull();
    expect(goal(live)).toMatchObject({ value: 20, source: { kind: 'value' } });
    expect(drafted.config).toEqual({ kind: 'draft', baseVersion: 1 });
    expect(goal(drafted)?.value).toBe(40);

    expect((await authed('POST', url, token, { config: 'live', user: { ...user, country: 'Germany' } })).statusCode).toBe(400);
  });

  it('uses built-in traits only with personalization consent', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/config/sandbox`;
    const { userId, installationId } = await createUser(app.id, 'DE');
    await db.insert(activityDays).values({
      appId: app.id,
      day: new Date(Date.now() - 86_400_000).toISOString().slice(0, 10),
      installationId,
      platform: 'android',
    });
    const body = { config: 'live', user: { kind: 'id', userId } };

    const before = (await authed('POST', url, token, body)).json();
    expect(before.context).toMatchObject({ osVersion: '15', providers: [], traits: null });

    await db.insert(consents).values({
      appId: app.id,
      userId,
      installationId,
      purpose: 'personalization',
      granted: true,
      policyVersion: '1',
      region: '*',
      source: 'first_launch',
    });
    const after = (await authed('POST', url, token, body)).json();
    expect(after.context.traits).toMatchObject({ daysSinceInstall: 0, streakDays: 2, subscription: 'none', hasPurchased: false });
  });

  it('takes the traits of a described user', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const traits = {
      daysSinceInstall: 40,
      daysSinceLastVisit: 20,
      activeDays7: 1,
      activeDays28: 2,
      streakDays: 1,
      engagement: 'returning',
      subscription: 'expired',
      entitlements: [],
      hasPurchased: true,
      daysSinceSubscriptionEnded: 9,
      language: 'de',
      notificationsEnabled: null,
      lowMemoryDevice: null,
      localHour: 20,
      installSource: null,
    };
    const user = { kind: 'manual', platform: 'android', appVersion: '1.4.0', country: 'DE', linked: false, signIn: 'google', traits };
    const res = (await authed('POST', `/apps/${app.slug}/config/sandbox`, token, { config: 'live', user })).json();
    expect(res.context).toMatchObject({ providers: ['google'], linked: true, traits: { engagement: 'returning' } });

    const wrong = { ...user, traits: { ...traits, engagement: 'sleepy' } };
    expect((await authed('POST', `/apps/${app.slug}/config/sandbox`, token, { config: 'live', user: wrong })).statusCode).toBe(400);
  });

  it('lets viewers use the sandbox', async () => {
    const owner = await signIn(await createTestAdmin());
    const app = await createApp(owner);
    const viewer = await signIn(await createTestAdmin({ role: 'viewer', appId: app.id }));
    const user = { kind: 'manual', platform: 'android', appVersion: '1.0.0', country: null, linked: false };
    expect((await authed('POST', `/apps/${app.slug}/config/sandbox`, viewer, { config: 'live', user })).statusCode).toBe(200);
  });
});
