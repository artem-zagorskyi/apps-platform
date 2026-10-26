import { and, eq } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { appPlatforms, apps, type Platform } from './schema.js';

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