import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  linkFakeGoogleAccount,
  resetDatabase,
  seedApp,
  signUpViaApi,
} from '../../../test/helpers.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { installations, sessions, users } from './schema.js';

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

function logout(accessToken?: string) {
  return server.inject({
    method: 'POST',
    url: '/v1/auth/logout',
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

function refresh(refreshToken: string) {
  return server.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: { refreshToken },
  });
}

describe('POST /v1/auth/logout', () => {
  it('hands the device to a fresh anonymous user', async () => {
    const before = await signUpViaApi(server, appId);
    await linkFakeGoogleAccount(before.userId, appId);

    const res = await logout(before.accessToken);

    expect(res.statusCode).toBe(200);
    const after = res.json();
    expect(after.userId).not.toBe(before.userId);

    // Same device, new owner
    const [installation] = await db
      .select()
      .from(installations)
      .where(eq(installations.id, before.installationId));
    expect(installation?.userId).toBe(after.userId);

    // Old sessions are revoked as logout, the new one works
    const oldSessions = await db
      .select()
      .from(sessions)
      .where(eq(sessions.userId, before.userId));
    expect(oldSessions.every((s) => s.revokeReason === 'logout')).toBe(true);
    expect((await refresh(before.refreshToken)).statusCode).toBe(401);
    expect((await refresh(after.refreshToken)).statusCode).toBe(200);

    // The signed-out account still exists and can sign in again
    const [oldUser] = await db.select().from(users).where(eq(users.id, before.userId));
    expect(oldUser?.status).toBe('active');
  });

  it('refuses to sign out an anonymous user', async () => {
    const user = await signUpViaApi(server, appId);

    const res = await logout(user.accessToken);

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('no_linked_account');
    // Nothing changed: the session still works
    expect((await refresh(user.refreshToken)).statusCode).toBe(200);
  });

  it('rejects a second logout with the old access token', async () => {
    const before = await signUpViaApi(server, appId);
    await linkFakeGoogleAccount(before.userId, appId);
    await logout(before.accessToken);

    // The access token has not expired, but the device has a new owner
    const res = await logout(before.accessToken);

    expect(res.statusCode).toBe(401);
  });

  it('requires an access token', async () => {
    const res = await logout();

    expect(res.statusCode).toBe(401);
  });
});