import { eq } from 'drizzle-orm';
import { config } from '../src/core/config.js';
import { db, pool } from '../src/core/db.js';
import { appPlatforms, apps } from '../src/modules/apps/schema.js';

// Creates a "demo" app with Android and iOS platforms for local development.
// Safe to run repeatedly: existing rows are left untouched.

if (config.NODE_ENV === 'production') {
  throw new Error('seed-dev must never run in production');
}

const [existing] = await db.select().from(apps).where(eq(apps.slug, 'demo'));
const [demo] = existing
  ? [existing]
  : await db.insert(apps).values({ slug: 'demo', name: 'Demo' }).returning();

if (!demo) throw new Error('Failed to create the demo app');

await db
  .insert(appPlatforms)
  .values([
    { appId: demo.id, platform: 'android', bundleId: 'com.example.demo' },
    { appId: demo.id, platform: 'ios', bundleId: 'com.example.demo' },
  ])
  .onConflictDoNothing();

console.log(`Demo app id: ${demo.id}`);
await pool.end();