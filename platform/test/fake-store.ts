import { StoreError, type StoreProvider, type StorePurchase } from '../src/modules/billing/types.js';

// A Google Play stand-in: tests put purchases in and change them
export class FakeStore implements StoreProvider {
  readonly store = 'google_play' as const;
  readonly purchases = new Map<string, StorePurchase>();
  readonly acknowledged: string[] = [];
  failure: StoreError | null = null;

  readonly voided: { purchaseKey: string; voidedAt: Date }[] = [];

  async listVoided(): Promise<{ purchaseKey: string; voidedAt: Date }[]> {
    return [...this.voided];
  }

  add(overrides: Partial<StorePurchase> & { purchaseKey: string }): StorePurchase {
    const purchase: StorePurchase = {
      store: 'google_play',
      previousKey: null,
      productId: 'premium',
      state: 'active',
      startedAt: new Date(),
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      autoRenewing: true,
      accountRef: null,
      priceMicros: 4_990_000,
      currency: 'EUR',
      country: 'DE',
      test: false,
      acknowledged: false,
      raw: { fake: true },
      ...overrides,
    };
    this.purchases.set(purchase.purchaseKey, purchase);
    return purchase;
  }

  async fetchPurchase(_app: unknown, _productId: string, purchaseKey: string): Promise<StorePurchase> {
    if (this.failure) throw this.failure;
    const purchase = this.purchases.get(purchaseKey);
    if (!purchase) throw new StoreError(`Unknown purchase ${purchaseKey}`, 'not_found');
    return { ...purchase };
  }

  async acknowledge(_app: unknown, purchase: StorePurchase): Promise<void> {
    this.acknowledged.push(purchase.purchaseKey);
    const stored = this.purchases.get(purchase.purchaseKey);
    if (stored) stored.acknowledged = true;
  }
}