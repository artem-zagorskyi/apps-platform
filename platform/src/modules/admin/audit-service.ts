import { and, asc, count, desc, eq, gt, gte, ilike, isNull, or, type SQL } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { apps } from '../apps/schema.js';
import { admins, auditLog, roleGrants, sessions } from './schema.js';

const DAY_MS = 24 * 60 * 60 * 1000;
// A session counts as active within this window, as in the admin guard
const IDLE_MS = 30 * 60 * 1000;

export const AUDIT_PERIODS = { '7d': 7, '30d': 30, '90d': 90, all: null } as const;
export type AuditPeriod = keyof typeof AUDIT_PERIODS;

// Entries of no app (sign-ins, admins, scripts). Slugs start with a letter.
export const PLATFORM_FILTER = '_platform';

export interface AuditFilter {
  // Part of the object (target id) or the reason
  q?: string;
  appSlug?: string;
  adminId?: string;
  action?: string;
  period: AuditPeriod;
  page: number;
  limit: number;
}

// % and _ typed in the search box are plain characters
const likeEscape = (text: string) => text.replace(/[\\%_]/g, (char) => `\\${char}`);

// Newest first. Ids are UUIDv7, so ordering by id is ordering by time.
export async function listAuditLog(filter: AuditFilter, now: Date = new Date()) {
  const conditions: SQL[] = [];

  if (filter.appSlug === PLATFORM_FILTER) {
    conditions.push(isNull(auditLog.appId));
  } else if (filter.appSlug) {
    const [app] = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, filter.appSlug));
    if (!app) return { entries: [], total: 0, page: filter.page, limit: filter.limit };
    conditions.push(eq(auditLog.appId, app.id));
  }
  if (filter.adminId) conditions.push(eq(auditLog.adminId, filter.adminId));
  if (filter.action) conditions.push(eq(auditLog.action, filter.action));

  const days = AUDIT_PERIODS[filter.period];
  if (days !== null) conditions.push(gte(auditLog.createdAt, new Date(now.getTime() - days * DAY_MS)));

  if (filter.q) {
    const pattern = `%${likeEscape(filter.q)}%`;
    conditions.push(or(ilike(auditLog.targetId, pattern), ilike(auditLog.reason, pattern))!);
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [rows, [totals]] = await Promise.all([
    db
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
        appStatus: apps.status,
      })
      .from(auditLog)
      .leftJoin(admins, eq(admins.id, auditLog.adminId))
      .leftJoin(apps, eq(apps.id, auditLog.appId))
      .where(where)
      .orderBy(desc(auditLog.id))
      .limit(filter.limit)
      .offset((filter.page - 1) * filter.limit),
    db.select({ total: count() }).from(auditLog).where(where),
  ]);

  const entries = rows.map(({ adminId, adminEmail, appSlug, appName, appStatus, ...entry }) => ({
    ...entry,
    // null: a script on the server
    admin: adminId ? { id: adminId, email: adminEmail } : null,
    // null: no app, or an app id the log still keeps after the app is gone
    app: appSlug ? { slug: appSlug, name: appName, status: appStatus } : null,
  }));

  return { entries, total: totals?.total ?? 0, page: filter.page, limit: filter.limit };
}

// Values for the filter selects
export async function getAuditFilters() {
  const [adminRows, actionRows, appRows] = await Promise.all([
    db.select({ id: admins.id, email: admins.email }).from(admins).orderBy(asc(admins.email)),
    db.selectDistinct({ action: auditLog.action }).from(auditLog).orderBy(asc(auditLog.action)),
    db.select({ slug: apps.slug, name: apps.name, status: apps.status }).from(apps).orderBy(asc(apps.name)),
  ]);
  return { admins: adminRows, actions: actionRows.map((row) => row.action), apps: appRows };
}

// Everyone who can sign in to the panel, with roles and state. No secrets.
export async function listAdmins(now: Date = new Date()) {
  const [rows, grants, active] = await Promise.all([
    db
      .select({
        id: admins.id,
        email: admins.email,
        lastLoginAt: admins.lastLoginAt,
        lockedUntil: admins.lockedUntil,
        disabledAt: admins.disabledAt,
        createdAt: admins.createdAt,
      })
      .from(admins)
      .orderBy(asc(admins.email)),
    db
      .select({ adminId: roleGrants.adminId, role: roleGrants.role, appSlug: apps.slug, appName: apps.name })
      .from(roleGrants)
      .leftJoin(apps, eq(apps.id, roleGrants.appId))
      .orderBy(asc(roleGrants.createdAt)),
    db
      .select({ adminId: sessions.adminId, sessions: count() })
      .from(sessions)
      .where(
        and(
          isNull(sessions.revokedAt),
          gt(sessions.expiresAt, now),
          gt(sessions.lastUsedAt, new Date(now.getTime() - IDLE_MS)),
        ),
      )
      .groupBy(sessions.adminId),
  ]);

  const sessionsOf = new Map(active.map((row) => [row.adminId, row.sessions]));
  return rows.map(({ lockedUntil, disabledAt, ...admin }) => ({
    ...admin,
    status: disabledAt ? 'disabled' : lockedUntil && lockedUntil > now ? 'locked' : 'active',
    roles: grants
      .filter((grant) => grant.adminId === admin.id)
      .map((grant) => ({ role: grant.role, app: grant.appSlug ? { slug: grant.appSlug, name: grant.appName } : null })),
    activeSessions: sessionsOf.get(admin.id) ?? 0,
  }));
}
