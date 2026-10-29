import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp, signUpViaApi } from '../../../test/helpers.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { consentPolicies } from '../apps/schema.js';

type Device = Awaited<ReturnType<typeof signUpViaApi>>;

const DAY_MS = 24 * 60 * 60 * 1000;

let server: FastifyInstance;
let appId: string;

beforeEach(async () => {
  await resetDatabase();
  appId = await seedApp();
  server = await buildApp();
});

afterEach(async () => {
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

function getConsent(device: Device) {
  return server.inject({
    method: 'GET',
    url: '/v1/consent',
    headers: { authorization: `Bearer ${device.accessToken}` },
  });
}

function postConsent(device: Device, overrides: Record<string, unknown> = {}) {
  const now = new Date().toISOString();
  return server.inject({
    method: 'POST',
    url: '/v1/consent',
    headers: { authorization: `Bearer ${device.accessToken}` },
    payload: {
      decisions: { analytics: true, personalization: true },
      policyVersion: 'v1',
      source: 'first_launch',
      decidedAt: now,
      sentAt: now,
      ...overrides,
    },
  });
}

describe('GET /v1/consent', () => {
  it('asks a new user to decide', async () => {
    const device = await signUpViaApi(server, appId);

    const res = await getConsent(device);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      policy: { region: '*', mode: 'optional', version: 'v1' },
      status: 'needs_decision',
      decisions: [],
      canAskAgainAt: null,
    });
  });

  it('asks everyone when the app has no policy', async () => {
    await db.delete(consentPolicies).where(eq(consentPolicies.appId, appId));
    const device = await signUpViaApi(server, appId);

    const body = (await getConsent(device)).json();

    expect(body.policy).toEqual({ region: '*', mode: 'optional', version: '0' });
    expect(body.status).toBe('needs_decision');
  });

  it('does not ask where the policy is none', async () => {
    await db.update(consentPolicies).set({ mode: 'none' }).where(eq(consentPolicies.appId, appId));
    const device = await signUpViaApi(server, appId);

    expect((await getConsent(device)).json().status).toBe('not_required');
  });

  it('asks again after the policy version changes', async () => {
    const device = await signUpViaApi(server, appId);
    await postConsent(device);

    await db
      .update(consentPolicies)
      .set({ policyVersion: 'v2' })
      .where(eq(consentPolicies.appId, appId));

    expect((await getConsent(device)).json().status).toBe('needs_decision');
  });
});

describe('POST /v1/consent', () => {
  it('records decisions for every purpose', async () => {
    const device = await signUpViaApi(server, appId);

    const res = await postConsent(device, {
      decisions: { analytics: true, personalization: false },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('decided');
    expect(body.decisions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ purpose: 'analytics', granted: true, policyVersion: 'v1' }),
        expect.objectContaining({ purpose: 'personalization', granted: false, policyVersion: 'v1' }),
      ]),
    );
  });

  it('needs both purposes before the status is decided', async () => {
    const device = await signUpViaApi(server, appId);

    const body = (await postConsent(device, { decisions: { analytics: true } })).json();

    expect(body.status).toBe('needs_decision');
  });

  it('the latest decision wins', async () => {
    const device = await signUpViaApi(server, appId);
    await postConsent(device);

    const body = (
      await postConsent(device, { decisions: { analytics: false }, source: 'settings' })
    ).json();

    const analytics = body.decisions.find((d: { purpose: string }) => d.purpose === 'analytics');
    expect(analytics.granted).toBe(false);
  });

  it('allows asking again after a refusal only once the re-prompt period passes', async () => {
    const device = await signUpViaApi(server, appId);

    const body = (
      await postConsent(device, { decisions: { analytics: false, personalization: false } })
    ).json();

    const decidedAt = Date.parse(body.decisions[0].decidedAt);
    expect(Date.parse(body.canAskAgainAt)).toBe(decidedAt + 180 * DAY_MS);
  });

  it('corrects the decision time by the device clock error', async () => {
    const device = await signUpViaApi(server, appId);
    const hour = 60 * 60 * 1000;
    // The phone clock is one hour behind; the decision was made 10 minutes ago
    const phoneNow = Date.now() - hour;

    const body = (
      await postConsent(device, {
        decidedAt: new Date(phoneNow - 10 * 60 * 1000).toISOString(),
        sentAt: new Date(phoneNow).toISOString(),
      })
    ).json();

    const decidedAt = Date.parse(body.decisions[0].decidedAt);
    const expected = Date.now() - 10 * 60 * 1000;
    expect(Math.abs(decidedAt - expected)).toBeLessThan(5_000);
  });

  it('never records a decision in the future', async () => {
    const device = await signUpViaApi(server, appId);
    const tomorrow = new Date(Date.now() + DAY_MS).toISOString();

    const body = (await postConsent(device, { decidedAt: tomorrow })).json();

    expect(Date.parse(body.decisions[0].decidedAt)).toBeLessThanOrEqual(Date.now());
  });

  it('rejects a request without decisions', async () => {
    const device = await signUpViaApi(server, appId);

    const res = await postConsent(device, { decisions: {} });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
  });

  it('requires an access token', async () => {
    const res = await server.inject({ method: 'GET', url: '/v1/consent' });

    expect(res.statusCode).toBe(401);
  });
});