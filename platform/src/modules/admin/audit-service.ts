import { and, asc, desc, eq, gte, lt, type SQL } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { apps } from '../apps/schema.js';
import { admins, auditLog } from './schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface AuditFilter {
  appSlug?: string;
  adminId?: string;
  action?: string;
  // Days in UTC, YYYY-MM-DD; both inclusive
  from?: string;
  to?: string;
  // Id of the last entry of the previous page
  before?: string;
  limit: number;
}

// Newest first. Ids are UUIDv7, so ordering by id is ordering by time.
export async function listAuditLog(filter: AuditFilter) {
  const conditions: SQL[] = [];

  if (filter.appSlug) {
    const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, filter.appSlug));
    if (!app) return { entries: [], nextBefore: null };
    conditions.push(eq(auditLog.appId, app.id));
  }
  if (filter.adminId) conditions.push(eq(auditLog.adminId, filter.adminId));
  if (filter.action) conditions.push(eq(auditLog.action, filter.action));
  if (filter.from) conditions.push(gte(auditLog.createdAt, new Date(`${filter.from}T00:00:00Z`)));
  if (filter.to) {
    conditions.push(lt(auditLog.createdAt, new Date(Date.parse(`${filter.to}T00:00:00Z`) + DAY_MS)));
  }
  if (filter.before) conditions.push(lt(auditLog.id, filter.before));

  const rows = await db
    .select({
      id: auditLog.id,
      createdAt: auditLog.createdAt,
      action: auditLog.action,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      reason: auditLog.reason,
      before: auditLog.before,
      after: auditLog.after,
      details: auditLog.details,
      ip: auditLog.ip,
      adminId: auditLog.adminId,
      adminEmail: admins.email,
      appSlug: apps.slug,
      appName: apps.name,
    })
    .from(auditLog)
    .leftJoin(admins, eq(admins.id, auditLog.adminId))
    .leftJoin(apps, eq(apps.id, auditLog.appId))
    .where(and(...conditions))
    .orderBy(desc(auditLog.id))
    .limit(filter.limit + 1);

  const page = rows.slice(0, filter.limit);
  const entries = page.map(({ adminId, adminEmail, appSlug, appName, ...entry }) => ({
    ...entry,
    // null: a script on the server
    admin: adminId ? { id: adminId, email: adminEmail } : null,
    app: appSlug ? { slug: appSlug, name: appName } : null,
  }));

  return { entries, nextBefore: rows.length > filter.limit ? page.at(-1)!.id : null };
}

// Values for the filter selects
export async function getAuditFilters() {
  const [adminRows, actionRows, appRows] = await Promise.all([
    db.select({ id: admins.id, email: admins.email }).from(admins).orderBy(asc(admins.email)),
    db.selectDistinct({ action: auditLog.action }).from(auditLog).orderBy(asc(auditLog.action)),
    db.select({ slug: apps.slug, name: apps.name }).from(apps).orderBy(asc(apps.name)),
  ]);
  return { admins: adminRows, actions: actionRows.map((row) => row.action), apps: appRows };
}