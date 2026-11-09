import { integer, jsonb, pgSchema, text, unique, uuid } from 'drizzle-orm/pg-core';
import { createdAt, primaryId } from '../../core/columns.js';
import { apps } from '../apps/schema.js';
import type { ConfigDocument } from './document.js';
import type { ParameterSchema } from './parameters.js';

// All tables of this module live in the "config" Postgres schema
export const configSchema = pgSchema('config');

// Parameter declarations uploaded by apps. The highest number is in effect;
// older versions stay as history.
export const parameterSchemas = configSchema.table(
  'parameter_schemas',
  {
    id: primaryId(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    // Version number within the app: 1, 2, 3, ...
    number: integer('number').notNull(),
    schema: jsonb('schema').$type<ParameterSchema>().notNull(),
    // SHA-256 of the canonical schema JSON
    schemaHash: text('schema_hash').notNull(),
    // Email of the admin who uploaded it; null for scripts
    uploadedBy: text('uploaded_by'),
    createdAt: createdAt(),
  },
  (t) => [unique('parameter_schemas_app_number_key').on(t.appId, t.number)],
);

// Published config documents. The highest number is in effect; a rollback
// publishes an old document again as a new version.
export const configVersions = configSchema.table(
  'versions',
  {
    id: primaryId(),
    appId: uuid('app_id')
      .notNull()
      .references(() => apps.id),
    // 1, 2, 3... per app
    number: integer('number').notNull(),
    // With started_at / stopped_at set by the server
    document: jsonb('document').$type<ConfigDocument>().notNull(),
    // SHA-256 of the canonical JSON: an identical publish is skipped
    documentHash: text('document_hash').notNull(),
    comment: text('comment'),
    // Email of the admin who published it; null for scripts
    publishedBy: text('published_by'),
    createdAt: createdAt(),
  },
  // Also serves "latest version of an app"
  (t) => [unique('versions_app_number_key').on(t.appId, t.number)],
);