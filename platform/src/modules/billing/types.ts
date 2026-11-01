import type { purchaseStateEnum, storeEnum } from './schema.js';

export type Store = (typeof storeEnum.enumValues)[number];
export type PurchaseState = (typeof purchaseStateEnum.enumValues)[number];

// The app as a store knows it
export interface StoreApp {
  appId: string;
  // Android package name or iOS bundle id
  packageName: string;
}

// A purchase as a store reports it, in the same shape for every store
export interface StorePurchase {
  store: Store;
  purchaseKey: string;
  previousKey: string | null;
  productId: string;
  state: PurchaseState;
  startedAt: Date;
  expiresAt: Date | null;
  autoRenewing: boolean;
  // Our user id recorded at purchase time, if the app passed one
  accountRef: string | null;
  priceMicros: number | null;
  currency: string | null;
  country: string | null;
  test: boolean;
  acknowledged: boolean;
  // The store's answer as is
  raw: unknown;
}

// One store (Google Play now, App Store later). The core never talks to a
// store directly. Notifications and refunds are added with the Google provider.
export interface StoreProvider {
  store: Store;
  // The current state from the store; throws StoreError for an unknown purchase
  fetchPurchase(app: StoreApp, productId: string, purchaseKey: string): Promise<StorePurchase>;
  // Confirms a verified purchase (Google refunds unconfirmed ones after three days)
  acknowledge(app: StoreApp, purchase: StorePurchase): Promise<void>;
}

export class StoreError extends Error {
  constructor(
    message: string,
    // not_found: the store does not know the purchase; unavailable: try again later
    readonly reason: 'not_found' | 'unavailable',
  ) {
    super(message);
    this.name = 'StoreError';
  }
}