import { randomBytes } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp, signUpViaApi } from '../../../test/helpers.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { rejectionCounts } from './schema.js';

type Device = Awaited<ReturnType<typeof signUpViaApi>>;

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

// Event ids are UUID v7, as the SDK makes them
function uuidv7(): string {
  const hex = Date.now().toString(16).padStart(12, '0') + randomBytes(10).toString('hex');
  const variant = ((Number.parseInt(hex.charAt(16), 16) & 3) | 8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function sendOpens(device: Device, appVersion: string, count: number) {
  const now = new Date().toISOString();
  return server.inject({
    method: 'POST',
    url: '/v1/events',
    headers: { authorization: `Bearer ${device.accessToken}` },
    payload: {
      sentAt: now,
      events: Array.from({ length: count }, (_, i) => ({
        eventId: uuidv7(),
        name: 'app_opened',
        occurredAt: now,
        sessionId: null,
        seq: i + 1,
        appVersion,
        appBuild: '1',
        osVersion: '15',
        properties: { cold_start: true },
      })),
    },
  });
}

async function counts() {
  const rows = await db.select().from(rejectionCounts).where(eq(rejectionCounts.appId, appId));
  return rows
    .map(({ day, reason, platform, appVersion, count }) => ({ day, reason, platform, appVersion, count }))
    .sort((a, b) => a.appVersion.localeCompare(b.appVersion));
}

describe('rejection counts', () => {
  it('counts analytics events refused for lack of consent per day, platform and app version', async () => {
    const device = await signUpViaApi(server, appId);

    const first = await sendOpens(device, '1.0.0', 3);
    await sendOpens(device, '1.0.0', 2);
    await sendOpens(device, '1.1.0', 1);

    expect(first.json().rejected).toHaveLength(3);
    const day = new Date().toISOString().slice(0, 10);
    expect(await counts()).toEqual([
      { day, reason: 'no_consent', platform: 'android', appVersion: '1.0.0', count: 5 },
      { day, reason: 'no_consent', platform: 'android', appVersion: '1.1.0', count: 1 },
    ]);
  });

  it('counts nothing when the events are accepted', async () => {
    const device = await signUpViaApi(server, appId);
    const now = new Date().toISOString();
    const consent = await server.inject({
      method: 'POST',
      url: '/v1/consent',
      headers: { authorization: `Bearer ${device.accessToken}` },
      payload: {
        decisions: { analytics: true, personalization: false },
        policyVersion: 'v1',
        source: 'first_launch',
        decidedAt: now,
        sentAt: now,
      },
    });
    expect(consent.statusCode).toBe(200);

    const res = await sendOpens(device, '1.0.0', 2);

    expect(res.json()).toMatchObject({ rejected: [] });
    expect(await counts()).toEqual([]);
  });
});