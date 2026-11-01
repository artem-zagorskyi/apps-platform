import type { Store, StoreProvider } from './types.js';

// Stores the server can talk to. Google Play is registered at start-up when
// its credentials are configured; without a provider purchases of that store
// are refused with store_unavailable.
const providers = new Map<Store, StoreProvider>();

export function registerStoreProvider(provider: StoreProvider): void {
  providers.set(provider.store, provider);
}

export function getStoreProvider(store: Store): StoreProvider | null {
  return providers.get(store) ?? null;
}

export function clearStoreProvidersForTests(): void {
  providers.clear();
}