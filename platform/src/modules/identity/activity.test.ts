import { randomUUID } from 'node:crypto';
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../../core/db.js';
import { apps } from '../apps/schema.js';
import { deleteOldActivityDays, forgetActivityMarks, markActive } from './activity.js';
import { activityDays } from './schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = new Date('2026-11-10T10:00:00Z');

let appId: string;

beforeEach(async () => {
  forgetActivityMarks();
  const [app] = await db
    .insert(apps)
    .values({ slug: `activity-${randomUUID().slice(0, 8)}`, name: 'Activity test' })
    .returning({ id: apps.id });
  appId = app!.id;
});

afterAll(async () => {
  await pool.end();
});

const claims = (installationId: string) => ({
  userId: randomUUID(),
  appId,
  installationId,
  platform: 'android' as const,
});

const daysOf = () =>
  db
    .select({ day: activityDays.day, installationId: activityDays.installationId })
    .from(activityDays)
    .where(eq(activityDays.appId, appId))
    .orderBy(asc(activityDays.day));

describe('activity days', () => {
  it('records each installation once per UTC day', async () => {
    const installation = randomUUID();
    await markActive(claims(installation), NOW);
    await markActive(claims(installation), new Date(NOW.getTime() + 60_000));
    // Another process (or a restart) writes the same day again: no duplicate
    forgetActivityMarks();
    await markActive(claims(installation), NOW);
    await markActive(claims(installation), new Date(NOW.getTime() + DAY_MS));

    expect(await daysOf()).toEqual([
      { day: '2026-11-10', installationId: installation },
      { day: '2026-11-11', installationId: installation },
    ]);
  });

  it('removes days older than about 13 months', async () => {
    const installation = randomUUID();
    await markActive(claims(installation), new Date(NOW.getTime() - 401 * DAY_MS));
    await markActive(claims(installation), new Date(NOW.getTime() - 399 * DAY_MS));

    expect(await deleteOldActivityDays(NOW)).toBeGreaterThanOrEqual(1);
    expect((await daysOf()).map((row) => row.day)).toEqual(['2025-10-07']);
  });
});
