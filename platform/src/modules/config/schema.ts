import { index, jsonb, pgSchema, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId } from '../../core/columns.js';
import { apps } from '../apps/schema.js';
import type { ParameterSchema } from './parameters.js';

// All tables of this module live in the "config" Postgres schema
export const configSchema = pgSchema('config');

// Parameter declarations uploaded by apps. The latest one is in effect;
// older ones stay as history.
export const parameterSchemas = configSchema.table(
  'parameter_schemas',
  {
    id: primaryId(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    schema: jsonb('schema').$type<ParameterSchema>().notNull(),
    // SHA-256 of the schema JSON: the same schema is not stored twice
    schemaHash: text('schema_hash').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('parameter_schemas_app_hash_key').on(t.appId, t.schemaHash),
    index('parameter_schemas_app_created_idx').on(t.appId, t.createdAt.desc()),
  ],
);