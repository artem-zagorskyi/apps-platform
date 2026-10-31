import { index, integer, jsonb, pgSchema, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId, tz } from '../../core/columns.js';
import { apps } from '../apps/schema.js';

// All tables of this module live in the "webhooks" Postgres schema
export const webhooksSchema = pgSchema('webhooks');

// Where an app's backend receives notifications. One endpoint per app.
export const endpoints = webhooksSchema.table('endpoints', {
  appId: uuid('app_id')
    .primaryKey()
    .references(() => apps.id),
  url: text('url').notNull(),
  // Signing secret, encrypted with DATA_ENCRYPTION_KEY
  secretEncrypted: text('secret_encrypted').notNull(),
  createdAt: createdAt(),
  updatedAt: tz('updated_at').notNull().defaultNow(),
});

// Every notification and its delivery state. The id is sent to the backend,
// so it can drop a notification it already handled.
export const deliveries = webhooksSchema.table(
  'deliveries',
  {
    id: primaryId(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    type: text('type').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
    deliveredAt: tz('delivered_at'),
    attempts: integer('attempts').notNull().default(0),
    lastStatus: integer('last_status'),
    lastError: text('last_error'),
  },
  (t) => [index('deliveries_app_created_idx').on(t.appId, t.createdAt.desc())],
);