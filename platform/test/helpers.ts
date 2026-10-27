import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { db } from '../src/core/db.js';
import { appPlatforms, apps } from '../src/modules/apps/schema.js';
import { authIdentities } from '../src/modules/identity/schema.js';

// Removes all rows. Every table references apps.apps directly or
// indirectly, so truncating it with CASCADE empties the whole database.
export async function resetDatabase(): Promise<void> {
  await db.execute(sql`truncate table apps.apps cascade`);
}

// Registers a test app on both platforms and returns its id
export async function seedApp(): Promise<string> {
  const [app] = await db.insert(apps).values({ slug: 'test', name: 'Test' }).returning();
  if (!app) throw new Error('Failed to seed the test app');

  await db.insert(appPlatforms).values([
    { appId: app.id, platform: 'android', bundleId: 'com.example.test' },
    { appId: app.id, platform: 'ios', bundleId: 'com.example.test' },
  ]);

  return app.id;
}

// Anonymous sign-up through the API; returns everything a test usually needs
export async function signUpViaApi(server: FastifyInstance, appId: string) {
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

  if (res.statusCode !== 201) {
    throw new Error(`Sign-up failed with ${res.statusCode}: ${res.body}`);
  }

  const body = res.json();
  return {
    installationId,
    userId: body.userId as string,
    accessToken: body.accessToken as string,
    refreshToken: body.refreshToken as string,
  };
}

// Links a fake Google account directly in the database.
// Used until real Google sign-in exists, and later to keep tests fast.
export async function linkFakeGoogleAccount(userId: string, appId: string): Promise<void> {
  await db.insert(authIdentities).values({
    userId,
    appId,
    provider: 'google',
    providerSubject: randomUUID(),
    email: 'test@example.com',
    emailVerified: true,
  });
}