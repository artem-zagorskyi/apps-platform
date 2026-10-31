import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FAKE_GOOGLE_CLIENT_ID, installFakeGoogle, signFakeGoogleToken } from '../../../test/fake-google.js';
import { resetDatabase, seedApp, signUpViaApi } from '../../../test/helpers.js';
import { queuedJobs } from '../../../test/jobs.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { oauthClients } from '../apps/schema.js';
import { events } from '../events/events-table.js';
import { deliveries } from '../webhooks/schema.js';
import { deleteOldConsents, ERASE_JOB, eraseOverdueUsers, eraseUser } from './deletion.js';
import { authIdentities, consents, sessions, users } from './schema.js';

type Device = Awaited<ReturnType<typeof signUpViaApi>>;

const DAY_MS = 24 * 60 * 60 * 1000;

let server: FastifyInstance;
let appId: string;

beforeAll(() => {
  installFakeGoogle();
});

beforeEach(async () => {
  await resetDatabase();
  appId = await seedApp();
  await db.insert(oauthClients).values({
    appId,
    platform: 'android',
    provider: 'google',
    clientId: FAKE_GOOGLE_CLIENT_ID,
  });
  queuedJobs.length = 0;
  server = await buildApp();
});

afterEach(async () => {
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

const auth = (accessToken: string) => ({ authorization: `Bearer ${accessToken}` });

function deleteAccount(accessToken: string) {
  return server.inject({ method: 'DELETE', url: '/v1/me', headers: auth(accessToken) });
}

async function googleToken(device: Device, subject: string): Promise<string> {
  const res = await server.inject({ method: 'POST', url: '/v1/auth/nonce', headers: auth(device.accessToken) });
  return signFakeGoogleToken({ subject, nonce: res.json().nonce });
}

function postGoogle(device: Device, idToken: string, mergeStrategy?: string) {
  return server.inject({
    method: 'POST',
    url: '/v1/auth/google',
    headers: auth(device.accessToken),
    payload: { idToken, ...(mergeStrategy && { mergeStrategy }) },
  });
}

function refresh(refreshToken: string) {
  return server.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refreshToken } });
}

// The owner of Google account g-1, and a second device whose anonymous user
// was merged into the owner
async function mergedPair() {
  const owner = await signUpViaApi(server, appId);
  expect((await postGoogle(owner, await googleToken(owner, 'g-1'))).json().result).toBe('linked');

  const second = await signUpViaApi(server, appId);
  const idToken = await googleToken(second, 'g-1');
  await postGoogle(second, idToken);
  const merged = await postGoogle(second, idToken, 'keep_target');
  expect(merged.json().result).toBe('signed_in');

  return { owner, second, secondRefreshToken: merged.json().tokens.refreshToken as string };
}

async function storeEvent(userId: string, installationId: string, sessionId: string): Promise<string> {
  const eventId = randomUUID();
  const now = new Date();
  await db.insert(events).values({
    eventId,
    appId,
    userId,
    installationId,
    sessionId,
    seq: 1,
    name: 'app_opened',
    category: 'analytics',
    occurredAt: now,
    clientOccurredAt: now,
    receivedAt: now,
    platform: 'android',
    appVersion: '1.0.0',
    appBuild: '1',
    osVersion: '15',
    country: null,
    properties: { cold_start: true },
    valid: true,
    invalidReason: null,
  });
  return eventId;
}

async function statusOf(userId: string) {
  const [user] = await db.select({ status: users.status }).from(users).where(eq(users.id, userId));
  return user?.status;
}

describe('DELETE /v1/me', () => {
  it('deletes the account and hands the device to a fresh anonymous user', async () => {
    const device = await signUpViaApi(server, appId);

    const res = await deleteAccount(device.accessToken);

    expect(res.statusCode).toBe(200);
    const tokens = res.json();
    expect(tokens.userId).not.toBe(device.userId);
    expect(await statusOf(device.userId)).toBe('deletion_pending');
    expect(queuedJobs).toContainEqual({ name: ERASE_JOB, data: { userId: device.userId } });

    // The old user is gone at once, the new one works
    expect((await server.inject({ method: 'GET', url: '/v1/me', headers: auth(device.accessToken) })).statusCode).toBe(401);
    expect((await refresh(device.refreshToken)).statusCode).toBe(401);
    const me = await server.inject({ method: 'GET', url: '/v1/me', headers: auth(tokens.accessToken) });
    expect(me.json().userId).toBe(tokens.userId);
  });

  it('signs out every device and frees the Google account', async () => {
    const { owner, secondRefreshToken } = await mergedPair();

    await deleteAccount(owner.accessToken);

    expect((await refresh(secondRefreshToken)).statusCode).toBe(401);
    expect(await db.select().from(authIdentities).where(eq(authIdentities.userId, owner.userId))).toEqual([]);

    // The same Google account on a new device starts a new, empty account
    const newcomer = await signUpViaApi(server, appId);
    expect((await postGoogle(newcomer, await googleToken(newcomer, 'g-1'))).json().result).toBe('linked');
  });

  it('cannot run twice for the same user', async () => {
    const device = await signUpViaApi(server, appId);
    await deleteAccount(device.accessToken);

    expect((await deleteAccount(device.accessToken)).statusCode).toBe(401);
  });
});

describe('eraseUser', () => {
  it('anonymizes the events of the user and of users merged into them', async () => {
    const { owner, second } = await mergedPair();
    const sessionA = randomUUID();
    const sessionB = randomUUID();
    const ids = [
      await storeEvent(owner.userId, owner.installationId, sessionA),
      await storeEvent(owner.userId, owner.installationId, sessionA),
      // Recorded by the anonymous user before the merge
      await storeEvent(second.userId, second.installationId, sessionB),
    ];
    await deleteAccount(owner.accessToken);

    expect(await eraseUser(owner.userId, new Date())).toBe('erased');

    expect(await db.select().from(events).where(inArray(events.userId, [owner.userId, second.userId]))).toEqual([]);
    const rows = await db.select().from(events).where(inArray(events.eventId, ids));
    const byId = new Map(rows.map((row) => [row.eventId, row]));
    const rowOf = (index: number) => {
      const row = byId.get(ids[index] ?? '');
      if (!row) throw new Error(`Event ${index} is missing`);
      return row;
    };
    const a1 = rowOf(0);
    const a2 = rowOf(1);
    const b = rowOf(2);

    // Still one person with two sessions, under ids nobody knows
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((row) => row.userId)).size).toBe(1);
    expect(a1.sessionId).toBe(a2.sessionId);
    expect(a1.sessionId).not.toBe(b.sessionId);
    expect([sessionA, sessionB]).not.toContain(a1.sessionId);
    expect(a1.installationId).not.toBe(owner.installationId);
  });

  it('erases the account data and notifies the app backend', async () => {
    const { owner, second } = await mergedPair();
    await deleteAccount(owner.accessToken);

    await eraseUser(owner.userId, new Date());

    expect(await statusOf(owner.userId)).toBe('deleted');
    expect(await db.select().from(sessions).where(eq(sessions.userId, owner.userId))).toEqual([]);
    const [notification] = await db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.appId, appId), eq(deliveries.type, 'user.deleted')));
    expect(notification?.payload).toMatchObject({ userId: owner.userId, mergedUserIds: [second.userId] });
  });

  it('runs once and skips active users', async () => {
    const device = await signUpViaApi(server, appId);
    const active = await signUpViaApi(server, appId);
    await deleteAccount(device.accessToken);

    expect(await eraseUser(device.userId, new Date())).toBe('erased');
    expect(await eraseUser(device.userId, new Date())).toBe('skipped');
    expect(await eraseUser(active.userId, new Date())).toBe('skipped');
  });
});

describe('eraseOverdueUsers', () => {
  it('erases users whose erase job is late', async () => {
    const device = await signUpViaApi(server, appId);
    await deleteAccount(device.accessToken);

    expect(await eraseOverdueUsers(new Date())).toBe(0);
    expect(await eraseOverdueUsers(new Date(Date.now() + 2 * 60 * 60 * 1000))).toBe(1);
    expect(await statusOf(device.userId)).toBe('deleted');
  });
});

describe('deleteOldConsents', () => {
  it('keeps the consent log of a deleted user for three years', async () => {
    const device = await signUpViaApi(server, appId);
    const now = new Date().toISOString();
    const recorded = await server.inject({
      method: 'POST',
      url: '/v1/consent',
      headers: auth(device.accessToken),
      payload: {
        decisions: { analytics: true, personalization: false },
        policyVersion: 'v1',
        source: 'first_launch',
        decidedAt: now,
        sentAt: now,
      },
    });
    expect(recorded.statusCode).toBe(200);
    await deleteAccount(device.accessToken);
    await eraseUser(device.userId, new Date());

    expect(await deleteOldConsents(new Date())).toBe(0);
    expect(await deleteOldConsents(new Date(Date.now() + 3 * 366 * DAY_MS))).toBe(2);
    expect(await db.select().from(consents).where(eq(consents.userId, device.userId))).toEqual([]);
  });
});