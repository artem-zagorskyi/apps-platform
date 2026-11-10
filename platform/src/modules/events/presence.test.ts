import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { db, pool } from '../../core/db.js';
import { apps } from '../apps/schema.js';
import { deleteOldPresence, forgetPresence, forgetPresenceWrites, markPresent } from './presence.js';
import { presence } from './schema.js';

const NOW = new Date('2026-11-10T15:00:00Z');
const FULDA = { country: 'DE', region: 'Hesse', city: 'Fulda', lat: 50.55, lon: 9.68 };

let appId: string;

beforeEach(async () => {
  forgetPresenceWrites();
  const [app] = await db
    .insert(apps)
    .values({ slug: `presence-${randomUUID().slice(0, 8)}`, name: 'Presence test' })
    .returning({ id: apps.id });
  appId = app!.id;
});

afterAll(async () => {
  await pool.end();
});

const auth = (installationId: string) => ({
  userId: randomUUID(),
  appId,
  installationId,
  platform: 'android' as const,
});

const rowOf = async (installationId: string) =>
  (await db.select().from(presence).where(eq(presence.installationId, installationId)))[0];

describe('presence', () => {
  it('keeps the city and the last time, writing at most once a minute', async () => {
    const installation = randomUUID();
    await markPresent(auth(installation), FULDA, NOW);
    await markPresent(auth(installation), null, new Date(NOW.getTime() + 30_000));
    expect(await rowOf(installation)).toMatchObject({ city: 'Fulda', country: 'DE', lastSeenAt: NOW });

    const later = new Date(NOW.getTime() + 2 * 60_000);
    await markPresent(auth(installation), FULDA, later);
    expect((await rowOf(installation))?.lastSeenAt).toEqual(later);
  });

  it('forgets an installation at once and old ones daily', async () => {
    const withdrawn = randomUUID();
    const old = randomUUID();
    await markPresent(auth(withdrawn), FULDA, NOW);
    await markPresent(auth(old), FULDA, new Date(NOW.getTime() - 25 * 60 * 60 * 1000));

    await forgetPresence(withdrawn);
    expect(await rowOf(withdrawn)).toBeUndefined();

    expect(await deleteOldPresence(NOW)).toBeGreaterThanOrEqual(1);
    expect(await rowOf(old)).toBeUndefined();
  });
});
