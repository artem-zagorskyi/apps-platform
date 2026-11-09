import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminRequests, createTestAdmin } from '../../../test/admin.js';
import { buildAdminApp } from '../../admin-app.js';
import { db, pool } from '../../core/db.js';
import { getConsentPolicy } from '../apps/service.js';
import { nextPolicyVersion } from './consents-service.js';
import { auditLog } from './schema.js';

const NOW = new Date('2026-11-09T10:00:00Z');

let server: FastifyInstance;
const { signIn, authed } = adminRequests(() => server);

beforeEach(async () => {
  // Only Date is faked: TOTP codes and policy versions are predictable
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
  const res = await authed('POST', '/apps', token, { slug, name: 'Test app' });
  expect(res.statusCode).toBe(201);
  return res.json().app as { id: string; slug: string };
}

describe('nextPolicyVersion', () => {
  it('uses the date, with a suffix for more versions on the same day', () => {
    expect(nextPolicyVersion(null, NOW)).toBe('2026-11-09');
    expect(nextPolicyVersion('2026-10-29', NOW)).toBe('2026-11-09');
    expect(nextPolicyVersion('2026-11-09', NOW)).toBe('2026-11-09-2');
    expect(nextPolicyVersion('2026-11-09-2', NOW)).toBe('2026-11-09-3');
  });
});

describe('consent policy', () => {
  it('has none until saved, then changes without a new version', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/consent-policy`;

    expect((await authed('GET', url, token)).json()).toEqual({ policy: null, activeInstallations: 0 });

    const created = await authed('PUT', url, token, { mode: 'optional', repromptAfterDays: 180 });
    expect(created.json().policy).toMatchObject({ mode: 'optional', policyVersion: '2026-11-09', repromptAfterDays: 180 });

    const changed = await authed('PUT', url, token, { mode: 'consent_or_pay', repromptAfterDays: 90 });
    expect(changed.json().policy).toMatchObject({
      mode: 'consent_or_pay',
      policyVersion: '2026-11-09',
      repromptAfterDays: 90,
    });

    expect((await authed('PUT', url, token, { mode: 'none', repromptAfterDays: 180 })).statusCode).toBe(400);
    expect((await authed('PUT', url, token, { mode: 'optional', repromptAfterDays: 10 })).statusCode).toBe(400);
  });

  it('is the policy for every country', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    await authed('PUT', `/apps/${app.slug}/consent-policy`, token, { mode: 'optional', repromptAfterDays: 120 });

    for (const country of ['DE', 'UA', 'US', null]) {
      const { policy, configured } = await getConsentPolicy(app.id, country);
      expect(configured).toBe(true);
      expect(policy).toMatchObject({ mode: 'optional', policyVersion: '2026-11-09', repromptAfterDays: 120 });
    }
  });

  it('publishes new versions with a reason and records everything', async () => {
    const token = await signIn(await createTestAdmin());
    const app = await createApp(token);
    const url = `/apps/${app.slug}/consent-policy`;

    expect((await authed('POST', `${url}/new-version`, token, { reason: 'Too early' })).json().error).toBe('no_policy');

    await authed('PUT', url, token, { mode: 'optional', repromptAfterDays: 180 });
    expect((await authed('POST', `${url}/new-version`, token, {})).statusCode).toBe(400);
    const bumped = await authed('POST', `${url}/new-version`, token, { reason: 'New analytics purpose' });
    expect(bumped.json().policy.policyVersion).toBe('2026-11-09-2');

    const entries = await db
      .select({ action: auditLog.action, reason: auditLog.reason })
      .from(auditLog)
      .where(eq(auditLog.appId, app.id))
      .orderBy(asc(auditLog.id));
    expect(entries).toEqual([
      { action: 'app.create', reason: null },
      { action: 'consent_policy.create', reason: null },
      { action: 'consent_policy.new_version', reason: 'New analytics purpose' },
    ]);
  });

  it('lets product read the policy but not change it', async () => {
    const owner = await signIn(await createTestAdmin());
    const app = await createApp(owner);
    const product = await signIn(await createTestAdmin({ role: 'product', appId: app.id }));
    const url = `/apps/${app.slug}/consent-policy`;

    expect((await authed('GET', url, product)).statusCode).toBe(200);
    expect((await authed('PUT', url, product, { mode: 'optional', repromptAfterDays: 180 })).statusCode).toBe(403);
  });
});