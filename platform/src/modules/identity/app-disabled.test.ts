import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../app.js';
import { db, pool } from '../../core/db.js';
import { appPlatforms, apps } from '../apps/schema.js';
import { forgetAppStatus } from '../apps/service.js';
import { refreshSession, signUpAnonymous } from './service.js';

let server: FastifyInstance;

beforeEach(async () => {
  server = await buildApp();
});

afterEach(async () => {
  await server.close();
});

afterAll(async () => {
  await pool.end();
});

async function createApp() {
  const suffix = randomUUID().slice(0, 8);
  const [app] = await db.insert(apps).values({ slug: `app-${suffix}`, name: 'Test app' }).returning({ id: apps.id });
  await db.insert(appPlatforms).values({ appId: app!.id, platform: 'android', bundleId: `com.example.t${suffix}` });
  return app!.id;
}

function signUp(appId: string) {
  return signUpAnonymous({
    appId,
    installationId: randomUUID(),
    platform: 'android',
    appVersion: '1.0.0',
    appBuild: '1',
    osVersion: '14',
  });
}

async function setStatus(appId: string, status: 'active' | 'disabled') {
  await db.update(apps).set({ status }).where(eq(apps.id, appId));
  forgetAppStatus(appId);
}

describe('a disabled app', () => {
  it('is stopped for everyone and comes back when enabled', async () => {
    const appId = await createApp();
    const tokens = await signUp(appId);
    const me = () =>
      server.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${tokens.accessToken}` } });

    expect((await me()).statusCode).toBe(200);

    await setStatus(appId, 'disabled');

    const refused = await me();
    expect(refused.statusCode).toBe(403);
    expect(refused.json().error).toBe('app_disabled');
    await expect(refreshSession(tokens.refreshToken)).rejects.toMatchObject({ code: 'app_disabled' });
    await expect(signUp(appId)).rejects.toMatchObject({ code: 'app_disabled' });

    // Nothing was revoked while disabled: the same session continues
    await setStatus(appId, 'active');
    expect((await me()).statusCode).toBe(200);
    const renewed = await refreshSession(tokens.refreshToken);
    expect(renewed.accessToken).toBeTruthy();
  });
});