import { importPKCS8, SignJWT } from 'jose';
import { z } from 'zod';
import { type PurchaseState, StoreError, type StoreApp, type StoreProvider, type StorePurchase } from './types.js';

const API = 'https://androidpublisher.googleapis.com/androidpublisher/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SCOPE = 'https://www.googleapis.com/auth/androidpublisher';
const TIMEOUT_MS = 10_000;

type Fetch = typeof fetch;

// The fields we use from a service account key file
export const serviceAccountSchema = z.object({
  client_email: z.email(),
  private_key: z.string().min(1),
});
export type ServiceAccount = z.infer<typeof serviceAccountSchema>;

// OAuth access tokens of a service account (JWT bearer grant),
// cached until a minute before they expire
export class ServiceAccountTokens {
  private cached: { token: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly fetchFn: Fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  async get(): Promise<string> {
    if (this.cached && this.cached.expiresAt - 60_000 > this.now()) return this.cached.token;

    const issuedAt = Math.floor(this.now() / 1000);
    const assertion = await new SignJWT({ scope: SCOPE })
      .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
      .setIssuer(this.account.client_email)
      .setAudience(TOKEN_URL)
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + 3600)
      .sign(await importPKCS8(this.account.private_key, 'RS256'));

    let response: Response;
    try {
      response = await this.fetchFn(TOKEN_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new StoreError(`Google token request failed: ${String(err)}`, 'unavailable');
    }
    if (!response.ok) throw new StoreError(`Google token request answered ${response.status}`, 'unavailable');

    const body = z.object({ access_token: z.string(), expires_in: z.number() }).safeParse(await response.json());
    if (!body.success) throw new StoreError('Unexpected Google token response', 'unavailable');

    this.cached = { token: body.data.access_token, expiresAt: this.now() + body.data.expires_in * 1000 };
    return body.data.access_token;
  }
}

// ---------- Subscriptions ----------

const subscriptionSchema = z.object({
  startTime: z.string(),
  regionCode: z.string().optional(),
  subscriptionState: z.string(),
  linkedPurchaseToken: z.string().optional(),
  acknowledgementState: z.string().optional(),
  // Present only for license testers
  testPurchase: z.unknown().optional(),
  externalAccountIdentifiers: z.object({ obfuscatedExternalAccountId: z.string().optional() }).optional(),
  lineItems: z
    .array(
      z.object({
        productId: z.string(),
        expiryTime: z.string().optional(),
        autoRenewingPlan: z
          .object({
            autoRenewEnabled: z.boolean().optional(),
            recurringPrice: z
              .object({ currencyCode: z.string().optional(), units: z.string().optional(), nanos: z.number().optional() })
              .optional(),
          })
          .optional(),
      }),
    )
    .min(1),
});

const STATES: Record<string, PurchaseState> = {
  SUBSCRIPTION_STATE_PENDING: 'pending',
  SUBSCRIPTION_STATE_ACTIVE: 'active',
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'grace_period',
  SUBSCRIPTION_STATE_ON_HOLD: 'on_hold',
  SUBSCRIPTION_STATE_PAUSED: 'paused',
  SUBSCRIPTION_STATE_CANCELED: 'canceled',
  SUBSCRIPTION_STATE_EXPIRED: 'expired',
  // The delayed payment never went through
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: 'expired',
};

// A Play subscription (subscriptionsv2) in the shape every store uses
export function mapSubscription(json: unknown, purchaseKey: string): StorePurchase {
  const parsed = subscriptionSchema.safeParse(json);
  if (!parsed.success) throw new StoreError(`Unexpected Google Play response: ${parsed.error.message}`, 'unavailable');
  const s = parsed.data;

  const item = s.lineItems[0];
  const state = STATES[s.subscriptionState];
  // An unknown state must not grant anything by accident: the job retries
  if (!item || !state) throw new StoreError(`Unknown subscription state ${s.subscriptionState}`, 'unavailable');

  const expiries = s.lineItems.flatMap((line) => (line.expiryTime ? [new Date(line.expiryTime).getTime()] : []));
  const price = item.autoRenewingPlan?.recurringPrice;

  return {
    store: 'google_play',
    purchaseKey,
    previousKey: s.linkedPurchaseToken ?? null,
    productId: item.productId,
    state,
    startedAt: new Date(s.startTime),
    expiresAt: expiries.length > 0 ? new Date(Math.max(...expiries)) : null,
    autoRenewing: item.autoRenewingPlan?.autoRenewEnabled ?? false,
    accountRef: s.externalAccountIdentifiers?.obfuscatedExternalAccountId ?? null,
    priceMicros: price ? Number(price.units ?? '0') * 1_000_000 + Math.round((price.nanos ?? 0) / 1000) : null,
    currency: price?.currencyCode ?? null,
    country: s.regionCode ?? null,
    test: s.testPurchase !== undefined,
    acknowledged: s.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
    raw: json,
  };
}

const voidedSchema = z.object({
  voidedPurchases: z.array(z.object({ purchaseToken: z.string(), voidedTimeMillis: z.string() })).optional(),
  tokenPagination: z.object({ nextPageToken: z.string().optional() }).optional(),
});

const enc = encodeURIComponent;

export class GooglePlayProvider implements StoreProvider {
  readonly store = 'google_play' as const;

  constructor(
    private readonly tokens: { get(): Promise<string> },
    private readonly fetchFn: Fetch = fetch,
    private readonly api = API,
  ) {}

  async fetchPurchase(app: StoreApp, _productId: string, purchaseKey: string): Promise<StorePurchase> {
    const json = await this.call('GET', `/applications/${enc(app.packageName)}/purchases/subscriptionsv2/tokens/${enc(purchaseKey)}`);
    return mapSubscription(json, purchaseKey);
  }

  async acknowledge(app: StoreApp, purchase: StorePurchase): Promise<void> {
    await this.call(
      'POST',
      `/applications/${enc(app.packageName)}/purchases/subscriptions/${enc(purchase.productId)}/tokens/${enc(purchase.purchaseKey)}:acknowledge`,
    );
  }

  async listVoided(app: StoreApp, since: Date): Promise<{ purchaseKey: string; voidedAt: Date }[]> {
    const result: { purchaseKey: string; voidedAt: Date }[] = [];
    let pageToken: string | undefined;
    do {
      // type 1: subscriptions too, not only one-time products
      const query = new URLSearchParams({
        startTime: String(since.getTime()),
        type: '1',
        maxResults: '1000',
        ...(pageToken ? { token: pageToken } : {}),
      });
      const parsed = voidedSchema.safeParse(
        await this.call('GET', `/applications/${enc(app.packageName)}/purchases/voidedpurchases?${query}`),
      );
      if (!parsed.success) throw new StoreError('Unexpected voided purchases response', 'unavailable');

      for (const voided of parsed.data.voidedPurchases ?? []) {
        result.push({ purchaseKey: voided.purchaseToken, voidedAt: new Date(Number(voided.voidedTimeMillis)) });
      }
      pageToken = parsed.data.tokenPagination?.nextPageToken;
    } while (pageToken);
    return result;
  }

  private async call(method: 'GET' | 'POST', path: string): Promise<unknown> {
    const token = await this.tokens.get();
    let response: Response;
    try {
      response = await this.fetchFn(`${this.api}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        },
        ...(method === 'POST' ? { body: '{}' } : {}),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      throw new StoreError(`Google Play request failed: ${String(err)}`, 'unavailable');
    }

    // Unknown token, or a purchase too old to be kept by Google
    if (response.status === 404 || response.status === 410) {
      throw new StoreError(`Google Play does not know this purchase (${response.status})`, 'not_found');
    }
    if (!response.ok) throw new StoreError(`Google Play answered ${response.status}`, 'unavailable');

    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : {};
  }
}