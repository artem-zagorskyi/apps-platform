import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { config } from '../../core/config.js';
import { db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import { sendJob } from '../../core/jobs.js';
import { anonymizeUserEvents } from '../events/anonymize.js';
import { notifyApp } from '../webhooks/service.js';
import { authIdentities, authNonces, consents, installations, sessions, userMerges, users } from './schema.js';
import { insertSession, issueTokenPair } from './service.js';
import type { AccessTokenClaims } from './tokens.js';

export const ERASE_JOB = 'identity-erase-user';

// After this no access token of the user is valid anymore,
// so no device can add data under the old id
export const ERASE_DELAY_SECONDS = config.ACCESS_TOKEN_TTL_SECONDS + 5 * 60;

const DAY_MS = 24 * 60 * 60 * 1000;

// Proof of lawful processing; the German limitation period is three years
export const CONSENT_KEEP_AFTER_DELETION_MS = 3 * 365 * DAY_MS;

// Collected with analytics consent; removed together with the account
const clearedDeviceDetails = {
  deviceManufacturer: null,
  deviceModel: null,
  screenWidth: null,
  screenHeight: null,
  screenDensity: null,
  ramMb: null,
  storageFreeMb: null,
  locale: null,
  timezone: null,
  installSource: null,
  notificationsEnabled: null,
  adTracking: 'not_determined' as const,
  country: null,
  region: null,
  city: null,
  geoLat: null,
  geoLon: null,
};

// Deletes the account at once: sign-in, sessions on every device and the
// device data stop working now; the remaining data is erased by a job.
// The device continues with a fresh anonymous user, as after a logout.
export async function requestAccountDeletion(auth: AccessTokenClaims) {
  const now = new Date();
  const eraseAt = new Date(now.getTime() + ERASE_DELAY_SECONDS * 1000);

  const result = await db.transaction(async (tx) => {
    // Lock the device so a parallel logout or merge cannot reassign it
    const [installation] = await tx
      .select({ ownerId: installations.userId })
      .from(installations)
      .where(eq(installations.id, auth.installationId))
      .for('update');

    if (!installation || installation.ownerId !== auth.userId) {
      throw new AppError(401, 'unauthorized', 'Device no longer belongs to this user', 'installation_reassigned');
    }

    const [owner] = await tx.select({ status: users.status }).from(users).where(eq(users.id, auth.userId));
    if (owner?.status !== 'active') {
      throw new AppError(401, 'unauthorized', 'Account is no longer active', `user_${owner?.status ?? 'missing'}`);
    }

    await tx
      .update(users)
      .set({ status: 'deletion_pending', deletionRequestedAt: now, deletionScheduledAt: eraseAt })
      .where(eq(users.id, auth.userId));

    // Signing in with the same Google or Apple account starts a new, empty account
    await tx.delete(authIdentities).where(eq(authIdentities.userId, auth.userId));

    // Every device of the user loses its session now
    await tx
      .update(sessions)
      .set({ revokedAt: now, revokeReason: 'account_deleted' })
      .where(and(eq(sessions.userId, auth.userId), isNull(sessions.revokedAt)));

    const [newUser] = await tx.insert(users).values({ appId: auth.appId }).returning({ id: users.id });
    if (!newUser) throw new Error('User insert returned no row');

    // Same device, new owner; what was collected about the device goes with the account
    await tx
      .update(installations)
      .set({ userId: newUser.id, ...clearedDeviceDetails, updatedAt: now })
      .where(eq(installations.id, auth.installationId));

    const refresh = await insertSession(tx, newUser.id, auth.installationId, now);

    await sendJob(ERASE_JOB, { userId: auth.userId }, tx, { startAfterSeconds: ERASE_DELAY_SECONDS });
    return { userId: newUser.id, refresh };
  });

  return issueTokenPair({ ...auth, userId: result.userId }, result.refresh);
}

// Erases a user whose deletion was requested, together with the users merged
// into them. Repeatable: a retry after a failure starts over.
export async function eraseUser(userId: string, now: Date): Promise<'erased' | 'skipped'> {
  const [user] = await db.select({ status: users.status, appId: users.appId }).from(users).where(eq(users.id, userId));
  if (user?.status !== 'deletion_pending') return 'skipped';

  // Users merged into this one carry part of the same person's history
  const merged = await db.execute<{ id: string }>(sql`
    with recursive chain(id) as (
      select id from identity.users where merged_into = ${userId}
      union
      select u.id from identity.users u join chain c on u.merged_into = c.id
    )
    select id from chain
  `);
  const userIds = [userId, ...merged.rows.map((row) => row.id)];

  // First, while the user is still pending: if a later step fails, the retry
  // runs this again (it is repeatable) instead of skipping it
  await anonymizeUserEvents(userIds);

  await db.transaction(async (tx) => {
    const owned = tx.select({ id: installations.id }).from(installations).where(inArray(installations.userId, userIds));

    await tx.delete(authNonces).where(inArray(authNonces.installationId, owned));
    await tx.delete(sessions).where(inArray(sessions.userId, userIds));
    await tx.delete(authIdentities).where(inArray(authIdentities.userId, userIds));
    await tx
      .update(installations)
      .set({ ...clearedDeviceDetails, updatedAt: now })
      .where(inArray(installations.userId, userIds));
    await tx
      .delete(userMerges)
      .where(or(inArray(userMerges.sourceUserId, userIds), inArray(userMerges.targetUserId, userIds)));

    // The row stays as a tombstone: the consent log still refers to it
    await tx.update(users).set({ status: 'deleted', deletedAt: now }).where(eq(users.id, userId));

    // The app backend deletes its domain data of the user
    await notifyApp(tx, user.appId, 'user.deleted', {
      userId,
      mergedUserIds: userIds.slice(1),
      deletedAt: now.toISOString(),
    });
  });

  return 'erased';
}

// Safety net: users whose erase job is more than an hour late
export async function eraseOverdueUsers(now: Date): Promise<number> {
  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.status, 'deletion_pending'), lt(users.deletionScheduledAt, new Date(now.getTime() - 60 * 60 * 1000))));

  let erased = 0;
  for (const user of due) {
    if ((await eraseUser(user.id, now)) === 'erased') erased++;
  }
  return erased;
}

// Consent records of users deleted more than three years ago
export async function deleteOldConsents(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - CONSENT_KEEP_AFTER_DELETION_MS);
  const deletedLongAgo = db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.status, 'deleted'), lt(users.deletedAt, cutoff)));

  const result = await db.delete(consents).where(inArray(consents.userId, deletedLongAgo));
  return result.rowCount ?? 0;
}