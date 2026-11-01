import { decodeJwt, exportPKCS8, generateKeyPair } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { GooglePlayProvider, mapSubscription, ServiceAccountTokens } from './google-play.js';
import { StoreError } from './types.js';

const subscription = {
  kind: 'androidpublisher#subscriptionPurchaseV2',
  regionCode: 'DE',
  startTime: '2026-10-01T10:00:00.000Z',
  subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
  acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
  externalAccountIdentifiers: { obfuscatedExternalAccountId: '0190a000-0000-7000-8000-000000000001' },
  lineItems: [
    {
      productId: 'premium',
      expiryTime: '2026-11-01T10:00:00.000Z',
      autoRenewingPlan: { autoRenewEnabled: true, recurringPrice: { currencyCode: 'EUR', units: '4', nanos: 990000000 } },
      offerDetails: { basePlanId: 'monthly' },
    },
  ],
};

type Call = { url: string; init: RequestInit | undefined };

// A fetch that answers from a list and records the calls
function fakeFetch(answers: (url: string) => Response) {
  const calls: Call[] = [];
  const fn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return answers(url);
  }) as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('mapSubscription', () => {
  it('maps a Play subscription', () => {
    expect(mapSubscription(subscription, 'token-1')).toMatchObject({
      store: 'google_play',
      purchaseKey: 'token-1',
      productId: 'premium',
      state: 'active',
      startedAt: new Date('2026-10-01T10:00:00.000Z'),
      expiresAt: new Date('2026-11-01T10:00:00.000Z'),
      autoRenewing: true,
      accountRef: '0190a000-0000-7000-8000-000000000001',
      priceMicros: 4_990_000,
      currency: 'EUR',
      country: 'DE',
      test: false,
      acknowledged: false,
    });
  });

  it.each([
    ['SUBSCRIPTION_STATE_IN_GRACE_PERIOD', 'grace_period'],
    ['SUBSCRIPTION_STATE_ON_HOLD', 'on_hold'],
    ['SUBSCRIPTION_STATE_PAUSED', 'paused'],
    ['SUBSCRIPTION_STATE_CANCELED', 'canceled'],
    ['SUBSCRIPTION_STATE_EXPIRED', 'expired'],
    ['SUBSCRIPTION_STATE_PENDING', 'pending'],
    ['SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED', 'expired'],
  ])('maps %s to %s', (googleState, state) => {
    expect(mapSubscription({ ...subscription, subscriptionState: googleState }, 't').state).toBe(state);
  });

  it('marks tester purchases and refuses unknown states', () => {
    expect(mapSubscription({ ...subscription, testPurchase: {} }, 't').test).toBe(true);
    expect(() => mapSubscription({ ...subscription, subscriptionState: 'SUBSCRIPTION_STATE_NEW' }, 't')).toThrow(
      StoreError,
    );
  });
});

describe('ServiceAccountTokens', () => {
  let privateKey: string;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256', { extractable: true });
    privateKey = await exportPKCS8(pair.privateKey);
  });

  it('gets a token with a signed assertion and caches it', async () => {
    const { fn, calls } = fakeFetch(() => json({ access_token: 'token-1', expires_in: 3600 }));
    const tokens = new ServiceAccountTokens({ client_email: 'billing@test.iam.gserviceaccount.com', private_key: privateKey }, fn);

    expect(await tokens.get()).toBe('token-1');
    expect(await tokens.get()).toBe('token-1');

    expect(calls).toHaveLength(1);
    const body = new URLSearchParams(String(calls[0]?.init?.body));
    expect(body.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer');
    expect(decodeJwt(body.get('assertion') ?? '')).toMatchObject({
      iss: 'billing@test.iam.gserviceaccount.com',
      aud: 'https://oauth2.googleapis.com/token',
      scope: 'https://www.googleapis.com/auth/androidpublisher',
    });
  });
});

describe('GooglePlayProvider', () => {
  const app = { appId: 'app-1', packageName: 'com.example.test' };
  const tokens = { get: async () => 'access-1' };

  it('fetches a subscription with the access token', async () => {
    const { fn, calls } = fakeFetch(() => json(subscription));

    const purchase = await new GooglePlayProvider(tokens, fn).fetchPurchase(app, 'premium', 'token/1');

    expect(purchase.state).toBe('active');
    expect(calls[0]?.url).toBe(
      'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example.test/purchases/subscriptionsv2/tokens/token%2F1',
    );
    expect((calls[0]?.init?.headers as Record<string, string>).authorization).toBe('Bearer access-1');
  });

  it('tells unknown purchases from an unavailable store', async () => {
    const notFound = new GooglePlayProvider(tokens, fakeFetch(() => json({}, 410)).fn);
    const failing = new GooglePlayProvider(tokens, fakeFetch(() => json({}, 503)).fn);

    await expect(notFound.fetchPurchase(app, 'premium', 't')).rejects.toMatchObject({ reason: 'not_found' });
    await expect(failing.fetchPurchase(app, 'premium', 't')).rejects.toMatchObject({ reason: 'unavailable' });
  });

  it('acknowledges a subscription', async () => {
    const { fn, calls } = fakeFetch(() => new Response('', { status: 200 }));

    await new GooglePlayProvider(tokens, fn).acknowledge(app, mapSubscription(subscription, 'token-1'));

    expect(calls[0]?.init?.method).toBe('POST');
    expect(calls[0]?.url).toBe(
      'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.example.test/purchases/subscriptions/premium/tokens/token-1:acknowledge',
    );
  });

  it('lists refunds of subscriptions across pages', async () => {
    const { fn, calls } = fakeFetch((url) =>
      url.includes('token=page-2')
        ? json({ voidedPurchases: [{ purchaseToken: 'b', voidedTimeMillis: '1761990000000' }] })
        : json({
            voidedPurchases: [{ purchaseToken: 'a', voidedTimeMillis: '1761980000000' }],
            tokenPagination: { nextPageToken: 'page-2' },
          }),
    );

    const voided = await new GooglePlayProvider(tokens, fn).listVoided(app, new Date('2026-10-30T00:00:00.000Z'));

    expect(voided.map((v) => v.purchaseKey)).toEqual(['a', 'b']);
    expect(new URL(calls[0]?.url ?? '').searchParams.get('type')).toBe('1');
  });
});