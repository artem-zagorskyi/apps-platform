import { sql } from 'drizzle-orm';
import { db } from '../../core/db.js';

// Creates month partitions ahead of time (current month and the next two)
export async function ensureEventPartitions(): Promise<void> {
  await db.execute(sql`select events.ensure_partitions(2)`);
}