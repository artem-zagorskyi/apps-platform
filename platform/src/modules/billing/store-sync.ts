import { and, eq, sql } from 'drizzle-orm';
import type { Tx } from '../../core/db.js';
import { notifyApp } from '../webhooks/service.js';
import { getEntitlements, serializeEntitlements } from './entitlements.js';
import { purchaseEvents, type purchaseEventSourceEnum, purchases } from './schema.js';
import type { StorePurchase } from './types.js';

type EventSource = (typeof purchaseEventSourceEnum.enumValues)[number];

// Tells the app backend what a user has access to now
export async function notifyEntitlements(tx: Tx, appId: string, userId: string, now: Date): Promise<void> {
  const entitlements = await getEntitlements(appId, userId, now, tx);
  await notifyApp(tx, appId, 'entitlements.changed', {
    userId,
    entitlements: serializeEntitlements(entitlements),
  });
}

// Writes the store's view of a purchase with its owner, records what changed
// in the history and notifies the app backend about changed entitlements.
// Every writer (the app, store notifications, scheduled checks) goes through here.
export async function savePurchase(
  tx: Tx,
  input: {
    appId: string;
    purchase: StorePurchase;
    ownerId: string | null;
    // Confirmed to the store during this call
    acknowledgedNow: boolean;
    source: EventSource;
    now: Date;
  },
): Promise<void> {
    const { appId, purchase: incoming, ownerId, source, now } = input;

  // One writer per purchase at a time
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`purchase:${incoming.store}:${incoming.purchaseKey}`}, 0))`,
  );

  const [before] = await tx
    .select()
    .from(purchases)
    .where(and(eq(purchases.store, incoming.store), eq(purchases.purchaseKey, incoming.purchaseKey)));

  // A refund is final: the store later reports the revoked purchase as expired
  const p: StorePurchase =
    before?.state === 'refunded' && incoming.state === 'expired' ? { ...incoming, state: 'refunded' } : incoming;

  const fields = {
    productId: p.productId,
    previousKey: p.previousKey,
    storeAccountRef: p.accountRef,
    state: p.state,
    startedAt: p.startedAt,
    expiresAt: p.expiresAt,
    autoRenewing: p.autoRenewing,
    priceMicros: p.priceMicros,
    currency: p.currency,
    country: p.country,
    test: p.test,
    storePayload: p.raw,
    lastVerifiedAt: now,
    updatedAt: now,
  };

  const events: (typeof purchaseEvents.$inferInsert)[] = [];
  let purchaseId: string;

  if (!before) {
    const [row] = await tx
      .insert(purchases)
      .values({
        appId,
        store: p.store,
        purchaseKey: p.purchaseKey,
        userId: ownerId,
        ...fields,
        acknowledgedAt: p.acknowledged || input.acknowledgedNow ? now : null,
      })
      .returning({ id: purchases.id });
    if (!row) throw new Error('Purchase insert returned no row');
    purchaseId = row.id;
    events.push({ appId, purchaseId, kind: 'registered', source, toState: p.state, toUserId: ownerId });
  } else {
    purchaseId = before.id;
    await tx
      .update(purchases)
      .set({ ...fields, userId: ownerId, ...(input.acknowledgedNow ? { acknowledgedAt: now } : {}) })
      .where(eq(purchases.id, before.id));

    if (before.userId !== ownerId) {
      events.push({ appId, purchaseId, kind: 'transferred', source, fromUserId: before.userId, toUserId: ownerId });
    }
    if (before.state !== p.state) {
      events.push({
        appId,
        purchaseId,
        kind: p.state === 'refunded' ? 'refunded' : 'state_changed',
        source,
        fromState: before.state,
        toState: p.state,
      });
    } else if (
      p.state === 'active' &&
      before.expiresAt &&
      p.expiresAt &&
      p.expiresAt.getTime() > before.expiresAt.getTime()
    ) {
      events.push({
        appId,
        purchaseId,
        kind: 'renewed',
        source,
        toState: p.state,
        details: { expiresAt: p.expiresAt.toISOString() },
      });
    }
  }

  if (input.acknowledgedNow) events.push({ appId, purchaseId, kind: 'acknowledged', source });
  if (events.length > 0) {
    await tx.insert(purchaseEvents).values(events.map((event) => ({ ...event, occurredAt: now })));
  }

  // Whoever gained or lost access learns about it
  const accessChanged =
    !before ||
    before.userId !== ownerId ||
    before.state !== p.state ||
    before.autoRenewing !== p.autoRenewing ||
    before.expiresAt?.getTime() !== p.expiresAt?.getTime();
  if (!accessChanged) return;

  for (const userId of new Set([before?.userId, ownerId])) {
    if (userId) await notifyEntitlements(tx, appId, userId, now);
  }
}