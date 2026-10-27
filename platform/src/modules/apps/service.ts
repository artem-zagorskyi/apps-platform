import { and, eq } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { appPlatforms, apps, oauthClients, type Platform } from './schema.js';

// True if the app exists, is active and has this platform registered
export async function isAppPlatformActive(
  appId: string,
  platform: Platform,
): Promise<boolean> {
  const rows = await db
    .select({ appId: apps.id })
    .from(apps)
    .innerJoin(appPlatforms, eq(appPlatforms.appId, apps.id))
    .where(
      and(
        eq(apps.id, appId),
        eq(apps.status, 'active'),
        eq(appPlatforms.platform, platform),
      ),
    )
    .limit(1);

  return rows.length > 0;
}

// Client IDs a provider token may be issued for ("aud") for this app.
// All platforms together: Android and iOS often share one server client ID.
export async function getOAuthClientIds(
  appId: string,
  provider: 'google' | 'apple',
): Promise<string[]> {
  const rows = await db
    .select({ clientId: oauthClients.clientId })
    .from(oauthClients)
    .where(and(eq(oauthClients.appId, appId), eq(oauthClients.provider, provider)));

  return rows.map((row) => row.clientId);
}