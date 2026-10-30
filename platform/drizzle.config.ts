import { defineConfig } from 'drizzle-kit';

// drizzle-kit reads table definitions and generates SQL migrations from them.
export default defineConfig({
  dialect: 'postgresql',
  // Every module keeps its tables in its own schema.ts
  schema: './src/modules/*/schema.ts',
  out: './migrations',
  // Only our own Postgres schemas are managed, never "public" or system ones
    schemaFilter: ['apps', 'identity', 'events', 'config'],
  strict: true,
  verbose: true,
});