import { bigint, boolean, foreignKey, index, jsonb, pgSchema, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId, tz } from '../../core/columns.js';
import { apps } from '../apps/schema.js';
import { users } from '../identity/schema.js';

// All tables of this module live in the "billing" Postgres schema
export const billingSchema = pgSchema('billing');

export const storeEnum = billingSchema.enum('store', ['google_play', 'app_store']);

// Later: non_consumable, consumable
export const productKindEnum = billingSchema.enum('product_kind', ['subscription']);

export const purchaseStateEnum = billingSchema.enum('purchase_state', [
  'pending', // paid with a delayed method, not settled yet: no access
  'active',
  'grace_period', // a renewal payment failed, the store keeps trying: access
  'on_hold', // grace period over, the store still tries: no access
  'paused', // paused by the person: no access
  'canceled', // will not renew: access until expires_at
  'expired',
  'refunded', // money returned or the purchase revoked
]);

export const purchaseEventKindEnum = billingSchema.enum('purchase_event_kind', [
  'registered',
  'renewed',
  'state_changed',
  'transferred',
  'refunded',
  'acknowledged',
  'anonymized',
]);

export const purchaseEventSourceEnum = billingSchema.enum('purchase_event_source', [
  'client', // the app sent the purchase
  'notification', // the store notified the server
  'reconcile', // a scheduled check
  'merge',
  'deletion',
]);

// What an app sells and which entitlements each product grants.
// Products are archived, never deleted: old purchases keep working.
export const products = billingSchema.table(
  'products',
  {
    id: primaryId(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    store: storeEnum('store').notNull(),
    // The product id in the store, e.g. premium for a Play subscription
    productId: text('product_id').notNull(),
    kind: productKindEnum('kind').notNull(),
    // Sorted, unique: e.g. {premium}
    entitlements: text('entitlements').array().notNull(),
    createdAt: createdAt(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    archivedAt: tz('archived_at'),
  },
  (t) => [unique('products_app_store_product_key').on(t.appId, t.store, t.productId)],
);

// One row per purchase in a store; a subscription with all its renewals
export const purchases = billingSchema.table(
  'purchases',
  {
    id: primaryId(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    // The owner; null once anonymized after an account deletion
    userId: uuid('user_id'),
    store: storeEnum('store').notNull(),
    // Google purchaseToken, Apple originalTransactionId
    purchaseKey: text('purchase_key').notNull(),
    // Google issues a new token on a plan change: the token it replaced
    previousKey: text('previous_key'),
    // Our user id the store recorded at purchase time (obfuscatedAccountId, appAccountToken)
    storeAccountRef: text('store_account_ref'),
    productId: text('product_id').notNull(),
    state: purchaseStateEnum('state').notNull(),
    startedAt: tz('started_at').notNull(),
    // End of the paid period
    expiresAt: tz('expires_at'),
    autoRenewing: boolean('auto_renewing').notNull(),
    priceMicros: bigint('price_micros', { mode: 'number' }),
    currency: text('currency'),
    country: text('country'),
    // A license tester or sandbox purchase: not revenue
    test: boolean('test').notNull().default(false),
    acknowledgedAt: tz('acknowledged_at'),
    // The store's latest answer as is, for investigating problems
    storePayload: jsonb('store_payload'),
    lastVerifiedAt: tz('last_verified_at'),
    createdAt: createdAt(),
    updatedAt: tz('updated_at').notNull().defaultNow(),
    anonymizedAt: tz('anonymized_at'),
  },
  (t) => [
    unique('purchases_store_key').on(t.store, t.purchaseKey),
    // A purchase belongs to a user of the same app
    foreignKey({
      name: 'purchases_user_fk',
      columns: [t.userId, t.appId],
      foreignColumns: [users.id, users.appId],
    }),
    index('purchases_user_idx').on(t.appId, t.userId),
    // Scheduled checks: purchases in a state that should have changed by now
    index('purchases_state_expires_idx').on(t.state, t.expiresAt),
  ],
);

// History of every purchase: the source for revenue reports
export const purchaseEvents = billingSchema.table(
  'purchase_events',
  {
    id: primaryId(),
    appId: uuid('app_id').notNull(),
    purchaseId: uuid('purchase_id')
      .notNull()
      .references(() => purchases.id),
    kind: purchaseEventKindEnum('kind').notNull(),
    source: purchaseEventSourceEnum('source').notNull(),
    fromState: purchaseStateEnum('from_state'),
    toState: purchaseStateEnum('to_state'),
    fromUserId: uuid('from_user_id'),
    toUserId: uuid('to_user_id'),
    details: jsonb('details'),
    occurredAt: tz('occurred_at').notNull().defaultNow(),
  },
  (t) => [
    index('purchase_events_purchase_idx').on(t.purchaseId, t.occurredAt),
    index('purchase_events_app_time_idx').on(t.appId, t.occurredAt),
  ],
);