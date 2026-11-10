import { lt } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { activityDays } from './schema.js';
import type { AccessTokenClaims } from './tokens.js';

// About 13 months: a year can be compared with the one before
export const ACTIVITY_RETENTION_DAYS = 400;
const DAY_MS = 24 * 60 * 60 * 1000;
// Bounds the memory of the cache below on a very busy day
const MAX_REMEMBERED = 200_000;

// Installations already marked today by this process: one write per day each
let rememberedDay = '';
let remembered = new Set<string>();

const utcDay = (time: Date) => time.toISOString().slice(0, 10);

// Records that the installation used the app today (UTC). Called for every
// authenticated request; only the first one of a day reaches the database.
export async function markActive(claims: AccessTokenClaims, now: Date = new Date()): Promise<void> {
  const day = utcDay(now);
  if (day !== rememberedDay) {
    rememberedDay = day;
    remembered = new Set();
  }
  if (remembered.has(claims.installationId)) return;
  if (remembered.size >= MAX_REMEMBERED) remembered.clear();
  remembered.add(claims.installationId);

  try {
    await db
      .insert(activityDays)
      .values({ appId: claims.appId, day, installationId: claims.installationId, platform: claims.platform })
      .onConflictDoNothing();
  } catch (err) {
    // The next request of this installation tries again
    remembered.delete(claims.installationId);
    throw err;
  }
}

// For tests that move the clock or check the database writes
export function forgetActivityMarks(): void {
  rememberedDay = '';
  remembered = new Set();
}

// Daily job: activity older than the retention period is removed
export async function deleteOldActivityDays(now: Date = new Date()): Promise<number> {
  const cutoff = utcDay(new Date(now.getTime() - ACTIVITY_RETENTION_DAYS * DAY_MS));
  const deleted = await db
    .delete(activityDays)
    .where(lt(activityDays.day, cutoff))
    .returning({ day: activityDays.day });
  return deleted.length;
}
