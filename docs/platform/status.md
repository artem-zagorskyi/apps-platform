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
| 2. Event tracking | Planned (designed) | Planned (designed) | Planned |
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
| Demo app (`sdk/flutter/example`) as a test bench | Done |
| Local SQLite database for the SDK (`drift`) | Planned: with events |

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

| Item | Status |
|------|--------|
| Policies per region, append-only consent log (schema) | Done |
| `GET /v1/consent`, `POST /v1/consent` with clock correction | Done |
| "Ask everyone" policy for the demo app (`db:seed`) | Done |
| SDK: local decisions, state, offline queue, user changes | Done |
| Demo: consent screen and settings toggles | Done, verified on the emulator |
| GeoIP (country from IP) | Planned: with events |
| SDK: withdrawal removes queued analytics events | Planned: with events |
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

Designed; implementation after consent.

| Item | Status |
|------|--------|
| Tracking plan (YAML): platform events here, app events in the app repo, uploaded to the server | Planned |
| Code generation: Dart functions and server validation | Planned |
| `POST /v1/events`: batches up to 100, dedup by `event_id`, clock skew correction, country from IP | Planned |
| Monthly partitioned `events.events` table | Planned |
| Invalid events stored with a flag and alerted, not dropped | Planned |
| SDK queue in its own SQLite database, batched upload, offline limit | Planned |
| Standard platform events (`app_installed`, `app_opened`, sessions, `app_updated`, account and consent events) | Planned |
| Queue flushed before a user switch (logout, merge) | Planned |

Decisions:

- Categories: `essential` (always recorded) and `analytics` (only with
  consent; not even stored on the device without it).
- No free text typed by the person in event properties.
- Session: a new one after 30 minutes in the background.
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
| Encrypted off-site database backups | Planned |
| VPN access to the admin | Planned |