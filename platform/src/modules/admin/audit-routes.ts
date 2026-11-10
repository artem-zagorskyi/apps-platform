import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { AppError } from '../../core/errors.js';
import { getAuditFilters, listAuditLog } from './audit-service.js';
import { adminOf, requireAdmin } from './guard.js';
import { hasGlobalRole } from './roles.js';
import type { AdminSession } from './service.js';

const auditQuery = z.object({
  app: z.string().min(1).max(64).optional(),
  admin: z.uuid().optional(),
  action: z.string().min(1).max(100).optional(),
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  before: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// The log shows sign-ins of other admins and views of user data: owners of
// every app only
function requireLogReader(session: AdminSession) {
  if (!hasGlobalRole(session, ['owner'])) {
    throw new AppError(403, 'forbidden', 'Only owners of every app can read the audit log');
  }
}

export async function adminAuditRoutes(server: FastifyInstance) {
  const app = server.withTypeProvider<ZodTypeProvider>();

  // Every route here needs a signed-in admin
  app.addHook('preHandler', requireAdmin);

  app.get('/audit-log', { schema: { querystring: auditQuery } }, async (request) => {
    requireLogReader(adminOf(request));
    const { app: appSlug, admin: adminId, ...rest } = request.query;
    return listAuditLog({ appSlug, adminId, ...rest });
  });

  app.get('/audit-log/filters', async (request) => {
    requireLogReader(adminOf(request));
    return getAuditFilters();
  });
}