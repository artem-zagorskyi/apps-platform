# Status

What is done and what is left for stage 0. Updated together with every
feature commit.

Legend: **Done** · **Partial** · **Planned** · **Deferred** (waiting for an
external dependency) · **Skeleton** (built and tested against fakes, waiting
for a live check)

## Overview

| Area | Server | Flutter SDK | Admin |
|------|--------|-------------|-------|
| Foundation (config, DB, errors, logs, tests) | Done | Done | Planned |
| 1. Identity | Partial | Partial | Planned |
| Consent | Done | Done | Planned |
| 2. Event tracking | Done | Done | Planned |
| 3. Offline-first sync | Designed, deferred | Designed, deferred | — |
| 4. Remote config & A/B tests | Done | Done | Planned |
| 5. Subscriptions | Skeleton | Skeleton | Planned |
| 6. Attribution | Planned | Planned | — |
| 7. Push notifications | Designed, deferred | Designed, deferred | Planned |
| 8. Dashboards & alerts | Planned | — | Planned |
| 9. Protection & engagement | Planned | Planned | — |
| Deployment | Planned | — | — |

## Foundation

### Server

| Item | Status |
|------|--------|
| Monorepo, pnpm workspaces, Node 24, editorconfig | Done |
| Local Postgres 18 in Docker | Done |
| Fastify server, zod config validation, pretty logs, graceful shutdown | Done |
| Drizzle ORM, generated migrations, migrate script | Done |
| Unified error format, `AppError` with logged internal reasons | Done |
| `GET /health` with database check | Done |
| Request logs without the client IP | Done |
| Vitest integration tests on a separate test database | Done |
| ESLint and Prettier | Planned |
| CI (typecheck + tests on every push) | Planned |
| API reference generated from zod schemas (`@fastify/swagger`) | Planned |
| Background job queue (pg-boss) in the server process, cleanup schedules | Done |
| Encrypted secrets in the database (`DATA_ENCRYPTION_KEY`) | Done |
| Webhooks to app backends: signed, retried for three days | Done |
| `packages/platform-client` for app backends: token and webhook verification | Done |

### Flutter SDK

| Item | Status |
|------|--------|
| Package `renvix_sdk` with Android plugin part, strict analyzer | Done |
| Secure key-value storage (Keystore / Keychain, this device only) | Done |
| Platform API client with typed errors (`ApiException`, `ServerException`, `NetworkException`) | Done |
| SQLite database for the event queue (`sqflite`) | Done |
| Access for app backends: `accessToken`, `withAccessToken`, hooks before a user switch | Done |
| Demo app (`sdk/flutter/example`) as a test bench | Done |

## 1. Identity

Details: [identity.md](identity.md).

### Server

| Item | Status |
|------|--------|
| Apps, platforms, OAuth clients, consent policies (schema) | Done |
| Users, installations, auth identities, sessions, merges, consents, nonces (schema) | Done |
| EdDSA access tokens, JWKS endpoint, key rotation procedure | Done |
| Anonymous sign-up | Done |
| Refresh rotation with grace window and theft detection | Done |
| `requireAuth` and `GET /v1/me` | Done |
| Logout with device handover | Done |
| Sign-in nonces | Done |
| Google sign-in, linking, two-step merge of anonymous users | Done |
| Google web client ID registered by `db:seed` from `.env` | Done |
| App accounts: provider `external` with backend-signed assertions, key rotation, `identity:key` | Done |
| Apple sign-in (iOS only), code exchange, encrypted Apple refresh token | Deferred: needs an Apple Developer account |
| Installation update on launch (app version, device details with analytics consent, geo) | Planned |
| Account deletion: `DELETE /v1/me`, erasure job, event anonymization, `user.deleted` | Done |
| Web page for deletion requests (Google Play) | Planned: with the website or admin |
| Apple token revocation on deletion | Deferred: with Apple sign-in |
| Merge delivery to app backends (`user.merged` webhook) | Done |
| Cleanup of old nonces and ended sessions | Done |
| Trusted proxy for rate limits behind Caddy | Planned: with deployment |
| Admin: register apps, platforms, OAuth clients | Planned (script for now: `pnpm db:seed`) |
| Activity days for all users (DAU, retention without analytics consent) | Planned: after legal review |
| Activity feed per user for support: sign-ins, links, consents, merges, purchases | Planned: with the admin |

### Flutter SDK

| Item | Status |
|------|--------|
| Session manager: start-up, offline mode, single-flight refresh, retry on 401, dead session reset | Done |
| `AppPlatform` entry point, client info, `GET /v1/me` | Done |
| Google sign-in on Android (Credential Manager, own Kotlin code), merge dialog | Done, verified on the emulator |
| Logout | Done, verified on the emulator |
| `signInWithAccount` for app accounts, demo with a stand-in login | Done |
| Google / Apple sign-in on iOS | Deferred |
| Account deletion, demo button with confirmation | Done, verified on the emulator |

## Consent

Details: [identity.md](identity.md#get-v1consent).

| Item | Status |
|------|--------|
| Policies per region, append-only consent log (schema) | Done |
| `GET /v1/consent`, `POST /v1/consent` with clock correction | Done |
| "Ask everyone" policy for the demo app (`db:seed`) | Done |
| SDK: local decisions, state, offline queue, user changes | Done |
| SDK: withdrawal removes queued analytics events | Done |
| Demo: consent screen and settings toggles | Done, verified on the emulator |
| GeoIP (country from IP) | Partial: code done, database file with deployment |
| Ads consent (Google UMP, TCF) and "consent or pay" | Planned: with the ads system |

Decisions:

- Own consent screen for analytics and personalization; the app draws it,
  the SDK provides state and recording.
- Everyone is asked: as a German business, GDPR and the German consent rules
  apply to all users. Regional policies stay in the database in case legal
  review allows exceptions.
- After a merge the account's existing decisions apply; without them the
  person is asked. After logout the person is asked again.

## 2. Event tracking

Details: [events.md](events.md).

### Server

| Item | Status |
|------|--------|
| Tracking plan format, validation of events against the plan | Done |
| Platform plan read at start-up; app plans uploaded with `pnpm plan:upload` | Done |
| Compatibility check on upload (plan only grows) | Done |
| `POST /v1/events`: batches up to 100, dedup by `event_id`, clock correction, consent check | Done |
| Counts of events refused on arrival (`no_consent`) per day, platform and app version | Done |
| Monthly partitioned `events.events`, partitions created ahead | Done |
| Invalid events stored with a flag and logged as a warning | Done |
| Country from IP | Partial: code done, database file with deployment |
| Anonymization on account deletion | Done |
| Anonymization after 26 months | Planned |
| Cleanup of old `event_ids` (90 days) | Done |
| Alerts on invalid events | Planned: with the alerts system |
| Plan upload from the admin panel or CI | Planned |

### Flutter SDK

| Item | Status |
|------|--------|
| Code generator: typed Dart and normalized JSON, compatibility check | Done |
| Event queue in SQLite, batched upload, offline limit | Done |
| Consent: analytics not recorded without consent, dropped on withdrawal | Done |
| Upload every 30 seconds, after 50 events, on background, before a user switch | Done |
| Standard events: install, update, app opens, sessions, screens | Done, verified on the emulator |
| Session id on every event | Done |
| Demo: own tracking plan and events section | Done, verified on the emulator |
| Device details with analytics consent | Planned: with the installation update |

Decisions:

- Categories: `essential` (always recorded) and `analytics` (only with
  consent; not even stored on the device without it).
- No free text typed by the person in event properties.
- Before consent only two facts are kept (install and session start not yet
  recorded); they are recorded once consent is given.
- Session: a new one after 30 minutes in the background, also across process
  restarts.
- Account and consent changes are not events: the server has them in its tables.
- Raw events with identifiers kept 26 months, then anonymized (identifiers
  removed, time rounded to the day); deleted or anonymized on account
  deletion. Aggregates and trained models kept without limit. Needs legal review.

## 4. Remote config & A/B tests

Details: [config.md](config.md).

### Server

| Item | Status |
|------|--------|
| Parameter declarations per app, compatibility check, `pnpm config:schema` | Done |
| Config document: force, rules, values, experiments, layers, holdout | Done |
| Checks on publish: declarations, weights, overlapping traffic, shared parameters | Done |
| Experiment lifecycle (draft, running, stopped), server-set start and stop times | Done |
| Numbered versions, rollback by republishing, `pnpm config:publish` / `config:show` | Done |
| Evaluation: SHA-256 buckets, holdout, layers, targeting, forced testers | Done |
| `GET /v1/config` with ETag and 304; active version cached for a minute | Done |
| Explanation per user, also for a draft: experiment and bucket, rule, force, why not; `pnpm config:explain` | Done |
| `experiment_exposed` platform event | Done |
| Editing, publishing and the holdout setting in the admin panel | Planned: with the admin |
| Results per experiment: merged users resolved, quarantine, conversion lift with interval and chance to win, SRM; `pnpm experiment:results` | Done |
| Results in the admin panel; other metrics; CUPED, sequential tests | Planned |
| Rules on device details and on the app build | Planned |
| Bandits and personalization | Planned |
| Warnings: experiments running over 40 days, `force` set over 7 days | Planned: with the admin |
| Keeping the variant across a merge (if the quarantine grows large) | Planned |

### Flutter SDK

| Item | Status |
|------|--------|
| Generator: typed config class and JSON, compatibility check | Done |
| `ConfigValues`: server values with the app's own checks, defaults as fallback | Done |
| `ConfigManager`: first launch wait, pending until the next launch, activate, refresh after an hour | Done |
| User changes, ETag, offline | Done |
| Exposures once per session; not for testers, unusable values or without consent | Done |
| Demo: own parameters, paywall experiment, config section | Done, verified on the emulator |

Decisions:

- Parameters are declared by the app (YAML with generated code); values,
  rules and experiments live on the server as numbered versions.
- The server computes the values; the phone never sees rules or other
  experiments.
- New values apply at the next launch, except the first launch, user
  changes and `activate()`.
- Holdout is off by default; it will be switched and sized in the admin panel.
- Results count exposed users only.

## 5. Subscriptions

Details: [billing.md](billing.md). Built and tested against fake stores; a
live check needs a Play Console account ([going live](billing.md#going-live)).

### Server

| Item | Status |
|------|--------|
| Catalog per app and store, `pnpm billing:catalog`, archive instead of delete | Done |
| Purchases with normalized states and history; entitlements computed per request | Done |
| `GET /v1/billing/entitlements`, `POST /v1/purchases` with ownership rules | Done |
| Acknowledgement, transfer on merge, anonymization on account deletion | Done |
| `entitlements.changed` webhook | Done |
| Google Play provider: Play Developer API, Pub/Sub notifications, refund reconciliation, overdue checks | Skeleton: needs a Play Console account |
| Purchase details: base plan and period, offer, price phase (trial), order id ([planned](billing.md#planned)) | Planned: with the Play Console account |
| App Store provider (StoreKit, server notifications) | Deferred: needs an Apple Developer account |
| One-time products | Planned |
| Revenue in the dashboards | Planned: with the dashboards |

### Flutter SDK

| Item | Status |
|------|--------|
| `platform.billing`: entitlements with an offline cache, products, purchase, restore | Done |
| Purchases completed only after the server answered; open purchases sent again at start-up | Done |
| Funnel events `paywall_shown`, `purchase_started`, `purchase_finished` | Done |
| Google Play through `in_app_purchase` behind `StoreClient` | Skeleton: needs a Play Console account |
| StoreKit on iOS | Deferred |
| Demo paywall | Planned: with the Play Console account |

Decisions:

- The server decides access; the device only shows it and keeps the last
  answer until three days past expiry.
- A purchase of an anonymous or deleted user goes to whoever restores it; a
  purchase of a linked account asks to sign in to that account.
- Purchase records are kept anonymized after account deletion, for revenue
  records. Needs legal review.
- The catalog is a JSON file uploaded with a script; the admin panel later.

## 3, 6–9. Other systems

| Item | Status |
|------|--------|
| Offline-first sync: optional toolkit for app backends ([design](../sync/design.md)) | Designed; built with the first app that needs offline data |
| Install Referrer, server-side conversions to ad networks | Planned |
| Push notifications: FCM, campaigns, limits, decision log ([design](../push/design.md)) | Designed; built with the first app that needs them |
| Cohort retention, funnels, user states, Telegram alerts | Planned |
| Play Integrity on purchases and rewards | Planned |
| Streaks, in-app review, ad frequency rules | Planned |
| Crash reporting (Crashlytics) | Planned |

## Deployment

| Item | Status |
|------|--------|
| Dockerfile for the platform (build, migrate, start) | Planned |
| Production Compose: postgres, platform, admin, caddy | Planned |
| GeoIP country database (DB-IP Lite) on the server | Planned |
| Encrypted off-site database backups | Planned |
| VPN access to the admin | Planned |
