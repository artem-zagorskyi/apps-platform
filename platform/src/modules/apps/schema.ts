import {
  foreignKey,
  integer,
  pgSchema,
  primaryKey,
  text,
  unique,
  uuid,
  jsonb,
  check,
} from 'drizzle-orm/pg-core';
import { createdAt, primaryId, tz } from '../../core/columns.js';
import type { JWK } from 'jose';
import {sql} from 'drizzle-orm';

// All tables of this module live in the "apps" Postgres schema
export const appsSchema = pgSchema('apps');

// Fixed value lists. platform and auth_provider are reused by other modules.
export const appStatusEnum = appsSchema.enum('app_status', ['active', 'disabled']);
export const platformEnum = appsSchema.enum('platform', ['android', 'ios']);
export const authProviderEnum = appsSchema.enum('auth_provider', ['google', 'apple', 'external']);
export const consentModeEnum = appsSchema.enum('consent_mode', [
  'none', // no consent screen
  'optional', // consent screen, the app works after refusal
  'consent_or_pay', // consent or an ad-free subscription
]);

// A product. One app has one id across both platforms.
export const apps = appsSchema.table(
  'apps',
  {
    id: primaryId(),
    slug: text('slug').notNull().unique(),
    name: text('name').notNull(),
    status: appStatusEnum('status').notNull().default('active'),
    createdAt: createdAt(),
  },
  // "all" stands for every app in admin panel URLs (/apps/all/...)
  () => [check('apps_slug_not_all', sql`slug <> 'all'`)],
);

// Per-platform identity of an app: package name on Android, bundle ID on iOS
export const appPlatforms = appsSchema.table(
  'app_platforms',
  {
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    platform: platformEnum('platform').notNull(),
    bundleId: text('bundle_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.appId, t.platform] }),
    // One package name / bundle ID belongs to one app: store notifications
    // and sign-in tokens are matched to the app through it
    unique('app_platforms_platform_bundle_key').on(t.platform, t.bundleId),
  ],
);

// Client IDs accepted in Google / Apple sign-in tokens for an app platform
export const oauthClients = appsSchema.table(
  'oauth_clients',
  {
    id: primaryId(),
    appId: uuid('app_id').notNull(),
    platform: platformEnum('platform').notNull(),
    provider: authProviderEnum('provider').notNull(),
    clientId: text('client_id').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // The platform must be registered for this app
    foreignKey({
      columns: [t.appId, t.platform],
      foreignColumns: [appPlatforms.appId, appPlatforms.platform],
    }),
    unique().on(t.appId, t.provider, t.clientId),
  ],
);

// Consent rules per region, e.g. "EEA" -> consent_or_pay, "*" -> none
export const consentPolicies = appsSchema.table(
  'consent_policies',
  {
    id: primaryId(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    region: text('region').notNull(),
    mode: consentModeEnum('mode').notNull(),
    policyVersion: text('policy_version').notNull(),
    // How long to wait after a refusal before asking again
    repromptAfterDays: integer('reprompt_after_days').notNull().default(180),
    createdAt: createdAt(),
  },
  (t) => [unique().on(t.appId, t.region)],
);

// 'android' | 'ios', derived from the enum so both always match
export type Platform = (typeof platformEnum.enumValues)[number];

// Public keys of an app backend that signs identity assertions for its own
// accounts (provider "external"). Several keys allow rotation.
export const identityKeys = appsSchema.table(
  'identity_keys',
  {
    id: primaryId(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    kid: text('kid').notNull(),
    publicJwk: jsonb('public_jwk').$type<JWK>().notNull(),
    createdAt: createdAt(),
    revokedAt: tz('revoked_at'),
  },
  (t) => [unique('identity_keys_app_kid_key').on(t.appId, t.kid)],
);