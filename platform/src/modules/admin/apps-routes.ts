import type { FastifyInstance } from 'fastify';
import { listVisibleApps } from './apps-service.js';
import { adminOf, requireAdmin } from './guard.js';

export async function adminAppsRoutes(app: FastifyInstance) {
  // Apps for the switcher in the panel
  app.get('/apps', { preHandler: requireAdmin }, async (request) => ({
    apps: await listVisibleApps(adminOf(request)),
  }));
}