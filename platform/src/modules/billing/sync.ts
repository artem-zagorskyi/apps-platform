import { and, eq, inArray, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../core/db.js';
import { getBundleId, listBundleIds } from '../apps/service.js';
import { resolveAccount } from '../identity/accounts.js';
import { GRANTING_STATES } from './entitlements.js';
import { getStoreProvider } from './providers.js';
import { STORE_PLATFORM } from './purchases.js';
import { purchases } from './schema.js';
import { savePurchase } from './store-sync.js';
import { type Store, StoreError, type StorePurchase } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// Brings a purchase in line with the store, for notifications and scheduled
// checks. 'unknown': the store does not know it (anymore).
export async function syncPurchase(input: {
  appId: string;
  store: Store;
  packageName: string;
  productId: string;
  purchaseKey: string;
  source: 'notification' | 'reconcile';
  refunded?: boolean;
  now?: Date;
}): Promise<'saved' | 'unknown'> {
  const provider = getStoreProvider(input.store);
  if (!provider) throw new StoreError(`${input.store} is not configured`, 'unavailable');
  const now = input.now ?? new Date();
  const storeApp = { appId: input.appId, packageName: input.packageName };

  let fetched: StorePurchase;
  try {
    fetched = await provider.fetchPurchase(storeApp, input.productId, input.purchaseKey);
  } catch (err) {
    if (err instanceof StoreError && err.reason === 'not_found') return 'unknown';
    throw err;
  }
  if (input.refunded) fetched = { ...fetched, state: 'refunded' };

  // Also for purchases the app never sent (it crashed right after paying):
  // otherwise Google refunds them after three days
  let acknowledgedNow = false;
  if (!fetched.acknowledged && GRANTING_STATES.includes(fetched.state)) {
    try {
      await provider.acknowledge(storeApp, fetched);
      acknowledgedNow = true;
    } catch (err) {
      if (!(err instanceof StoreError)) throw err;
    }
  }

  // The owner we know; for a purchase we have not seen yet, the user the store recorded
  const [known] = await db
    .select({ userId: purchases.userId })
    .from(purchases)
    .where(and(eq(purchases.store, input.store), eq(purchases.purchaseKey, input.purchaseKey)));

  let ownerId: string | null;
  if (known) {
    ownerId = known.userId;
  } else {
    const ref = fetched.accountRef;
    const account = ref && z.uuid().safeParse(ref).success ? await resolveAccount(input.appId, ref) : null;
    ownerId = account?.status === 'active' ? account.userId : null;
  }

  await db.transaction((tx) =>
    savePurchase(tx, { appId: input.appId, purchase: fetched, ownerId, acknowledgedNow, source: input.source, now }),
  );
  return 'saved';
}

// Refunds reported by the store in the last days, next to notifications
export async function reconcileVoided(now: Date): Promise<number> {
  const provider = getStoreProvider('google_play');
  if (!provider?.listVoided) return 0;

  let refunded = 0;
  for (const { appId, bundleId } of await listBundleIds('android')) {
    const voided = await provider.listVoided({ appId, packageName: bundleId }, new Date(now.getTime() - 3 * DAY_MS));
    if (voided.length === 0) continue;

    const known = await db
      .select({ productId: purchases.productId, purchaseKey: purchases.purchaseKey, state: purchases.state })
      .from(purchases)
      .where(
        and(
          eq(purchases.appId, appId),
          eq(purchases.store, 'google_play'),
          inArray(
            purchases.purchaseKey,
            voided.map((v) => v.purchaseKey),
          ),
        ),
      );

    for (const purchase of known) {
      if (purchase.state === 'refunded') continue;
      const result = await syncPurchase({
        appId,
        store: 'google_play',
        packageName: bundleId,
        productId: purchase.productId,
        purchaseKey: purchase.purchaseKey,
        source: 'reconcile',
        refunded: true,
        now,
      });
      if (result === 'saved') refunded++;
    }
  }
  return refunded;
}

// Safety net: purchases still granting access although their period ended
// a while ago (a notification got lost). At most 200 per run.
export async function refreshOverdue(now: Date): Promise<number> {
  const due = await db
    .select({
      appId: purchases.appId,
      store: purchases.store,
      productId: purchases.productId,
      purchaseKey: purchases.purchaseKey,
    })
    .from(purchases)
    .where(
      and(
        inArray(purchases.state, GRANTING_STATES),
        lt(purchases.expiresAt, new Date(now.getTime() - 15 * 60 * 1000)),
        or(isNull(purchases.lastVerifiedAt), lt(purchases.lastVerifiedAt, new Date(now.getTime() - 60 * 60 * 1000))),
      ),
    )
    .limit(200);

  const packageNames = new Map<string, string | null>();
  let refreshed = 0;
  for (const purchase of due) {
    if (!getStoreProvider(purchase.store)) continue;

    const cacheKey = `${purchase.appId}:${purchase.store}`;
    if (!packageNames.has(cacheKey)) {
      packageNames.set(cacheKey, await getBundleId(purchase.appId, STORE_PLATFORM[purchase.store]));
    }
    const packageName = packageNames.get(cacheKey);
    if (!packageName) continue;

    try {
      await syncPurchase({ ...purchase, packageName, source: 'reconcile', now });
      refreshed++;
    } catch (err) {
      // One store hiccup must not stop the others; the next run retries
      if (!(err instanceof StoreError)) throw err;
    }
  }
  return refreshed;
}