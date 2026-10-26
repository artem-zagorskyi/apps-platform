import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db, pool } from './db.js';

// Applies pending SQL migrations from ./migrations in order.
// Applied migrations are recorded in the drizzle.__drizzle_migrations table,
// so running this twice is safe.
await migrate(db, { migrationsFolder: './migrations' });
console.log('Migrations applied');
await pool.end();