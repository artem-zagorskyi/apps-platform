import { and, eq, inArray } from 'drizzle-orm';
import { db, type Tx } from '../../core/db.js';
import { products, purchases } from './schema.js';
import type { PurchaseState, Store } from './types.js';

// States that may grant access; the database query filters by them
export const GRANTING_STATES: PurchaseState[] = ['active', 'canceled', 'grace_period'];

export function grantsAccess(purchase: { state: PurchaseState; expiresAt: Date | null }, now: Date): boolean {
  // The store keeps trying to charge; access stays until it moves the purchase on
  if (purchase.state === 'grace_period') return true;
  if (purchase.state !== 'active' && purchase.state !== 'canceled') return false;
  return purchase.expiresAt === null || purchase.expiresAt.getTime() > now.getTime();
}

export interface Entitlement {
  key: string;
  productId: string;
  store: Store;
  state: PurchaseState;
  expiresAt: Date | null;
  willRenew: boolean;
}

export interface PurchaseWithEntitlements {
  store: Store;
  productId: string;
  state: PurchaseState;
  expiresAt: Date | null;
  autoRenewing: boolean;
  entitlements: string[];
}

const lasts = (e: Entitlement) => (e.expiresAt === null ? Number.POSITIVE_INFINITY : e.expiresAt.getTime());

// One entry per entitlement: from the purchase that lasts longest
export function computeEntitlements(items: PurchaseWithEntitlements[], now: Date): Entitlement[] {
  const best = new Map<string, Entitlement>();

  for (const purchase of items) {
    if (!grantsAccess(purchase, now)) continue;
    const willRenew = purchase.autoRenewing && (purchase.state === 'active' || purchase.state === 'grace_period');

    for (const key of purchase.entitlements) {
      const candidate: Entitlement = {
        key,
        productId: purchase.productId,
        store: purchase.store,
        state: purchase.state,
        expiresAt: purchase.expiresAt,
        willRenew,
      };
      const current = best.get(key);
      if (!current || lasts(candidate) > lasts(current)) best.set(key, candidate);
    }
  }

  return [...best.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// Anything that can run a select: the database or a transaction
type Reader = Pick<Tx, 'select'>;

// Entitlements of a user right now. Purchases of products missing from the
// catalog grant nothing.
export async function getEntitlements(
  appId: string,
  userId: string,
  now: Date,
  reader: Reader = db,
): Promise<Entitlement[]> {
  const rows = await reader
    .select({
      store: purchases.store,
      productId: purchases.productId,
      state: purchases.state,
      expiresAt: purchases.expiresAt,
      autoRenewing: purchases.autoRenewing,
      entitlements: products.entitlements,
    })
    .from(purchases)
    .innerJoin(
      products,
      and(
        eq(products.appId, purchases.appId),
        eq(products.store, purchases.store),
        eq(products.productId, purchases.productId),
      ),
    )
    .where(and(eq(purchases.appId, appId), eq(purchases.userId, userId), inArray(purchases.state, GRANTING_STATES)));

  return computeEntitlements(rows, now);
}

// For responses and notifications: dates as ISO strings
export function serializeEntitlements(entitlements: Entitlement[]) {
  return entitlements.map((e) => ({ ...e, expiresAt: e.expiresAt?.toISOString() ?? null }));
}