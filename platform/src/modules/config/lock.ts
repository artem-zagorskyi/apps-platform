import { sql } from 'drizzle-orm';
import type { Tx } from '../../core/db.js';

// Parameter schema uploads and config publishes of one app take turns: each
// checks the other's latest version, and version numbers stay sequential.
// Released automatically at the end of the transaction; taking it twice is fine.
export async function lockAppConfig(tx: Tx, appId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`config:${appId}`}, 0))`);
}