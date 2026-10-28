# Status

What is done and what is left for stage 0. Updated together with every
feature commit.

Legend: **Done** · **Partial** · **Planned** · **Deferred** (waiting for an
external dependency)

## Overview

| Area | Server | Flutter SDK | Admin |
|------|--------|-------------|-------|
| Foundation (config, DB, errors, tests) | Done | Planned | Planned |
| 1. Identity | Partial | Partial | Planned |
| 2. Event tracking | Planned | Planned | Planned |
| 3. Offline-first sync | Planned | Planned | — |
| 4. Remote config & A/B tests | Planned | Planned | Planned |
| 5. Subscriptions | Planned | Planned | Planned |
| 6. Attribution | Planned | Planned | — |
| 7. Push notifications | Planned | Planned | Planned |
| 8. Dashboards & alerts | Planned | — | Planned |
| 9. Protection & engagement | Planned | Planned | — |
| Consent | Partial (schema) | Planned | Planned |
| Deployment | Planned | — | — |

## Foundation

| Item | Status |
|------|--------|
| Monorepo, pnpm workspaces, Node 24, editorconfig | Done |
| Local Postgres 18 in Docker | Done |
| Fastify server, zod config validation, pretty logs, graceful shutdown | Done |
| Drizzle ORM, generated migrations, migrate script | Done |
| Unified error format, `AppError` with logged internal reasons | Done |
| `GET /health` with database check | Done |
| Vitest integration tests on a separate test database | Done |
| ESLint and Prettier | Planned |
| CI (typecheck + tests on every push) | Planned |
| API reference generated from zod schemas (`@fastify/swagger`) | Planned |
| Background job queue (pg-boss) | Planned |

## 1. Identity

Details: [identity.md](identity.md).

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
| Apple sign-in (iOS only), code exchange, encrypted Apple refresh token | Deferred: needs an Apple Developer account |
| Device details and geo from IP (with analytics consent) | Planned |
| Consents API (record, current state, re-prompt timing) | Planned |
| Account deletion (`DELETE /v1/me`, scheduled erasure, Apple revocation) | Planned |
| Merge delivery to app backends (signed webhook, retries, `notified_at`) | Planned: needs the job queue |
| Cleanup of nonces of abandoned installations | Planned: needs the job queue |
| Trusted proxy for rate limits behind Caddy | Planned: with deployment |
| Admin: register apps, platforms, OAuth clients | Planned (script for now: `pnpm db:seed`) |

## 2. Event tracking

| Item | Status |
|------|--------|
| Tracking plan (YAML) with event categories (essential / analytics) | Planned |
| Code generation: Dart classes and server validation | Planned |
| Batched ingestion endpoint, deduplication by event id | Planned |
| Event table partitioned by month, context columns + JSON properties | Planned |
| Consent gating on the server | Planned |

## 3. Offline-first sync

| Item | Status |
|------|--------|
| Sync library for app backends (`packages/`) | Planned |
| Outbox, cursor-based pull, per-field last-write-wins | Planned |

## 4. Remote config & A/B tests

| Item | Status |
|------|--------|
| Config keys with defaults, overrides per experiment | Planned |
| Hash-based assignment, layers with salts, global holdout | Planned |
| Exposure events, kill switches | Planned |
| Decision logging (variant, policy, probability) | Planned |

## 5. Subscriptions

| Item | Status |
|------|--------|
| Play Billing purchase verification and acknowledge | Planned |
| RTDN via Pub/Sub push: grace period, account hold, cancel, refunds | Planned |
| Entitlements as source of truth, restore | Planned |
| "Consent or pay" ad-free entitlement | Planned |
| App Store (StoreKit, server notifications) | Deferred |

## 6–9. Other systems

| Item | Status |
|------|--------|
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