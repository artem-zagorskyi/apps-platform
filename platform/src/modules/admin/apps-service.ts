import { asc, inArray } from 'drizzle-orm';
import { db } from '../../core/db.js';
import { apps } from '../apps/schema.js';
import type { AdminSession } from './service.js';

// Apps the admin has any role on. A role without an app covers every app,
// including ones created later.
export async function listVisibleApps(session: AdminSession) {
  const coversAll = session.roles.some((grant) => grant.appId === null);
  const appIds = session.roles.flatMap((grant) => (grant.appId ? [grant.appId] : []));

  if (!coversAll && appIds.length === 0) {
    return [];
  }

  return db
    .select({
      id: apps.id,
      slug: apps.slug,
      name: apps.name,
      status: apps.status,
      createdAt: apps.createdAt,
    })
    .from(apps)
    .where(coversAll ? undefined : inArray(apps.id, appIds))
    .orderBy(asc(apps.name));
}