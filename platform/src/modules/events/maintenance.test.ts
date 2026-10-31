import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { db, pool } from '../../core/db.js';
import { deleteOldEventIds } from './maintenance.js';
import { eventIds } from './schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

afterAll(async () => {
  await pool.end();
});

describe('deleteOldEventIds', () => {
  it('deletes ids received more than 90 days ago', async () => {
    const now = new Date();
    const old = randomUUID();
    const recent = randomUUID();
    await db.insert(eventIds).values([
      { eventId: old, receivedAt: new Date(now.getTime() - 91 * DAY_MS) },
      { eventId: recent, receivedAt: new Date(now.getTime() - 89 * DAY_MS) },
    ]);

    await deleteOldEventIds(now);

    // The table keeps rows of other tests: look at these two only
    const left = await db
      .select({ eventId: eventIds.eventId })
      .from(eventIds)
      .where(inArray(eventIds.eventId, [old, recent]));
    expect(left).toEqual([{ eventId: recent }]);
  });
});