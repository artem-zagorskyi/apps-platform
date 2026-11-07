import { db, type Tx } from '../../core/db.js';
import { auditLog } from './schema.js';

export interface AuditEntry {
  adminId: string | null; // null: a script on the server
  action: string; // dotted name: auth.login, app.update, user.view
  appId?: string | null;
  targetType?: string;
  targetId?: string;
  reason?: string;
  before?: unknown;
  after?: unknown;
  details?: unknown;
  ip?: string | null;
}

// Pass the transaction when the action itself runs in one: the entry is
// then saved together with the change, or not at all
export async function writeAudit(entry: AuditEntry, executor: typeof db | Tx = db): Promise<void> {
  await executor.insert(auditLog).values(entry);
}

// Who performs an admin action, as recorded in the audit log
export interface Actor {
  adminId: string;
  ip: string | null;
}