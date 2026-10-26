import { sql } from 'drizzle-orm';
import { db } from '../src/core/db.js';
import { appPlatforms, apps } from '../src/modules/apps/schema.js';

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