import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../core/db.js';
import { AppError } from '../../core/errors.js';
import type { Platform } from '../apps/schema.js';
import { getBundleId } from '../apps/service.js';
import { resolveAccount } from '../identity/accounts.js';
import type { AccessTokenClaims } from '../identity/tokens.js';
import { type Entitlement, GRANTING_STATES, getEntitlements } from './entitlements.js';
import { decideOwnership } from './ownership.js';
import { getStoreProvider } from './providers.js';
import { products, purchases } from './schema.js';
import { savePurchase } from './store-sync.js';
import { type Store, StoreError, type StorePurchase } from './types.js';

export const STORE_PLATFORM: Record<Store, Platform> = { google_play: 'android', app_store: 'ios' };

export type RegisterStatus = 'owned' | 'transferred' | 'sign_in_required' | 'owned_by_other_account';

export interface RegisterResult {
  status: RegisterStatus;
  // For sign_in_required, when the owner's provider gave an email
  maskedEmail: string | null;
  // Of the current user, after this purchase
  entitlements: Entitlement[];
}

const isUuid = (value: string | null): value is string => value !== null && z.uuid().safeParse(value).success;

// A purchase or a restore sent by the app: verified with the store, confirmed,
// given to its rightful owner
export async function registerPurchase(
  auth: AccessTokenClaims,
  input: { store: Store; productId: string; purchaseKey: string },
  now = new Date(),
): Promise<RegisterResult> {
  const provider = getStoreProvider(input.store);
  if (!provider) throw new AppError(503, 'store_unavailable', `${input.store} is not configured`);

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.appId, auth.appId), eq(products.store, input.store), eq(products.productId, input.productId)));
  if (!product) throw new AppError(400, 'unknown_product', `Unknown product ${input.productId}`);

  const packageName = await getBundleId(auth.appId, STORE_PLATFORM[input.store]);
  if (!packageName) throw new AppError(503, 'store_unavailable', `${input.store} is not configured`, 'no_bundle_id');
  const storeApp = { appId: auth.appId, packageName };

  // Never trust the device: ask the store
  let fetched: StorePurchase;
  try {
    fetched = await provider.fetchPurchase(storeApp, input.productId, input.purchaseKey);
  } catch (err) {
    if (!(err instanceof StoreError)) throw err;
    if (err.reason === 'not_found') throw new AppError(400, 'invalid_purchase', 'The store does not know this purchase');
    throw new AppError(503, 'store_unavailable', 'The store is unavailable, try again later', err.message);
  }
  if (fetched.productId !== input.productId) {
    throw new AppError(400, 'invalid_purchase', 'The purchase is for another product');
  }

  // Confirm a valid purchase even if it goes to another owner below:
  // Google refunds unconfirmed purchases after three days
  let acknowledgedNow = false;
  if (!fetched.acknowledged && GRANTING_STATES.includes(fetched.state)) {
    try {
      await provider.acknowledge(storeApp, fetched);
      acknowledgedNow = true;
    } catch (err) {
      // Retried at the next verification; access does not depend on it
      if (!(err instanceof StoreError)) throw err;
    }
  }

  // The owner: ours if we know the purchase, else the user the store recorded
  const [known] = await db
    .select({ appId: purchases.appId, userId: purchases.userId })
    .from(purchases)
    .where(and(eq(purchases.store, input.store), eq(purchases.purchaseKey, input.purchaseKey)));
  if (known && known.appId !== auth.appId) throw new AppError(400, 'invalid_purchase', 'The purchase is for another app');

  const previousOwnerId = known ? known.userId : isUuid(fetched.accountRef) ? fetched.accountRef : null;
  const owner = previousOwnerId ? await resolveAccount(auth.appId, previousOwnerId) : null;
  const current = await resolveAccount(auth.appId, auth.userId);
  const decision = decideOwnership(auth.userId, current?.linked ?? false, owner);

  const ownerId = decision.kind === 'keep' || decision.kind === 'assign' ? auth.userId : decision.ownerId;
  await db.transaction((tx) =>
    savePurchase(tx, { appId: auth.appId, purchase: fetched, ownerId, acknowledgedNow, source: 'client', now }),
  );

  const status: RegisterStatus =
    decision.kind === 'sign_in_required'
      ? 'sign_in_required'
      : decision.kind === 'other_account'
        ? 'owned_by_other_account'
        : previousOwnerId && previousOwnerId !== auth.userId && owner
          ? 'transferred'
          : 'owned';

  return {
    status,
    maskedEmail: decision.kind === 'sign_in_required' ? decision.maskedEmail : null,
    entitlements: await getEntitlements(auth.appId, auth.userId, now),
  };
}