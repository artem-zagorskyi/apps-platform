import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp, signUpViaApi } from '../../../test/helpers.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { consentPolicies } from '../apps/schema.js';
import { events } from './events-table.js';
import { clearPlanCache, uploadTrackingPlan } from './plans-service.js';

type Device = Awaited<ReturnType<typeof signUpViaApi>>;

let server: FastifyInstance;
let appId: string;

beforeEach(async () => {
  await resetDatabase();
  clearPlanCache();
  appId = await seedApp();
  server = await buildApp();
});

afterEach(async () => {
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: randomUUID(),
    name: 'app_opened',
    occurredAt: new Date().toISOString(),
    sessionId: randomUUID(),
    seq: 1,
    appVersion: '1.0.0',
    appBuild: '1',
    osVersion: '15',
    properties: { cold_start: true },
    ...overrides,
  };
}

function send(device: Device, batch: unknown[], sentAt = new Date().toISOString()) {
  return server.inject({
    method: 'POST',
    url: '/v1/events',
    headers: { authorization: `Bearer ${device.accessToken}` },
    payload: { sentAt, events: batch },
  });
}

async function grantAnalytics(device: Device, granted = true) {
  const now = new Date().toISOString();
  await server.inject({
    method: 'POST',
    url: '/v1/consent',
    headers: { authorization: `Bearer ${device.accessToken}` },
    payload: {
      decisions: { analytics: granted, personalization: false },
      policyVersion: 'v1',
      source: 'first_launch',
      decidedAt: now,
      sentAt: now,
    },
  });
}

async function storedEvents(device: Device) {
  return db.select().from(events).where(eq(events.userId, device.userId));
}

describe('POST /v1/events', () => {
  it('stores events with context from the token and the category from the plan', async () => {
    const device = await signUpViaApi(server, appId);
    await grantAnalytics(device);
    const sent = event();

    const res = await send(device, [sent]);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ accepted: [sent.eventId], rejected: [] });

    const [row] = await storedEvents(device);
    expect(row).toMatchObject({
      eventId: sent.eventId,
      appId,
      installationId: device.installationId,
      platform: 'android',
      category: 'analytics',
      valid: true,
      properties: { cold_start: true },
    });
  });

  it('corrects the event time by the device clock error', async () => {
    const device = await signUpViaApi(server, appId);
    await grantAnalytics(device);
    const hour = 60 * 60 * 1000;
    // The phone clock is one hour behind; the event happened 5 minutes ago
    const phoneNow = Date.now() - hour;

    await send(
      device,
      [event({ occurredAt: new Date(phoneNow - 5 * 60 * 1000).toISOString() })],
      new Date(phoneNow).toISOString(),
    );

    const [row] = await storedEvents(device);
    const expected = Date.now() - 5 * 60 * 1000;
    expect(Math.abs(row!.occurredAt.getTime() - expected)).toBeLessThan(5_000);
    expect(row!.clientOccurredAt.getTime()).toBe(phoneNow - 5 * 60 * 1000);
  });

  it('never stores an event in the future', async () => {
    const device = await signUpViaApi(server, appId);
    await grantAnalytics(device);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

    await send(device, [event({ occurredAt: tomorrow })]);

    const [row] = await storedEvents(device);
    expect(row!.occurredAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('stores a resent event once', async () => {
    const device = await signUpViaApi(server, appId);
    await grantAnalytics(device);
    const sent = event();

    await send(device, [sent]);
    // A retry after a lost response, with a different clock correction
    const retry = await send(device, [sent, sent], new Date(Date.now() - 1000).toISOString());

    expect(retry.json().accepted).toEqual([sent.eventId]);
    expect(await storedEvents(device)).toHaveLength(1);
  });

  it('stores events that do not match the plan, flagged as invalid', async () => {
    const device = await signUpViaApi(server, appId);
    await grantAnalytics(device);

    const res = await send(device, [
      event({ properties: { cold_start: 'yes' } }),
      event({ name: 'lesson_completed', properties: {} }),
    ]);

    expect(res.json().accepted).toHaveLength(2);
    const rows = await storedEvents(device);
    expect(rows.every((row) => !row.valid)).toBe(true);
    expect(rows.map((row) => row.invalidReason).sort()).toEqual([
      'not_boolean:cold_start',
      'unknown_event',
    ]);
  });

  it('accepts app events once the app uploads its plan', async () => {
    await uploadTrackingPlan(appId, {
      format_version: 1,
      events: {
        lesson_completed: {
          category: 'analytics',
          description: 'The person finished a lesson',
          properties: { mistakes: { type: 'integer', required: true, min: 0 } },
        },
      },
    });
    const device = await signUpViaApi(server, appId);
    await grantAnalytics(device);

    await send(device, [event({ name: 'lesson_completed', properties: { mistakes: 2 } })]);

    const [row] = await storedEvents(device);
    expect(row?.valid).toBe(true);
  });

  it('rejects analytics events without consent and stores nothing', async () => {
    const device = await signUpViaApi(server, appId);
    const sent = event();

    const res = await send(device, [sent]);

    expect(res.json()).toEqual({
      accepted: [],
      rejected: [{ eventId: sent.eventId, reason: 'no_consent' }],
    });
    expect(await storedEvents(device)).toHaveLength(0);
  });

  it('rejects analytics events after consent is withdrawn', async () => {
    const device = await signUpViaApi(server, appId);
    await grantAnalytics(device);
    await grantAnalytics(device, false);

    const res = await send(device, [event()]);

    expect(res.json().rejected[0].reason).toBe('no_consent');
  });

  it('stores analytics without a decision where no consent screen is needed', async () => {
    await db.update(consentPolicies).set({ mode: 'none' }).where(eq(consentPolicies.appId, appId));
    const device = await signUpViaApi(server, appId);

    await send(device, [event()]);

    expect(await storedEvents(device)).toHaveLength(1);
  });

  it('rejects an empty or oversized batch', async () => {
    const device = await signUpViaApi(server, appId);

    expect((await send(device, [])).statusCode).toBe(400);
    expect((await send(device, Array.from({ length: 101 }, () => event()))).statusCode).toBe(400);
  });

  it('requires an access token', async () => {
    const res = await server.inject({
      method: 'POST',
      url: '/v1/events',
      payload: { sentAt: new Date().toISOString(), events: [event()] },
    });

    expect(res.statusCode).toBe(401);
  });
});