import { date, integer, jsonb, pgSchema, primaryKey, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId } from '../../core/columns.js';
import { apps, platformEnum } from '../apps/schema.js';
import type { TrackingPlan } from './plan.js';

// All tables of this module live in the "events" Postgres schema
export const eventsSchema = pgSchema('events');

// Uploaded tracking plans of apps. The highest number is in effect;
// older versions stay as history.
export const trackingPlans = eventsSchema.table(
  'tracking_plans',
  {
    id: primaryId(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    // Version number within the app: 1, 2, 3, ...
    number: integer('number').notNull(),
    plan: jsonb('plan').$type<TrackingPlan>().notNull(),
    // SHA-256 of the plan JSON with sorted keys
    planHash: text('plan_hash').notNull(),
    // Email of the admin who uploaded it; null for the plan:upload script
    uploadedBy: text('uploaded_by'),
    createdAt: createdAt(),
  },
  (t) => [unique('tracking_plans_app_number_key').on(t.appId, t.number)],
);

// Ids of received events, for deduplication. The partitioned events table
// cannot have a unique key on event_id alone (the partition key must be part
// of it, and the corrected time differs between retries).
// Ids older than 30 days will be removed by a background job.
export const eventIds = eventsSchema.table('event_ids', {
  eventId: uuid('event_id').primaryKey(),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
});

// Events refused on arrival, counted per day. The SDK does not record
// analytics without consent, so a rise here points at a bug in an app
// version. Counts only: no user ids. A retried batch is counted again.
export const rejectionCounts = eventsSchema.table(
  'rejection_counts',
  {
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    // UTC day of receipt
    day: date('day', { mode: 'string' }).notNull(),
    reason: text('reason').notNull(),
    platform: platformEnum('platform').notNull(),
    appVersion: text('app_version').notNull(),
    count: integer('count').notNull(),
  },
  (t) => [
    primaryKey({
      name: 'rejection_counts_pkey',
      columns: [t.appId, t.day, t.reason, t.platform, t.appVersion],
    }),
  ],
);