import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { prepareTestEnv } from './env.js';

// Creates the test database if it does not exist and applies all migrations
export default async function setup() {
  const { devUrl, testUrl } = await prepareTestEnv();
  const testDbName = new URL(testUrl).pathname.slice(1);

  // A database cannot create itself, so connect to the dev database first
  const admin = new pg.Client({ connectionString: devUrl });
  await admin.connect();
  const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [testDbName]);
  if (!rowCount) {
    await admin.query(`create database "${testDbName}"`);
  }
  await admin.end();

  const pool = new pg.Pool({ connectionString: testUrl });
  await migrate(drizzle({ client: pool }), { migrationsFolder: './migrations' });
  await pool.end();
}