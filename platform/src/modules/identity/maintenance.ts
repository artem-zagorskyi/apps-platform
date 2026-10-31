import { lt, or } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { authNonces, sessions } from './schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Expired nonces are useless; a day of margin for debugging
export const NONCE_KEEP_MS = DAY_MS;

// Ended sessions are kept for investigating token theft
export const SESSION_KEEP_MS = 90 * DAY_MS;

export async function deleteOldNonces(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - NONCE_KEEP_MS);
  const result = await db.delete(authNonces).where(lt(authNonces.expiresAt, cutoff));
  return result.rowCount ?? 0;
}

// Sessions that ended (revoked, rotated or expired) before the cutoff.
// Older sessions of a rotation chain always ended earlier, so a kept
// session never points at a deleted one through replaced_by.
export async function deleteOldSessions(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - SESSION_KEEP_MS);
  const result = await db
    .delete(sessions)
    .where(or(lt(sessions.revokedAt, cutoff), lt(sessions.rotatedAt, cutoff), lt(sessions.expiresAt, cutoff)));
  return result.rowCount ?? 0;
}