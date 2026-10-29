import { bigint, boolean, jsonb, text, uuid } from 'drizzle-orm/pg-core';
import { tz } from '../../core/columns.js';
import { platformEnum } from '../apps/schema.js';
import type { EventCategory } from './plan.js';
import { eventsSchema } from './schema.js';

// The partitioned events table. Created by a hand-written migration
// (Drizzle cannot express PARTITION BY); described here for typed queries.
// This file is deliberately not named schema.ts, so drizzle-kit ignores it.
export const events = eventsSchema.table('events', {
  eventId: uuid('event_id').notNull(),
  appId: uuid('app_id').notNull(),
  userId: uuid('user_id').notNull(),
  installationId: uuid('installation_id').notNull(),
  sessionId: uuid('session_id'),
  seq: bigint('seq', { mode: 'number' }).notNull(),
  name: text('name').notNull(),
  category: text('category').$type<EventCategory>().notNull(),
  // Device time shifted by the device clock error; the partition key
  occurredAt: tz('occurred_at').notNull(),
  // Device time as sent
  clientOccurredAt: tz('client_occurred_at').notNull(),
  receivedAt: tz('received_at').notNull(),
  platform: platformEnum('platform').notNull(),
  appVersion: text('app_version').notNull(),
  appBuild: text('app_build').notNull(),
  osVersion: text('os_version').notNull(),
  country: text('country'),
  properties: jsonb('properties').$type<Record<string, unknown>>().notNull(),
  valid: boolean('valid').notNull(),
  invalidReason: text('invalid_reason'),
});