import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { findAppForAdmin, listVisibleApps } from './apps-service.js';
import { adminOf, requireAdmin } from './guard.js';
import { getOverview } from './overview-service.js';
import { ALL_ROLES, hasAppRole, hasGlobalRole } from './roles.js';

// "all": every app the admin can see
const overviewQuery = z.object({ app: z.string().min(1).max(64).default('all') });

export async function adminOverviewRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // Every route here needs a signed-in admin
  app.addHook('preHandler', requireAdmin);

  // Any role: numbers are aggregates. Recent changes come from the audit
  // log, so only owners of every app get them.
  app.get('/overview', { schema: { querystring: overviewQuery } }, async (request) => {
    const session = adminOf(request);
    const all = request.query.app === 'all';
    const apps = all ? await listVisibleApps(session) : [await findAppForAdmin(session, request.query.app, ALL_ROLES)];

    return getOverview(apps, {
      withRecentChanges: hasGlobalRole(session, ['owner']),
      appSlug: all ? null : request.query.app,
      // Viewers see aggregates only: small groups stay off the live map
      viewerOnly: !apps.some((found) => hasAppRole(session, found.id, ['owner', 'product', 'support'])),
    });
  });
}
