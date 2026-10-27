import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { sql } from 'drizzle-orm';
import { config } from './config.js';

// One shared connection pool for the whole server.
// Every module uses `db` from here instead of opening its own connections.
export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  // Fail fast instead of hanging when the database is down
  connectionTimeoutMillis: 5_000,
});

// An idle connection can break (e.g. database restart).
// Without this handler the error would crash the whole process.
pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

export const db = drizzle({ client: pool });

// True if the database answers a trivial query
export async function isDatabaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

// Transaction handle passed to db.transaction callbacks
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];