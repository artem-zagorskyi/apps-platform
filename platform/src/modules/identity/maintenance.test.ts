import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp, signUpViaApi } from '../../../test/helpers.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { deleteOldNonces, deleteOldSessions } from './maintenance.js';
import { authNonces, sessions } from './schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const now = new Date();
const daysAgo = (days: number) => new Date(now.getTime() - days * DAY_MS);

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

async function issueNonce(accessToken: string) {
  const res = await server.inject({
    method: 'POST',
    url: '/v1/auth/nonce',
    headers: { authorization: `Bearer ${accessToken}` },
  });
  expect(res.statusCode).toBe(200);
}

describe('deleteOldNonces', () => {
  it('deletes nonces expired more than a day ago', async () => {
    const device = await signUpViaApi(server, appId);
    await issueNonce(device.accessToken);
    await issueNonce(device.accessToken);
    await issueNonce(device.accessToken);

    const rows = await db.select({ id: authNonces.id }).from(authNonces);
    const [old, recent] = rows;
    await db.update(authNonces).set({ expiresAt: daysAgo(2) }).where(eq(authNonces.id, old!.id));
    await db.update(authNonces).set({ expiresAt: daysAgo(0.5) }).where(eq(authNonces.id, recent!.id));

    expect(await deleteOldNonces(now)).toBe(1);
    expect(await db.select().from(authNonces)).toHaveLength(2);
  });
});

describe('deleteOldSessions', () => {
  it('deletes sessions that ended long ago and keeps the others', async () => {
    const active = await signUpViaApi(server, appId);
    const revokedLongAgo = await signUpViaApi(server, appId);
    const revokedRecently = await signUpViaApi(server, appId);

    await db
      .update(sessions)
      .set({ revokedAt: daysAgo(91), revokeReason: 'logout' })
      .where(eq(sessions.userId, revokedLongAgo.userId));
    await db
      .update(sessions)
      .set({ revokedAt: daysAgo(10), revokeReason: 'logout' })
      .where(eq(sessions.userId, revokedRecently.userId));

    expect(await deleteOldSessions(now)).toBe(1);

    const left = await db.select({ userId: sessions.userId }).from(sessions);
    expect(left.map((s) => s.userId).sort()).toEqual([active.userId, revokedRecently.userId].sort());
  });

  it('deletes a whole rotation chain at once', async () => {
    const device = await signUpViaApi(server, appId);
    const refresh = await server.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      payload: { refreshToken: device.refreshToken },
    });
    expect(refresh.statusCode).toBe(200);

    // The first session was replaced by the second one, which was revoked later
    const chain = await db.select().from(sessions).where(eq(sessions.userId, device.userId));
    expect(chain).toHaveLength(2);
    for (const session of chain) {
      await db
        .update(sessions)
        .set(
          session.rotatedAt
            ? { rotatedAt: daysAgo(120) }
            : { revokedAt: daysAgo(100), revokeReason: 'logout' },
        )
        .where(eq(sessions.id, session.id));
    }

    expect(await deleteOldSessions(now)).toBe(2);
  });
});