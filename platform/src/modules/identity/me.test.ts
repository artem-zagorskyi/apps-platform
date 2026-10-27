import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetDatabase, seedApp } from '../../../test/helpers.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { users } from './schema.js';

let server: FastifyInstance;
let appId: string;

beforeEach(async () => {
  await resetDatabase();
  appId = await seedApp();
  server = await buildApp();
});

afterEach(async () => {
  vi.useRealTimers();
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

async function signUp() {
  const installationId = randomUUID();
  const res = await server.inject({
    method: 'POST',
    url: '/v1/auth/anonymous',
    payload: {
      appId,
      installationId,
      platform: 'android',
      appVersion: '1.0.0',
      appBuild: '1',
      osVersion: '15',
    },
  });
  const body = res.json();
  return { installationId, userId: body.userId as string, accessToken: body.accessToken as string };
}

function getMe(authorization?: string) {
  return server.inject({
    method: 'GET',
    url: '/v1/me',
    headers: authorization ? { authorization } : {},
  });
}

describe('GET /v1/me', () => {
  it('returns the current user', async () => {
    const { userId, installationId, accessToken } = await signUp();

    const res = await getMe(`Bearer ${accessToken}`);

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      userId,
      appId,
      installationId,
      platform: 'android',
      providers: [],
    });
  });

  it('rejects a request without a token', async () => {
    const res = await getMe();

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('unauthorized');
  });

  it('rejects a malformed Authorization header', async () => {
    const { accessToken } = await signUp();

    const res = await getMe(`Token ${accessToken}`);

    expect(res.statusCode).toBe(401);
  });

  it('rejects a token with modified claims', async () => {
    const { accessToken } = await signUp();
    const [header, payload, signature] = accessToken.split('.');

    // Pretend to be another user while keeping the original signature
    const claims = JSON.parse(Buffer.from(payload!, 'base64url').toString());
    claims.sub = randomUUID();
    const forged = Buffer.from(JSON.stringify(claims)).toString('base64url');

    const res = await getMe(`Bearer ${header}.${forged}.${signature}`);

    expect(res.statusCode).toBe(401);
  });

  it('rejects an expired token', async () => {
    const { accessToken } = await signUp();

    // Jump 16 minutes ahead: past the 15-minute access token lifetime
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16 * 60 * 1000);

    const res = await getMe(`Bearer ${accessToken}`);

    expect(res.statusCode).toBe(401);
  });

  it('rejects a valid token of a user who is no longer active', async () => {
    const { userId, accessToken } = await signUp();
    await db
      .update(users)
      .set({ status: 'deletion_pending' })
      .where(eq(users.id, userId));

    const res = await getMe(`Bearer ${accessToken}`);

    expect(res.statusCode).toBe(401);
  });
});