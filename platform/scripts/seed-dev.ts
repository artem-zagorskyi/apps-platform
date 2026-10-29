import { eq } from 'drizzle-orm';
import { config } from '../src/core/config.js';
import { db, pool } from '../src/core/db.js';
import { appPlatforms, apps, consentPolicies, oauthClients } from '../src/modules/apps/schema.js';

// Creates a "demo" app with Android and iOS platforms for local development.
// With GOOGLE_WEB_CLIENT_ID set, also registers it for Google sign-in.
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

// Ask everyone: a German business needs consent for analytics worldwide
await db
  .insert(consentPolicies)
  .values({
    appId: demo.id,
    region: '*',
    mode: 'optional',
    policyVersion: '2026-10-29',
    repromptAfterDays: 180,
  })
  .onConflictDoNothing();

// Read directly, not through config: only this script needs it
const googleWebClientId = process.env.GOOGLE_WEB_CLIENT_ID?.trim();
if (googleWebClientId) {
  await db
    .insert(oauthClients)
    .values({
      appId: demo.id,
      platform: 'android',
      provider: 'google',
      clientId: googleWebClientId,
    })
    .onConflictDoNothing();
  console.log(`Google web client ID registered: ${googleWebClientId}`);
} else {
  console.log('GOOGLE_WEB_CLIENT_ID is not set: Google sign-in is not configured');
}

console.log(`Demo app id: ${demo.id}`);
await pool.end();