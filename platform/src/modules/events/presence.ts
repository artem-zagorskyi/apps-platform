import { eq, lt } from 'drizzle-orm';
import { db } from '../../core/db.js';
import type { GeoLocation } from '../../core/geoip.js';
import { installations } from '../identity/schema.js';
import type { AccessTokenClaims } from '../identity/tokens.js';
import { presence } from './schema.js';

// "Now" on the live map
export const PRESENCE_WINDOW_MS = 30 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
// Batches come every 30 s; a write a minute is plenty for a 30-minute window
const PRESENCE_EVERY_MS = 60 * 1000;
// The place of an installation changes rarely
const PLACE_EVERY_MS = 10 * 60 * 1000;
// Bounds the memory of the caches below
const MAX_REMEMBERED = 100_000;

const presenceWrites = new Map<string, number>();
const placeWrites = new Map<string, { at: number; analytics: boolean }>();

function remember<T>(cache: Map<string, T>, key: string, value: T) {
  if (cache.size >= MAX_REMEMBERED) cache.clear();
  cache.set(key, value);
}

// The installation is using the app now, here. Only with analytics consent:
// the caller checks it. City level, the city centre, never the IP.
export async function markPresent(
  auth: AccessTokenClaims,
  location: GeoLocation | null,
  now: Date = new Date(),
): Promise<void> {
  const last = presenceWrites.get(auth.installationId);
  if (last !== undefined && now.getTime() - last < PRESENCE_EVERY_MS) return;
  remember(presenceWrites, auth.installationId, now.getTime());

  const values = {
    appId: auth.appId,
    platform: auth.platform,
    country: location?.country ?? null,
    city: location?.city ?? null,
    lat: location?.lat ?? null,
    lon: location?.lon ?? null,
    lastSeenAt: now,
  };
  try {
    await db
      .insert(presence)
      .values({ installationId: auth.installationId, ...values })
      .onConflictDoUpdate({ target: presence.installationId, set: values });
  } catch (err) {
    presenceWrites.delete(auth.installationId);
    throw err;
  }
}

// Consent withdrawn: the installation leaves the map at once
export async function forgetPresence(installationId: string): Promise<void> {
  presenceWrites.delete(installationId);
  await db.delete(presence).where(eq(presence.installationId, installationId));
}

// The last known place of the installation: the country for everyone (it
// targets config), region, city and city centre only with analytics consent.
export async function updateInstallationPlace(
  auth: AccessTokenClaims,
  location: GeoLocation | null,
  analytics: boolean,
  now: Date = new Date(),
): Promise<void> {
  const last = placeWrites.get(auth.installationId);
  if (last && last.analytics === analytics && now.getTime() - last.at < PLACE_EVERY_MS) return;

  const noCity = { region: null, city: null, geoLat: null, geoLon: null };
  const city = location
    ? { region: location.region, city: location.city, geoLat: location.lat, geoLon: location.lon }
    : null;
  // Without a location (no database, a private IP) only a withdrawal changes anything
  const place = location
    ? { country: location.country, ...(analytics ? city : noCity) }
    : analytics
      ? null
      : noCity;

  remember(placeWrites, auth.installationId, { at: now.getTime(), analytics });
  if (!place) return;
  try {
    await db.update(installations).set(place).where(eq(installations.id, auth.installationId));
  } catch (err) {
    placeWrites.delete(auth.installationId);
    throw err;
  }
}

// For tests that move the clock
export function forgetPresenceWrites(): void {
  presenceWrites.clear();
  placeWrites.clear();
}

// Daily job: nobody older than a day is "now"
export async function deleteOldPresence(now: Date = new Date()): Promise<number> {
  const deleted = await db
    .delete(presence)
    .where(lt(presence.lastSeenAt, new Date(now.getTime() - DAY_MS)))
    .returning({ installationId: presence.installationId });
  return deleted.length;
}
