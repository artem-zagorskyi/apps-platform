import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';
import { AUDIT_PERIODS, type AuditPeriod, getAuditFilters, listAdmins, listAuditLog } from './audit-service.js';
import { adminOf, requireAdmin } from './guard.js';
import { hasGlobalRole } from './roles.js';

const auditQuery = z.object({
  q: z.string().trim().min(1).max(200).optional(),
  app: z.string().min(1).max(64).optional(),
  admin: z.uuid().optional(),
  action: z.string().min(1).max(100).optional(),
  period: z.enum(Object.keys(AUDIT_PERIODS) as [AuditPeriod, ...AuditPeriod[]]).default('30d'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

// The log and the admins list show sign-ins and views of user data:
// owners of every app only
function requireOwner(request: FastifyRequest) {
  if (!hasGlobalRole(adminOf(request), ['owner'])) {
    throw new AppError(403, 'forbidden', 'Only owners of every app can see this');
  }
}

export async function adminAuditRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // Every route here needs a signed-in admin
  app.addHook('preHandler', requireAdmin);

  app.get('/audit-log', { schema: { querystring: auditQuery } }, async (request) => {
    requireOwner(request);
    const { app: appSlug, admin: adminId, ...rest } = request.query;
    return listAuditLog({ appSlug, adminId, ...rest });
  });

  app.get('/audit-log/filters', async (request) => {
    requireOwner(request);
    return getAuditFilters();
  });

  app.get('/admins', async (request) => {
    requireOwner(request);
    return { admins: await listAdmins() };
  });
}
