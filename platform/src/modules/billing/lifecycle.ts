import { and, eq, inArray } from 'drizzle-orm';
import type { Tx } from '../../core/db.js';
import { purchaseEvents, purchases } from './schema.js';
import { notifyEntitlements } from './store-sync.js';

// A merge: purchases of the anonymous user go to the account it was merged into
export async function transferPurchasesOnMerge(
  tx: Tx,
  appId: string,
  sourceUserId: string,
  targetUserId: string,
  now: Date,
): Promise<void> {
  const moved = await tx
    .update(purchases)
    .set({ userId: targetUserId, updatedAt: now })
    .where(and(eq(purchases.appId, appId), eq(purchases.userId, sourceUserId)))
    .returning({ id: purchases.id });
  if (moved.length === 0) return;

  await tx.insert(purchaseEvents).values(
    moved.map((p) => ({
      appId,
      purchaseId: p.id,
      kind: 'transferred' as const,
      source: 'merge' as const,
      fromUserId: sourceUserId,
      toUserId: targetUserId,
      occurredAt: now,
    })),
  );
  await notifyEntitlements(tx, appId, targetUserId, now);
}

// An account deletion: purchases stay for revenue records, without the person.
// The store payload holds our user id (obfuscatedAccountId), so it goes too.
export async function anonymizePurchases(tx: Tx, userIds: string[], now: Date): Promise<void> {
  if (userIds.length === 0) return;

  const rows = await tx
    .update(purchases)
    .set({ userId: null, storeAccountRef: null, storePayload: null, anonymizedAt: now, updatedAt: now })
    .where(inArray(purchases.userId, userIds))
    .returning({ id: purchases.id, appId: purchases.appId });

  await tx.update(purchaseEvents).set({ fromUserId: null }).where(inArray(purchaseEvents.fromUserId, userIds));
  await tx.update(purchaseEvents).set({ toUserId: null }).where(inArray(purchaseEvents.toUserId, userIds));

  if (rows.length > 0) {
    await tx.insert(purchaseEvents).values(
      rows.map((p) => ({
        appId: p.appId,
        purchaseId: p.id,
        kind: 'anonymized' as const,
        source: 'deletion' as const,
        occurredAt: now,
      })),
    );
  }
}