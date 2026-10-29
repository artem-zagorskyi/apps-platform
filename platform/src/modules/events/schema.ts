import { index, jsonb, pgSchema, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId } from '../../core/columns.js';
import { apps } from '../apps/schema.js';
import type { TrackingPlan } from './plan.js';

// All tables of this module live in the "events" Postgres schema
export const eventsSchema = pgSchema('events');

// Uploaded tracking plans of apps. The latest one is in effect;
// older ones stay as history.
export const trackingPlans = eventsSchema.table(
  'tracking_plans',
  {
    id: primaryId(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    plan: jsonb('plan').$type<TrackingPlan>().notNull(),
    // SHA-256 of the plan JSON: the same plan is not stored twice
    planHash: text('plan_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('tracking_plans_app_hash_key').on(t.appId, t.planHash),
    index('tracking_plans_app_created_idx').on(t.appId, t.createdAt.desc()),
  ],
);