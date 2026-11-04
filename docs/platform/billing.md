# Billing (subscriptions)

Status: **skeleton, not verified with a real store.** The server core,
purchase registration, the Google Play provider, the SDK and its store plugin
wrapper are built and covered by tests against fake stores. A live check needs
a Google Play Console account; see [Going live](#going-live).

Subscriptions only. One-time products (lifetime unlocks) fit the same model
later; consumables (coins, hints) belong to the app backend.

## Principles

- **The server is the source of truth.** The device never decides access and
  is never trusted with purchase data: the server asks the store itself.
- **The core knows no stores.** It works with a normalized purchase; a store
  provider translates. Google Play is built, the App Store is a second
  provider later, without changes to the core.
- **Entitlements are computed, not stored.** Every request derives them from
  the user's purchases, so they can never drift apart.
- **A purchase is completed on the device only after the server answered.**
  An open purchase is sent again at the next start-up; nothing is lost.

## Data (Postgres schema `billing`)

| Table | Contents |
|-------|----------|
| `products` | Catalog per app and store: product id, kind, entitlements it grants; archived instead of deleted |
| `purchases` | One row per store purchase: owner, normalized state, expiry, auto-renewal, price, currency, country, test flag, store payload |
| `purchase_events` | History: registered, transferred, state changed, renewed, refunded, acknowledged, anonymized |
| `store_notifications` | Store notifications as received, with processing outcome; deduplicated by message id |

## Catalog

A JSON file per app, uploaded with a script (later from the admin panel):

```json
{
  "format_version": 1,
  "products": [
    { "store": "google_play", "product_id": "premium", "kind": "subscription", "entitlements": ["premium"] }
  ]
}
```

```
pnpm billing:catalog <app slug> <path to catalog.json>
```

- Products missing from the file are archived, not deleted; listing them again
  brings them back.
- A product's kind cannot change.
- A Play subscription is one product; its monthly and yearly variants are
  base plans in the Play Console, not separate products.
- Purchases of products missing from the catalog grant nothing.

## States and access

| State | Grants access |
|-------|---------------|
| `active` | Until `expires_at` |
| `canceled` | Until `expires_at` (auto-renewal off, paid period continues) |
| `grace_period` | Yes, while the store retries a failed payment |
| `on_hold`, `paused`, `pending`, `expired` | No |
| `refunded` | No, and final: later store answers never revive it |

Several purchases granting the same entitlement: the longest wins.

## Ownership

Our user id is written into a purchase once, when it is made
(`obfuscatedAccountId` on Google, `appAccountToken` on Apple). The store
account on the device owns the subscription; our owner is set when the server
first sees the purchase and is tracked from then on.

| Situation | Result |
|-----------|--------|
| The current user owns it | `owned` |
| Unknown owner, anonymous owner (can never come back) or deleted owner | `transferred` to the current user (`owned` if there was no owner) |
| Owner with a linked account, current user anonymous | `sign_in_required` with a masked email (`a***@gmail.com`) |
| Owner with a linked account, current user linked to another | `owned_by_other_account` |

A valid purchase is acknowledged to the store in every case, also when it
stays with another owner: Google refunds unacknowledged purchases after three
days.

## API

| Route | Does |
|-------|------|
| `GET /v1/billing/entitlements` | The current user's entitlements |
| `POST /v1/purchases` | `{ store, productId, purchaseKey }` → `{ status, maskedEmail, entitlements }`; a purchase or a restore |
| `POST /v1/billing/google/notifications` | Pub/Sub push of Play notifications; Google's token is verified |

Errors of `POST /v1/purchases`: `unknown_product` (400), `invalid_purchase`
(400, the store does not know it or it is for another product or app),
`store_unavailable` (503, provider not configured or the store did not
answer).

## Lifecycle

- **Merge:** purchases of the merged user move to the account.
- **Account deletion:** purchases stay for revenue records without the
  person: owner, store account reference and store payload removed, amounts
  kept (retention to be confirmed by legal review). Deleting an account does
  not cancel the subscription; only the person can, in the store.
- **Webhook `entitlements.changed`** to the app backend whenever a user's
  access changes, with their current entitlements.

## Google Play provider

- Verification through the Play Developer API (`subscriptionsv2.get`) with a
  service account.
- Acknowledgement after verification.
- Notifications (RTDN) through Pub/Sub push: stored, then processed by a job.
  The content of a notification is not trusted: the job asks Google for the
  current state. A voided purchase notification marks the purchase refunded.
- Jobs: daily refund reconciliation (voided purchases), hourly check of
  purchases past their expiry, cleanup of old notifications.
- Without `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE` the provider is not registered
  and Play purchases are refused with `store_unavailable`.

## SDK (`platform.billing`)

| Member | Does |
|--------|------|
| `entitlements` | `ValueListenable<Entitlements>`; `entitlements.value.has('premium')` |
| `products(ids)` | Products with localized prices, base plans and offers from the store |
| `purchase(product, offer:, paywall:)` | `purchased`, `cancelled`, `pending`, `processing`, `signInRequired`, `ownedByOtherAccount`, `failed` |
| `restore()` | Per active store purchase: `granted`, `signInRequired` (masked email), `ownedByOtherAccount`, `failed` |
| `paywallShown(paywall)` | Records `paywall_shown` |
| `refresh()` | Fetches entitlements now |

- **Cache:** the last server answer is stored per user. On the device an
  entitlement counts until three days past its `expires_at`, so access
  survives a flight; the server's next answer replaces the cache.
- **Refresh:** at start-up, on user changes, after a purchase (the answer
  carries the entitlements) and on return to the app when the data is older
  than an hour.
- **Start-up sync:** active store purchases are sent to the server. This
  delivers purchases left open (server unreachable during the purchase) and
  takes over purchases of an anonymous user after a reinstall.
- **Funnel events** (platform tracking plan, analytics): `paywall_shown`,
  `purchase_started`, `purchase_finished` with the outcome. No prices in
  events: revenue comes from `billing.purchases`.
- **Store:** the official `in_app_purchase` plugin behind the SDK's own
  `StoreClient` interface, so it can be replaced without touching apps.
  Android only for now; on iOS the store reports unavailable until StoreKit
  is wired with the App Store provider.
- `StoreUnavailableException` when there is no usable store: hide or disable
  the paywall.

## Going live

What to do once a Play Console account exists. Nothing here needs code.

1. **Play Console.** Create the app with its package name and upload a build
   to the internal testing track. The store returns no products for an app
   that was never uploaded.
2. **Products.** Create the subscription (`premium`) with its base plans and
   offers. Product ids must match the catalog; upload the catalog with
   `pnpm billing:catalog`.
3. **Package name on the platform.** The app's Android platform row must hold
   the package name: the server looks the app up by it for verification and
   notifications.
4. **Service account.** In Google Cloud enable the Google Play Android
   Developer API, create a service account and a JSON key. In the Play Console
   invite the service account with permission to view financial data and
   manage orders and subscriptions. Point `GOOGLE_PLAY_SERVICE_ACCOUNT_FILE`
   at the key file. The key is a secret: never commit it.
5. **Notifications.** Create a Pub/Sub topic and grant
   `google-play-developer-notifications@system.gserviceaccount.com` the
   Publisher role on it. Create a push subscription to
   `https://<platform host>/v1/billing/google/notifications` with
   authentication enabled; set `GOOGLE_PUBSUB_AUDIENCE` to its audience and
   `GOOGLE_PUBSUB_SERVICE_ACCOUNT` to the service account it signs with.
   Enter the topic in the Play Console (Monetization setup) and send a test
   notification.
6. **First purchase.** Add license testers in the Play Console, install the
   build from the testing track and buy in the demo. Check: a row in
   `billing.purchases` with the right owner, `acknowledged` in its history,
   the entitlement in the SDK, `entitlements.changed` in
   `webhooks.deliveries`.
7. **Scenarios.** Cancel in Google Play (state `canceled`, access until
   expiry); a declined test card (grace period, then on hold); a refund from
   the Play Console (`refunded`, access gone); reinstall and restore as an
   anonymous user (transferred); reinstall after the owner linked Google
   (sign-in required).
8. **Before launch:** legal review of keeping anonymized purchase records.

## Planned

- **Purchase details** (with the Play Console account): base plan and offer
  (`lineItems[].offerDetails`), the current price phase — free trial,
  introductory price, base price (`offerPhase`) — and the latest order id
  `GPA.…` (`latestSuccessfulOrderId`), all from `subscriptionsv2`. The
  catalog gets base plans with their billing period (`monthly: P1M`,
  `yearly: P1Y`): the period is not in the purchase. Needed for MRR, trial
  conversion and finding a purchase by order id in support.
- **App Store provider** (StoreKit 2, App Store Server API and
  notifications) with an Apple Developer account.
- One-time products (lifetime unlocks).
- Purchases as experiment metrics (conversion to a paid plan, revenue).