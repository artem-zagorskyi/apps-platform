# Status

What is done and what is left for stage 0. Updated together with every
feature commit.

Legend: **Done** · **Partial** · **Planned** · **Deferred** (waiting for an
external dependency)

## Overview

| Area | Server | Flutter SDK | Admin |
|------|--------|-------------|-------|
| Foundation (config, DB, errors, logs, tests) | Done | Done | Planned |
| 1. Identity | Partial | Partial | Planned |
| Consent | Done | Done | Planned |
| 2. Event tracking | Done | Done | Planned |
| 3. Offline-first sync | Planned | Planned | — |
| 4. Remote config & A/B tests | Planned | Planned | Planned |
| 5. Subscriptions | Planned | Planned | Planned |
| 6. Attribution | Planned | Planned | — |
| 7. Push notifications | Planned | Planned | Planned |
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
| Background job queue (pg-boss) | Planned |

### Flutter SDK

| Item | Status |
|------|--------|
| Package `renvix_sdk` with Android plugin part, strict analyzer | Done |
| Secure key-value storage (Keystore / Keychain, this device only) | Done |
| Platform API client with typed errors (`ApiException`, `ServerException`, `NetworkException`) | Done |
| SQLite database for the event queue (`sqflite`) | Done |
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
| Apple sign-in (iOS only), code exchange, encrypted Apple refresh token | Deferred: needs an Apple Developer account |
| Installation update on launch (app version, device details with analytics consent, geo) | Planned |
| Account deletion (`DELETE /v1/me`, scheduled erasure, Apple revocation) | Planned |
| Merge delivery to app backends (signed webhook, retries, `notified_at`) | Planned: needs the job queue |
| Cleanup of nonces of abandoned installations | Planned: needs the job queue |
| Trusted proxy for rate limits behind Caddy | Planned: with deployment |
| Admin: register apps, platforms, OAuth clients | Planned (script for now: `pnpm db:seed`) |

### Flutter SDK

| Item | Status |
|------|--------|
| Session manager: start-up, offline mode, single-flight refresh, retry on 401, dead session reset | Done |
| `AppPlatform` entry point, client info, `GET /v1/me` | Done |
| Google sign-in on Android (Credential Manager, own Kotlin code), merge dialog | Done, verified on the emulator |
| Logout | Done, verified on the emulator |
| Google / Apple sign-in on iOS | Deferred |
| Account deletion | Planned |

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
| Monthly partitioned `events.events`, partitions created ahead | Done |
| Invalid events stored with a flag and logged as a warning | Done |
| Country from IP | Partial: code done, database file with deployment |
| Anonymization after 26 months and on account deletion | Planned: needs the job queue |
| Cleanup of old `event_ids` | Planned: needs the job queue |
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

## 3–9. Other systems

| Item | Status |
|------|--------|
| Offline-first sync: library for app backends, outbox, cursor pull, per-field last-write-wins | Planned |
| Remote config, hash-based assignment, layers, global holdout, exposure events, kill switches | Planned |
| Decision logging (variant, policy, probability) | Planned |
| Play Billing verification, RTDN, entitlements, restore | Planned |
| App Store (StoreKit, server notifications) | Deferred |
| Install Referrer, server-side conversions to ad networks | Planned |
| FCM tokens, templates, scheduler, weekly budget, delivery logs | Planned |
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
