import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetDatabase, seedApp } from '../../../test/helpers.js';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { installations, sessions, users } from './schema.js';
import { hashRefreshToken, verifyAccessToken } from './tokens.js';

let server: FastifyInstance;
let appId: string;

beforeEach(async () => {
  await resetDatabase();
  appId = await seedApp();
  // A fresh server per test also resets the in-memory rate limit counters
  server = await buildApp();
});

afterEach(async () => {
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

function signUp(overrides: Record<string, unknown> = {}) {
  return server.inject({
    method: 'POST',
    url: '/v1/auth/anonymous',
    payload: {
      appId,
      installationId: randomUUID(),
      platform: 'android',
      appVersion: '1.0.0',
      appBuild: '1',
      osVersion: '15',
      ...overrides,
    },
  });
}

function refresh(refreshToken: string) {
  return server.inject({
    method: 'POST',
    url: '/v1/auth/refresh',
    payload: { refreshToken },
  });
}

async function newRefreshToken(): Promise<string> {
  return (await signUp()).json().refreshToken;
}

async function sessionByToken(token: string) {
  const [session] = await db
    .select()
    .from(sessions)
    .where(eq(sessions.tokenHash, hashRefreshToken(token)));
  return session;
}

describe('POST /v1/auth/anonymous', () => {
  it('creates a user, an installation and a session', async () => {
    const installationId = randomUUID();
    const res = await signUp({ installationId });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    const [user] = await db.select().from(users).where(eq(users.id, body.userId));
    expect(user?.status).toBe('active');

    const [installation] = await db
      .select()
      .from(installations)
      .where(eq(installations.id, installationId));
    expect(installation?.userId).toBe(body.userId);

    // Found by hash: the token itself is never stored
    const session = await sessionByToken(body.refreshToken);
    expect(session?.userId).toBe(body.userId);
  });

  it('issues an access token with the expected claims', async () => {
    const installationId = randomUUID();
    const body = (await signUp({ installationId, platform: 'ios' })).json();

    const claims = await verifyAccessToken(body.accessToken, appId);

    expect(claims).toEqual({
      userId: body.userId,
      appId,
      installationId,
      platform: 'ios',
    });
  });

  it('rejects a reused installation id', async () => {
    const installationId = randomUUID();
    await signUp({ installationId });

    const res = await signUp({ installationId });

    expect(res.statusCode).toBe(409);
    expect(res.json().error).toBe('installation_exists');
  });

  it('rejects an unknown app', async () => {
    const res = await signUp({ appId: randomUUID() });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('unknown_app');
  });

  it('rejects an invalid platform', async () => {
    const res = await signUp({ platform: 'windows' });

    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe('validation_failed');
  });

  it('rate limits sign-ups per IP', async () => {
    const codes: number[] = [];
    for (let i = 0; i < 11; i++) {
      codes.push((await signUp()).statusCode);
    }

    expect(codes.slice(0, 10)).toEqual(Array(10).fill(201));
    expect(codes[10]).toBe(429);
  });
});

describe('POST /v1/auth/refresh', () => {
  it('rotates the refresh token', async () => {
    const r1 = await newRefreshToken();

    const res = await refresh(r1);

    expect(res.statusCode).toBe(200);
    const r2 = res.json().refreshToken;
    expect(r2).not.toBe(r1);
    expect((await refresh(r2)).statusCode).toBe(200);
  });

  it('allows a quick retry and supersedes the unused successor', async () => {
    const r1 = await newRefreshToken();
    const r2 = (await refresh(r1)).json().refreshToken; // "lost in transit"

    const retry = await refresh(r1);

    expect(retry.statusCode).toBe(200);
    expect((await refresh(r2)).statusCode).toBe(401);
    expect((await sessionByToken(r2))?.revokeReason).toBe('superseded');
  });

  it('revokes the family when a rotated token is reused after the grace window', async () => {
    const r1 = await newRefreshToken();
    const r2 = (await refresh(r1)).json().refreshToken;

    // Move the rotation back in time instead of waiting 30 seconds
    await db
      .update(sessions)
      .set({ rotatedAt: sql`now() - interval '1 minute'` })
      .where(eq(sessions.tokenHash, hashRefreshToken(r1)));

    const reuse = await refresh(r1);

    expect(reuse.statusCode).toBe(401);
    expect(reuse.json().error).toBe('invalid_refresh_token');
    // The legitimate newer token dies with the family
    expect((await refresh(r2)).statusCode).toBe(401);
    expect((await sessionByToken(r2))?.revokeReason).toBe('reuse_detected');
  });

  it('treats a retry as theft once the successor has been used', async () => {
    const r1 = await newRefreshToken();
    const r2 = (await refresh(r1)).json().refreshToken;
    const r3 = (await refresh(r2)).json().refreshToken;

    expect((await refresh(r1)).statusCode).toBe(401);
    expect((await refresh(r3)).statusCode).toBe(401);
  });

  it('rejects an expired token', async () => {
    const r1 = await newRefreshToken();
    await db
      .update(sessions)
      .set({ expiresAt: sql`now() - interval '1 second'` })
      .where(eq(sessions.tokenHash, hashRefreshToken(r1)));

    const res = await refresh(r1);

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_refresh_token');
  });

  it('rejects an unknown token', async () => {
    const res = await refresh('x'.repeat(43));

    expect(res.statusCode).toBe(401);
    expect(res.json().error).toBe('invalid_refresh_token');
  });
});