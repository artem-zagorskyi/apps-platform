import { lt } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { eventIds } from './schema.js';

// Covers a batch resent after a lost response, even after a long time offline
export const EVENT_ID_KEEP_MS = 90 * 24 * 60 * 60 * 1000;

export async function deleteOldEventIds(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - EVENT_ID_KEEP_MS);
  const result = await db.delete(eventIds).where(lt(eventIds.receivedAt, cutoff));
  return result.rowCount ?? 0;
}